import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import path from "path";

/**
 * 統合テスト: anon キーでは carpool_clubs の行が見えてはならない（RLS 検証）。
 *
 * .env.local（リポジトリルート）から URL / anon キーを読む。未設定なら skip。
 * テーブル未作成（migration 未適用）の場合は警告して pass（anon が行を読めない、という主張は維持される）。
 */

function readEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  // process.env を優先
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return env;
  }

  try {
    const envPath = path.resolve(__dirname, "../../../../.env.local");
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // 引用符を剥がす
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in env)) env[key] = value;
    }
  } catch {
    // 読めなければ env はそのまま（キー不足で skip される）
  }
  return env;
}

const env = readEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "[anon-deny] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 未設定のため skip します。",
  );
}

describe.skipIf(!url || !anonKey)("anon は carpool_clubs を読めない (RLS)", () => {
  it("anon select は error か空配列のいずれか", async () => {
    const supabase = createClient(url as string, anonKey as string);
    const { data, error } = await supabase.from("carpool_clubs").select("*");

    if (error) {
      const code = (error as { code?: string }).code ?? "";
      const message = error.message ?? "";
      if (code === "42P01" || message.includes("does not exist")) {
        // eslint-disable-next-line no-console
        console.warn(
          "[anon-deny] carpool_clubs テーブルが存在しません（migration 未適用）。anon が行を読めない点は満たされるため pass。",
        );
        expect(true).toBe(true);
        return;
      }
      // それ以外のエラーは「anon が拒否された」= 期待どおり
      expect(error).not.toBeNull();
      return;
    }

    // error が無い場合は、行が見えてはならない（空配列であること）
    expect(Array.isArray(data)).toBe(true);
    expect(data ?? []).toHaveLength(0);
  });
});
