-- 하이브리드 검색 키워드 순위 수정
-- 문제: 작은 테이블에서 플래너가 PGroonga 인덱스 스캔을 쓰지 않아 pgroonga_score()가 항상 0 → 키워드 순위가 무작위였음.
-- 수정: 질문 단어별 &@ 일치 개수로 순위를 매깁니다(인덱스 사용 여부와 무관하게 결정적).
--       한국어 조사(은/는/이/가/을/를 …)를 뗀 형태도 함께 검색합니다.
-- 또한 enable_seqscan = off 강제를 제거합니다. 현재 규모(수십 행)에서는 순차 스캔이 정확한 KNN을 주고,
-- 데이터가 늘어나면 플래너가 HNSW 인덱스를 자동으로 선택합니다.

drop index if exists public.spot_ai_knowledge_active_category;

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
as $$
  with params as (
    select least(greatest(coalesce(match_count, 6), 1), 20) as k
  ),
  raw_terms as (
    select w
    from regexp_split_to_table(lower(left(coalesce(query_text, ''), 500)), '[[:space:][:punct:]]+') as w
    where char_length(w) >= 2
  ),
  terms as (
    select distinct t
    from raw_terms,
         lateral (values (w), (regexp_replace(w, '(으로|에서|에게|이란|까지|부터|은|는|이|가|을|를|의|에|로|와|과|도|만|요)$', ''))) as v(t)
    where char_length(t) >= 2
    limit 30
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
  keyword_hits as (
    select kn.id, count(*) as matched
    from spot_ai_knowledge kn
    join terms on kn.search_text &@ terms.t
    where kn.is_active
      and (filter_category is null or kn.category = filter_category)
    group by kn.id
  ),
  keyword as (
    select kh.id,
           rank() over (order by kh.matched desc) as rnk
    from keyword_hits kh
    order by kh.matched desc
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

revoke execute on function public.match_spot_ai_knowledge(extensions.vector, text, integer, double precision, text, double precision) from public, anon, authenticated;
grant execute on function public.match_spot_ai_knowledge(extensions.vector, text, integer, double precision, text, double precision) to service_role;
