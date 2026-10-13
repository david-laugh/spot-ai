// SPOT AI 챗봇 설정 — 모델 ID와 검색 파라미터는 여기서만 바꾸면 됩니다.

export const CONFIG = {
  gemini: {
    apiBase: "https://generativelanguage.googleapis.com/v1beta",
    // 임베딩: 문서·질문 모두 같은 모델과 차원을 써야 합니다. 바꾸면 sync:knowledge가 전체를 다시 임베딩합니다.
    embeddingModel: "gemini-embedding-2",
    embeddingDimensions: 1536,
    // 답변 생성: 응답 속도·비용·한국어 품질 기준 (2026-10 실측: 약 1초 내 응답, Stable)
    chatModel: "gemini-3.5-flash-lite",
    // 기본 모델이 과부하(429/5xx)일 때 시도할 모델
    fallbackChatModel: "gemini-3.1-flash-lite",
    // 후속 질문을 독립적인 검색 질의로 바꾸는 모델
    rewriteModel: "gemini-3.5-flash-lite",
    thinkingLevel: "low",
    temperature: 0.3,
    maxOutputTokens: 1200,
    timeoutMs: { embed: 10_000, rewrite: 6_000, generate: 45_000 },
  },
  retrieval: {
    matchCount: 6,
    minSimilarity: 0.35,
    keywordWeight: 0.5,
    // 출처 표시 기준 (2026-10 실측: 관련 질문 top-1 ≈ 0.62~0.79, 무관한 질문 ≈ 0.54~0.61)
    sourceMinSimilarity: 0.62,
    // 최상위 문서보다 이 값 이상 낮은 문서는 출처에서 제외
    sourceMaxGap: 0.06,
    maxSources: 3,
    maxContextChars: 7000,
  },
  chat: {
    maxMessageChars: 800,
    maxHistoryMessages: 6, // 최근 3턴
    maxHistoryItemChars: 1200,
    maxBodyBytes: 32_000,
  },
  rateLimit: {
    perMinute: 10,
    perDay: 150,
    globalPerDay: 3000,
  },
  // 브라우저 호출을 허용할 Origin. 환경변수 SPOT_AI_ALLOWED_ORIGINS(쉼표 구분)로 덮어쓸 수 있습니다.
  allowedOrigins: [
    "https://david-laugh.github.io",
    "http://localhost:*",
    "http://127.0.0.1:*",
  ],
} as const;

export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new ConfigError(`환경변수 ${name}이(가) 설정되지 않았습니다.`);
  return value;
}

export class ConfigError extends Error {}
