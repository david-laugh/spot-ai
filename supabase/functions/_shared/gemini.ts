import { CONFIG, env } from "./config.ts";

const G = CONFIG.gemini;

export class GeminiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
  /** 다른 모델로 재시도할 만한 일시적 오류인지 */
  get retryable() {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

async function call(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${G.apiBase}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env("GEMINI_API_KEY") },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new GeminiError(0, `Gemini 요청 실패: ${err instanceof Error ? err.name : "network"}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GeminiError(res.status, `Gemini ${path} HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

// ───────────────────────── 임베딩 ─────────────────────────
// gemini-embedding-2는 task_type 대신 텍스트 접두어로 용도를 구분합니다 (공식 문서 권장 형식).
export const formatQuery = (q: string) => `task: search result | query: ${q}`;
export const formatDocument = (title: string, text: string) => `title: ${title || "none"} | text: ${text}`;

function checkDims(values: number[] | undefined): number[] {
  if (!values || values.length !== G.embeddingDimensions) {
    throw new GeminiError(500, `임베딩 차원 불일치: ${values?.length} != ${G.embeddingDimensions}`);
  }
  return values;
}

export async function embedQuery(query: string): Promise<number[]> {
  const res = await call(`models/${G.embeddingModel}:embedContent`, {
    content: { parts: [{ text: formatQuery(query) }] },
    outputDimensionality: G.embeddingDimensions,
  }, G.timeoutMs.embed);
  const data = await res.json();
  return checkDims(data?.embedding?.values);
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);
    const res = await call(`models/${G.embeddingModel}:batchEmbedContents`, {
      requests: batch.map((text) => ({
        model: `models/${G.embeddingModel}`,
        content: { parts: [{ text }] },
        outputDimensionality: G.embeddingDimensions,
      })),
    }, 60_000);
    const data = await res.json();
    const vectors = (data?.embeddings ?? []).map((e: { values?: number[] }) => checkDims(e.values));
    if (vectors.length !== batch.length) throw new GeminiError(500, "배치 임베딩 결과 수가 요청 수와 다릅니다.");
    out.push(...vectors);
  }
  return out;
}

// ───────────────────────── 생성 ─────────────────────────
export type Content = { role: "user" | "model"; parts: { text: string }[] };

type GenerateOptions = {
  model: string;
  system: string;
  contents: Content[];
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

function requestBody(o: GenerateOptions) {
  return {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: o.contents,
    generationConfig: {
      temperature: o.temperature ?? G.temperature,
      maxOutputTokens: o.maxOutputTokens ?? G.maxOutputTokens,
      thinkingConfig: { thinkingLevel: G.thinkingLevel },
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };
}

// deno-lint-ignore no-explicit-any
function textOf(chunk: any): string {
  const parts = chunk?.candidates?.[0]?.content?.parts ?? [];
  // deno-lint-ignore no-explicit-any
  return parts.filter((p: any) => !p.thought && typeof p.text === "string").map((p: any) => p.text).join("");
}

export async function generate(o: GenerateOptions): Promise<string> {
  const res = await call(`models/${o.model}:generateContent`, requestBody(o), o.timeoutMs ?? G.timeoutMs.generate);
  return textOf(await res.json()).trim();
}

/**
 * 스트리밍 생성. 첫 응답을 받기 전에 실패하면 예외를 던지므로 호출 측에서 다른 모델로 재시도할 수 있습니다.
 * 반환값은 텍스트 조각을 내보내는 async iterator입니다.
 */
export async function generateStream(o: GenerateOptions): Promise<AsyncGenerator<{ text: string; finishReason?: string }>> {
  const res = await call(`models/${o.model}:streamGenerateContent?alt=sse`, requestBody(o), o.timeoutMs ?? G.timeoutMs.generate);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();

  async function* iterate() {
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          const chunk = JSON.parse(payload);
          yield { text: textOf(chunk), finishReason: chunk?.candidates?.[0]?.finishReason };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  return iterate();
}

/** 기본 모델 → 대체 모델 순으로 시도합니다. */
export async function withFallback<T>(fn: (model: string) => Promise<T>): Promise<{ value: T; model: string }> {
  try {
    return { value: await fn(G.chatModel), model: G.chatModel };
  } catch (err) {
    if (err instanceof GeminiError && err.retryable && G.fallbackChatModel) {
      console.warn(`[gemini] ${G.chatModel} 실패(${err.status}) → ${G.fallbackChatModel}로 재시도`);
      return { value: await fn(G.fallbackChatModel), model: G.fallbackChatModel };
    }
    throw err;
  }
}
