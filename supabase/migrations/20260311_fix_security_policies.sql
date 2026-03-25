-- ============================================================
-- セキュリティ修正: 危険なALLポリシーの削除 + likesのINSERT制限
-- 適用日: 2026-03-11
-- ============================================================
--
-- 背景:
--   "Service role can manage ..." ポリシーが roles={public} で ALL を許可しており、
--   anon key で誰でも INSERT/UPDATE/DELETE できる状態だった。
--   service_role key は RLS をバイパスするため、これらのポリシーは不要。
--
-- アプリへの影響:
--   - 全API Routeは supabaseAdmin (service_role key) を使用 → RLSバイパス → 影響なし
--   - anon key での SELECT は既存の "Anyone can read" ポリシーで引き続き動作
--   - anon key での INSERT/UPDATE/DELETE は不可になる（意図通り）
--

BEGIN;

-- ============================================================
-- 1. athletes: 危険な ALL ポリシーを削除
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage athletes" ON public.athletes;

-- ============================================================
-- 2. athlete_appearances: 危険な ALL ポリシーを削除
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage appearances" ON public.athlete_appearances;

-- ============================================================
-- 3. lc_performances: 危険な ALL ポリシーを削除
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage lc" ON public.lc_performances;

-- ============================================================
-- 4. likes: 無制限の INSERT ポリシーを制限付きに置き換え
-- ============================================================
-- 現状: "Anyone can insert likes" が無条件で INSERT を許可
-- 変更: authenticated ユーザーのみ INSERT 可能に制限
--        (実際の INSERT は全て supabaseAdmin 経由なので影響なし)
--        anon key での直接 INSERT を防止する
DROP POLICY IF EXISTS "Anyone can insert likes" ON public.likes;

-- likes への直接 INSERT は認証済みユーザーのみに制限
-- (アプリは supabaseAdmin 経由のため影響なし)
CREATE POLICY "Authenticated users can insert likes"
  ON public.likes
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

COMMIT;

-- ============================================================
-- 修正後のポリシー一覧 (期待値):
-- ============================================================
-- athletes:
--   - "Anyone can read athletes" (SELECT, public, qual=true) ✅
--
-- athlete_appearances:
--   - "Anyone can read appearances" (SELECT, public, qual=true) ✅
--
-- lc_performances:
--   - "Anyone can read lc" (SELECT, public, qual=true) ✅
--
-- likes:
--   - "Anyone can read likes" (SELECT, public, qual=true) ✅
--   - "Authenticated users can insert likes" (INSERT, authenticated) ✅
-- ============================================================
