// SPOT AI 지식 데이터 동기화 API (npm run sync:knowledge 전용)
// - x-sync-token 헤더의 토큰을 DB(spot_ai_sync_tokens)의 sha256 해시와 대조해 인증합니다.
// - content_hash / embedding_model이 바뀐 청크만 임베딩하고, 모든 쓰기는 하나의 트랜잭션(RPC)으로 반영합니다.
// - 원본에서 사라진 청크는 기본적으로 비활성화(soft delete)하고, --prune일 때만 영구 삭제합니다.

import { CONFIG, ConfigError } from "../_shared/config.ts";
import { HttpError, readJsonBody } from "../_shared/http.ts";
import { embedDocuments, formatDocument, GeminiError } from "../_shared/gemini.ts";
import { adminClient } from "../_shared/supabase.ts";

type Chunk = {
  chunk_key: string; category: string; title: string; content: string; source: string;
  section: string | null; anchor: string | null; url: string | null; chunk_index: number;
  content_hash: string; metadata: Record<string, unknown>;
};
type Existing = {
  chunk_key: string; content_hash: string; embedding_model: string; is_active: boolean; source: string;
  chunk_index: number; category: string; title: string; section: string | null; anchor: string | null;
  url: string | null; metadata: Record<string, unknown>;
};

const MAX_CHUNKS = 1000;
/** 기존 활성 청크 대비 이 비율 미만으로 줄면 추출 오류로 보고 중단합니다(--force로 해제). */
const SHRINK_GUARD = 0.5;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const str = (v: unknown, max: number, required = true): string | null => {
  if (v === null || v === undefined || v === "") {
    if (required) throw new HttpError(400, "invalid_chunk", "필수 필드가 비어 있습니다.");
    return null;
  }
  if (typeof v !== "string" || v.length > max) throw new HttpError(400, "invalid_chunk", "필드 형식 또는 길이가 올바르지 않습니다.");
  return v;
};

function parseChunks(raw: unknown): Chunk[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CHUNKS) {
    throw new HttpError(400, "invalid_chunks", `chunks는 1~${MAX_CHUNKS}개의 배열이어야 합니다.`);
  }
  const keys = new Set<string>();
  return raw.map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const chunk: Chunk = {
      chunk_key: str(o.chunk_key, 300)!,
      category: str(o.category, 60)!,
      title: str(o.title, 500)!,
      content: str(o.content, 8000)!,
      source: str(o.source, 200)!,
      section: str(o.section, 500, false),
      anchor: str(o.anchor, 200, false),
      url: str(o.url, 400, false),
      chunk_index: Number.isInteger(o.chunk_index) ? (o.chunk_index as number) : 0,
      content_hash: str(o.content_hash, 128)!,
      metadata: o.metadata && typeof o.metadata === "object" ? (o.metadata as Record<string, unknown>) : {},
    };
    if (keys.has(chunk.chunk_key)) throw new HttpError(400, "duplicate_chunk_key", `중복 chunk_key: ${chunk.chunk_key}`);
    keys.add(chunk.chunk_key);
    return chunk;
  });
}

/** jsonb는 키 순서를 바꿔 저장하므로 키를 정렬해 비교합니다. */
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(v);

const sameMeta = (a: Existing, b: Chunk) =>
  a.chunk_index === b.chunk_index && a.category === b.category && a.title === b.title &&
  a.section === b.section && a.anchor === b.anchor && a.url === b.url &&
  canonical(a.metadata) === canonical(b.metadata);

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST만 지원합니다." });
  try {
    const db = adminClient();
    const token = req.headers.get("x-sync-token") ?? "";
    const { data: authorized, error: authError } = await db.rpc("spot_ai_verify_sync_token", { p_token: token });
    if (authError) throw new Error(`토큰 확인 실패: ${authError.message}`);
    if (!token || authorized !== true) return reply(401, { ok: false, error: "동기화 토큰이 올바르지 않습니다." });

    const body = (await readJsonBody(req, 5_000_000)) as Record<string, unknown>;
    const chunks = parseChunks(body.chunks);
    const sources = Array.isArray(body.sources) && body.sources.length
      ? body.sources.filter((s): s is string => typeof s === "string")
      : [...new Set(chunks.map((c) => c.source))];
    const dryRun = body.dryRun === true;
    const prune = body.prune === true;
    const force = body.force === true;
    const model = CONFIG.gemini.embeddingModel;

    const { data: rows, error } = await db
      .from("spot_ai_knowledge")
      .select("chunk_key, content_hash, embedding_model, is_active, source, chunk_index, category, title, section, anchor, url, metadata")
      .in("source", sources);
    if (error) throw new Error(`기존 데이터 조회 실패: ${error.message}`);
    const existing = new Map((rows as Existing[]).map((r) => [r.chunk_key, r]));

    const toEmbed: Chunk[] = [];
    const touch: Chunk[] = [];
    let created = 0, updated = 0, unchanged = 0, reactivated = 0;
    for (const c of chunks) {
      const prev = existing.get(c.chunk_key);
      if (!prev) { created++; toEmbed.push(c); continue; }
      if (prev.content_hash !== c.content_hash || prev.embedding_model !== model) { updated++; toEmbed.push(c); continue; }
      unchanged++;
      if (!prev.is_active) reactivated++;
      if (!prev.is_active || !sameMeta(prev, c)) touch.push(c);
    }

    const incoming = new Set(chunks.map((c) => c.chunk_key));
    const missing = [...existing.values()].filter((r) => !incoming.has(r.chunk_key));
    const deactivate = missing.filter((r) => r.is_active).map((r) => r.chunk_key);
    const remove = prune ? missing.map((r) => r.chunk_key) : [];

    const activeBefore = [...existing.values()].filter((r) => r.is_active).length;
    if (!force && activeBefore > 0 && chunks.length < activeBefore * SHRINK_GUARD) {
      throw new HttpError(409, "shrink_guard",
        `청크 수가 ${activeBefore} → ${chunks.length}로 급감했습니다. 추출 오류가 아니라면 --force로 다시 실행하세요.`);
    }

    const totals = {
      documents: sources.length,
      chunks: chunks.length,
      new: created,
      updated,
      unchanged,
      reactivated,
      deactivated: deactivate.length,
      deleted: remove.length,
      embedded: dryRun ? 0 : toEmbed.length,
    };

    if (!dryRun && (toEmbed.length || touch.length || deactivate.length || remove.length)) {
      // 임베딩을 모두 만든 뒤에만 DB를 바꿉니다. 중간 실패 시 기존 데이터는 그대로입니다.
      const vectors = await embedDocuments(toEmbed.map((c) => formatDocument(c.title, `${c.section ?? ""}\n${c.content}`)));
      const upserts = toEmbed.map((c, i) => ({ ...c, embedding: vectors[i], embedding_model: model }));
      const { error: applyError } = await db.rpc("spot_ai_apply_knowledge_sync", {
        p_upserts: upserts,
        p_touch: touch,
        p_deactivate: deactivate,
        p_delete: remove,
        p_stats: { ...totals, embedding_model: model, dimensions: CONFIG.gemini.embeddingDimensions },
      });
      if (applyError) throw new Error(`DB 반영 실패(롤백됨): ${applyError.message}`);
    }

    return reply(200, {
      ok: true,
      dryRun,
      totals,
      embedding: { model, dimensions: CONFIG.gemini.embeddingDimensions },
      errors: [],
    });
  } catch (err) {
    if (err instanceof HttpError) return reply(err.status, { ok: false, error: err.message });
    if (err instanceof ConfigError) return reply(500, { ok: false, error: err.message });
    const message = err instanceof GeminiError ? `Gemini 임베딩 실패 (HTTP ${err.status})` : err instanceof Error ? err.message : "알 수 없는 오류";
    console.error("[sync]", err instanceof Error ? err.message : err);
    return reply(500, { ok: false, error: message });
  }
});
