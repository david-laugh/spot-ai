import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";
import { env } from "./config.ts";

let client: SupabaseClient | null = null;

/** service_role 클라이언트. Edge Function 안에서만 사용하며 브라우저로 키가 나가지 않습니다. */
export function adminClient(): SupabaseClient {
  if (!client) {
    client = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
