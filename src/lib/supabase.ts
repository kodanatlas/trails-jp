import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// 環境変数未設定時はダミークライアント（ビルド時エラー回避）
export const supabase: SupabaseClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : (new Proxy({} as SupabaseClient, {
        get: () => () => ({ data: { session: null, subscription: { unsubscribe: () => {} } }, error: { message: "Supabase未設定" } }),
      }) as unknown as SupabaseClient);

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);
