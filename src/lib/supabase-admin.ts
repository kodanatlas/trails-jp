import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";

// Supabase オリジン(Postgres/Storage)が一時的に不達/過負荷になったとき、タイムアウト無しの
// fetch が無限にハングし、ISR ページの静的生成が Next の 60秒上限に達してビルド全体を落とす
// 事故(2026-07-12)を防ぐ。全 supabase-js 呼び出しに共通の上限を課し、ハング時は即エラー →
// 各呼び出し側の try/catch フォールバック(バンドル events.json / null / 既存ファイル保持)へ倒す。
const SUPABASE_FETCH_TIMEOUT_MS = 15000;
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("supabase fetch timeout")),
    SUPABASE_FETCH_TIMEOUT_MS,
  );
  // 呼び出し側が独自 signal を渡していれば、その abort も尊重する（両者の論理和）。
  const caller = init?.signal;
  if (caller) {
    if (caller.aborted) controller.abort(caller.reason);
    else caller.addEventListener("abort", () => controller.abort(caller.reason), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

/**
 * サーバーサイド専用の Supabase クライアント（secret key使用）。
 * Cron ジョブやサーバーコンポーネントから Storage 読み書きに使う。
 */
export const supabaseAdmin: SupabaseClient =
  supabaseUrl && secretKey
    ? createClient(supabaseUrl, secretKey, { global: { fetch: fetchWithTimeout } })
    : (new Proxy({} as SupabaseClient, {
        get: () => () => ({
          data: null,
          error: { message: "Supabase admin 未設定" },
        }),
      }) as unknown as SupabaseClient);
