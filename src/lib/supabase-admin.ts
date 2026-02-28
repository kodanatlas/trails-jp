import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";

/**
 * サーバーサイド専用の Supabase クライアント（secret key使用）。
 * Cron ジョブやサーバーコンポーネントから Storage 読み書きに使う。
 */
export const supabaseAdmin: SupabaseClient =
  supabaseUrl && secretKey
    ? createClient(supabaseUrl, secretKey)
    : (new Proxy({} as SupabaseClient, {
        get: () => () => ({
          data: null,
          error: { message: "Supabase admin 未設定" },
        }),
      }) as unknown as SupabaseClient);
