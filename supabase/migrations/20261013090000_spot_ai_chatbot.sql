-- SPOT AI 챗봇 RAG 스키마
-- 임베딩: gemini-embedding-2, outputDimensionality = 1536 (실측 확인한 출력 차원)
-- 모든 테이블은 RLS로 잠그고(anon/authenticated 정책 없음), Edge Function(service_role)만 RPC로 접근합니다.

create extension if not exists vector with schema extensions;
create extension if not exists pgroonga with schema extensions;

-- ───────────────────────── 지식 청크 ─────────────────────────
create table public.spot_ai_knowledge (
  id              uuid primary key default gen_random_uuid(),
  chunk_key       text not null unique,                 -- {source}#{anchor}#{part} : 재실행 시 동일 청크를 식별
  category        text not null,
  title           text not null,
  content         text not null,
  source          text not null,                        -- 원본 파일 (index.html …)
  section         text,                                 -- 최상위 섹션 제목
  anchor          text,                                 -- 페이지 내 id
  url             text,                                 -- 사이트 기준 상대 경로 (index.html#pp-roi)
  chunk_index     integer not null,
  content_hash    text not null,                        -- 변경 감지 (sha256)
  metadata        jsonb not null default '{}'::jsonb,
  embedding       extensions.vector(1536) not null,
  embedding_model text not null,
  is_active       boolean not null default true,        -- 원본에서 사라진 청크는 비활성화(soft delete)
  search_text     text generated always as (title || E'\n' || coalesce(section, '') || E'\n' || content) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.spot_ai_knowledge is 'SPOT AI 웹사이트 콘텐츠 기반 챗봇 지식 청크 (npm run sync:knowledge 로 갱신)';

create index spot_ai_knowledge_embedding_hnsw
  on public.spot_ai_knowledge using hnsw (embedding extensions.vector_cosine_ops);
create index spot_ai_knowledge_search_pgroonga
  on public.spot_ai_knowledge using pgroonga (search_text);
create index spot_ai_knowledge_active_category
  on public.spot_ai_knowledge (is_active, category);

create or replace function public.spot_ai_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger spot_ai_knowledge_updated_at
  before update on public.spot_ai_knowledge
  for each row execute function public.spot_ai_set_updated_at();

-- ───────────────────────── 요청 제한 ─────────────────────────
create table public.spot_ai_rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);

-- ───────────────────────── 동기화 토큰 / 이력 ─────────────────────────
create table public.spot_ai_sync_tokens (
  id         bigint generated always as identity primary key,
  token_hash text not null unique,                      -- sha256(hex). 원문 토큰은 저장하지 않습니다
  label      text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.spot_ai_sync_runs (
  id         bigint generated always as identity primary key,
  dry_run    boolean not null,
  stats      jsonb not null,
  created_at timestamptz not null default now()
);

-- ───────────────────────── RLS: 공개 접근 차단 ─────────────────────────
alter table public.spot_ai_knowledge   enable row level security;
alter table public.spot_ai_rate_limits enable row level security;
alter table public.spot_ai_sync_tokens enable row level security;
alter table public.spot_ai_sync_runs   enable row level security;

revoke all on public.spot_ai_knowledge, public.spot_ai_rate_limits, public.spot_ai_sync_tokens, public.spot_ai_sync_runs
  from anon, authenticated;

-- ───────────────────────── 검색 RPC (벡터 + 키워드 하이브리드) ─────────────────────────
-- 벡터 코사인 유사도 순위와 PGroonga 전문 검색 순위를 Reciprocal Rank Fusion으로 합칩니다.
-- 키워드 검색은 질문의 단어를 OR로 묶어 모델명·수치(MobileNetV3, 35% 등) 일치를 보강합니다.
create or replace function public.match_spot_ai_knowledge(
  query_embedding extensions.vector(1536),
  query_text      text default '',
  match_count     integer default 6,
  min_similarity  double precision default 0.3,
  filter_category text default null,
  keyword_weight  double precision default 0.5
)
returns table (
  id uuid,
  chunk_key text,
  category text,
  title text,
  content text,
  source text,
  section text,
  url text,
  similarity double precision,
  keyword_rank bigint,
  score double precision
)
language sql
stable
set search_path = public, extensions
-- 테이블이 작아도 HNSW / PGroonga 인덱스를 사용해 pgroonga_score가 계산되도록 합니다
set enable_seqscan = off
as $$
  with params as (
    select least(greatest(coalesce(match_count, 6), 1), 20) as k
  ),
  keyword_query as (
    select string_agg(distinct pgroonga_query_escape(w), ' OR ') as q
    from regexp_split_to_table(lower(left(coalesce(query_text, ''), 500)), '[[:space:][:punct:]]+') as w
    where char_length(w) >= 2
  ),
  semantic as (
    select kn.id,
           row_number() over (order by kn.embedding <=> query_embedding) as rnk
    from spot_ai_knowledge kn
    where kn.is_active
      and (filter_category is null or kn.category = filter_category)
    order by kn.embedding <=> query_embedding
    limit (select k * 4 from params)
  ),
  keyword as (
    select kn.id,
           row_number() over (order by pgroonga_score(kn.tableoid, kn.ctid) desc) as rnk
    from spot_ai_knowledge kn, keyword_query kq
    where kq.q is not null
      and kn.search_text &@~ kq.q
      and kn.is_active
      and (filter_category is null or kn.category = filter_category)
    order by pgroonga_score(kn.tableoid, kn.ctid) desc
    limit (select k * 4 from params)
  ),
  fused as (
    select coalesce(s.id, kw.id) as id,
           coalesce(1.0 / (60 + s.rnk), 0) + keyword_weight * coalesce(1.0 / (60 + kw.rnk), 0) as score,
           kw.rnk as keyword_rank
    from semantic s
    full outer join keyword kw on kw.id = s.id
  )
  select kn.id, kn.chunk_key, kn.category, kn.title, kn.content, kn.source, kn.section, kn.url,
         1 - (kn.embedding <=> query_embedding) as similarity,
         f.keyword_rank,
         f.score
  from fused f
  join spot_ai_knowledge kn on kn.id = f.id
  where 1 - (kn.embedding <=> query_embedding) >= min_similarity
  order by f.score desc
  limit (select k from params);
$$;

-- ───────────────────────── 요청 제한 RPC ─────────────────────────
-- 고정 윈도우 카운터. 허용 범위 안이면 true.
create or replace function public.spot_ai_rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into spot_ai_rate_limits as r (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;

  -- 오래된 카운터 정리 (약 2% 확률로 수행)
  if random() < 0.02 then
    delete from spot_ai_rate_limits where window_start < now() - interval '2 days';
  end if;

  return v_hits <= p_limit;
end;
$$;

-- ───────────────────────── 동기화 RPC ─────────────────────────
create or replace function public.spot_ai_verify_sync_token(p_token text)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1 from spot_ai_sync_tokens
    where revoked_at is null
      and token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
  );
$$;

-- 하나의 트랜잭션에서 신규/수정 청크 upsert, 메타데이터 갱신, 비활성화/영구 삭제를 수행합니다.
-- 중간에 실패하면 전체가 롤백되어 기존 데이터가 유지됩니다.
create or replace function public.spot_ai_apply_knowledge_sync(
  p_upserts    jsonb,     -- 임베딩 포함 신규/수정 청크
  p_touch      jsonb,     -- 내용은 같고 순서·메타데이터만 바뀌었거나 재활성화할 청크 (임베딩 재사용)
  p_deactivate text[],    -- 원본에서 사라진 chunk_key
  p_delete     text[],    -- --prune 시 영구 삭제할 chunk_key
  p_stats      jsonb
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_upserted integer := 0;
  v_touched integer := 0;
  v_deactivated integer := 0;
  v_deleted integer := 0;
begin
  insert into spot_ai_knowledge as kn (
    chunk_key, category, title, content, source, section, anchor, url, chunk_index,
    content_hash, metadata, embedding, embedding_model, is_active
  )
  select r.chunk_key, r.category, r.title, r.content, r.source, r.section, r.anchor, r.url, r.chunk_index,
         r.content_hash, coalesce(r.metadata, '{}'::jsonb), (r.embedding)::text::vector(1536), r.embedding_model, true
  from jsonb_to_recordset(coalesce(p_upserts, '[]'::jsonb)) as r(
    chunk_key text, category text, title text, content text, source text, section text, anchor text, url text,
    chunk_index integer, content_hash text, metadata jsonb, embedding jsonb, embedding_model text
  )
  on conflict (chunk_key) do update set
    category = excluded.category, title = excluded.title, content = excluded.content,
    source = excluded.source, section = excluded.section, anchor = excluded.anchor, url = excluded.url,
    chunk_index = excluded.chunk_index, content_hash = excluded.content_hash, metadata = excluded.metadata,
    embedding = excluded.embedding, embedding_model = excluded.embedding_model, is_active = true;
  get diagnostics v_upserted = row_count;

  update spot_ai_knowledge kn set
    category = t.category, title = t.title, section = t.section, anchor = t.anchor, url = t.url,
    chunk_index = t.chunk_index, metadata = coalesce(t.metadata, '{}'::jsonb), is_active = true
  from jsonb_to_recordset(coalesce(p_touch, '[]'::jsonb)) as t(
    chunk_key text, category text, title text, section text, anchor text, url text, chunk_index integer, metadata jsonb
  )
  where kn.chunk_key = t.chunk_key;
  get diagnostics v_touched = row_count;

  update spot_ai_knowledge set is_active = false
  where chunk_key = any(coalesce(p_deactivate, '{}')) and is_active;
  get diagnostics v_deactivated = row_count;

  delete from spot_ai_knowledge where chunk_key = any(coalesce(p_delete, '{}'));
  get diagnostics v_deleted = row_count;

  insert into spot_ai_sync_runs (dry_run, stats) values (false, coalesce(p_stats, '{}'::jsonb));

  return jsonb_build_object(
    'upserted', v_upserted, 'touched', v_touched, 'deactivated', v_deactivated, 'deleted', v_deleted
  );
end;
$$;

-- service_role(Edge Function)만 RPC 실행 가능
revoke execute on function public.match_spot_ai_knowledge(extensions.vector, text, integer, double precision, text, double precision) from public, anon, authenticated;
revoke execute on function public.spot_ai_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.spot_ai_verify_sync_token(text) from public, anon, authenticated;
revoke execute on function public.spot_ai_apply_knowledge_sync(jsonb, jsonb, text[], text[], jsonb) from public, anon, authenticated;
revoke execute on function public.spot_ai_set_updated_at() from public, anon, authenticated;

grant execute on function public.match_spot_ai_knowledge(extensions.vector, text, integer, double precision, text, double precision) to service_role;
grant execute on function public.spot_ai_rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.spot_ai_verify_sync_token(text) to service_role;
grant execute on function public.spot_ai_apply_knowledge_sync(jsonb, jsonb, text[], text[], jsonb) to service_role;
