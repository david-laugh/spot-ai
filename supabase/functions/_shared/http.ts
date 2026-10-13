import { CONFIG } from "./config.ts";

function allowedOrigins(): string[] {
  const fromEnv = Deno.env.get("SPOT_AI_ALLOWED_ORIGINS");
  return fromEnv ? fromEnv.split(",").map((s) => s.trim()).filter(Boolean) : [...CONFIG.allowedOrigins];
}

/** "http://localhost:*" 처럼 포트 와일드카드를 지원합니다. */
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return allowedOrigins().some((pattern) => {
    if (pattern === origin) return true;
    if (pattern.endsWith(":*")) {
      const base = pattern.slice(0, -2);
      return origin === base || new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\d+$`).test(origin);
    }
    return false;
  });
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-client-info, apikey, authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin!;
  return headers;
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** 사용자에게 보여줄 오류. 내부 정보는 담지 않습니다. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new HttpError(413, "payload_too_large", "요청이 너무 깁니다.");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, "payload_too_large", "요청이 너무 깁니다.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "요청 형식이 올바르지 않습니다.");
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
