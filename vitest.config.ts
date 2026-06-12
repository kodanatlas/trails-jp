import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * vitest 設定。
 *
 * 目的: `@/*` パスエイリアス（tsconfig の paths と同じ ./src 解決）を vitest 側でも有効化する。
 * 既存のソルバーテストは相対 import のみで動いており、このエイリアス追加は加算的で無害。
 * 配車割の helpers / entry-detect は内部で `@/lib/...` を参照するため、テストから到達するには
 * この解決が必須（テストファイル自体は相対 import のままでよい）。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
