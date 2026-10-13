// @ts-check
/* SPOT AI 챗봇 지식 데이터 동기화
 *
 *   npm run sync:knowledge          변경된 청크만 임베딩 후 Supabase에 반영
 *   npm run sync:knowledge:dry      DB를 바꾸지 않고 신규/수정/삭제 예정 건수만 확인
 *   npm run knowledge:preview       네트워크 없이 추출된 청크만 출력
 *
 * 옵션: --prune (비활성 청크를 영구 삭제) · --force (청크 수 급감 안전장치 해제) · --out <file> (청크 JSON 저장)
 * 환경변수(.env): SPOT_AI_SUPABASE_URL, SPOT_AI_SYNC_TOKEN
 *
 * 임베딩 생성과 DB 쓰기는 Edge Function(spot-ai-sync)이 서버에서 처리합니다.
 * 로컬에는 Supabase 관리자 키가 필요 없고, 동기화 토큰만 있으면 됩니다. */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SOURCES } from "./knowledge/config.mjs";
import { extractChunks } from "./knowledge/extract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (/** @type {string} */ name) => args.includes(name);
const option = (/** @type {string} */ name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
  // 1~4. 원본 확인 · 텍스트 추출/정제 · 카테고리 분류 · 청크 생성
  const chunks = [];
  for (const source of SOURCES) {
    const html = await readFile(path.join(ROOT, source.file), "utf8");
    const extracted = extractChunks(html, source);
    if (!extracted.length) throw new Error(`${source.file}에서 추출된 청크가 없습니다. 마크업 구조를 확인하세요.`);
    chunks.push(...extracted);
  }
  const keys = new Set(chunks.map((c) => c.chunk_key));
  if (keys.size !== chunks.length) throw new Error("chunk_key가 중복되었습니다. 페이지의 id 중복 여부를 확인하세요.");

  const out = option("--out");
  if (out) await writeFile(out, JSON.stringify(chunks, null, 2), "utf8");

  const byCategory = chunks.reduce((m, c) => ((m[c.category] = (m[c.category] ?? 0) + 1), m), /** @type {Record<string, number>} */ ({}));
  console.log(`문서 ${SOURCES.length}개 → 청크 ${chunks.length}개`);
  console.log("카테고리:", Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join(", "));

  if (flag("--preview")) {
    for (const c of chunks) {
      console.log(`\n── [${c.chunk_index}] ${c.chunk_key} · ${c.category} · ${c.content.length}자\n   ${c.title}`);
      console.log(c.content.split("\n").map((l) => "   | " + l).join("\n"));
    }
    return;
  }

  // 5~7. 기존 데이터와 비교 · 변경분 임베딩 · Supabase 반영 (서버에서 처리)
  const base = process.env.SPOT_AI_SUPABASE_URL;
  const token = process.env.SPOT_AI_SYNC_TOKEN;
  if (!base || !token) {
    throw new Error("SPOT_AI_SUPABASE_URL, SPOT_AI_SYNC_TOKEN 환경변수가 필요합니다 (.env 확인).");
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/functions/v1/spot-ai-sync`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-token": token },
    body: JSON.stringify({
      sources: SOURCES.map((s) => s.file),
      chunks,
      dryRun: flag("--dry-run"),
      prune: flag("--prune"),
      force: flag("--force"),
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    throw new Error(`동기화 실패 (HTTP ${res.status}): ${body.error ?? "알 수 없는 오류"}`);
  }

  // 8. 결과 출력
  const t = body.totals;
  console.log(`\n${body.dryRun ? "[DRY RUN] 변경 사항은 저장되지 않았습니다." : "동기화 완료"}`);
  console.log(`임베딩 모델: ${body.embedding.model} (${body.embedding.dimensions}차원)`);
  console.table({
    "전체 문서": t.documents,
    "전체 청크": t.chunks,
    "신규": t.new,
    "수정": t.updated,
    "변경 없음": t.unchanged,
    "재활성화": t.reactivated,
    "비활성화(원본에서 삭제)": t.deactivated,
    "영구 삭제(--prune)": t.deleted,
    "임베딩 API 호출 청크": t.embedded,
  });
  console.log(`오류: ${body.errors?.length ? body.errors.join("; ") : "없음"}`);
}

main().catch((err) => {
  console.error(`\n[sync:knowledge] ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
