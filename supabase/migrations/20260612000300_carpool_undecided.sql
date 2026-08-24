-- ============================================================================
-- 配車割: participations.role に 'undecided'（回答待ち）を追加 — Phase 2.5
-- 設計: orienteering-carpool/docs/plans/2026-06-12_phase2.5_初見導線再設計.md §3
--
-- 背景:
--   検出パネルからの一括登録（bulk）は role='undecided' で参加行を作る。
--   本人が後でフォームで運転手/同乗希望/自力/不参加に更新して解消する。
--   登録状況一覧では「回答待ち」グレー表示。ソルバ（Phase 3）では self/absent と
--   同様に最適化対象 M から除外する（先回りの仕様明記のみ。コード変更なし）。
--
-- 前提: 20260612_carpool_tables.sql / 20260612_carpool_fixes.sql は本番適用済み。
--       本ファイルはその差分（CHECK 制約の張り替え）のみ。適用はメインセッションが
--       Management API で行う。
--
-- 安全性: 既存データはすべて旧 4 値（driver/rider/self/absent）のいずれかであり、
--         新 CHECK は旧 4 値 + undecided の上位集合のため、検証に失敗する行は無い。
-- ============================================================================

ALTER TABLE carpool_participations
  DROP CONSTRAINT carpool_participations_role_check;

ALTER TABLE carpool_participations
  ADD CONSTRAINT carpool_participations_role_check
  CHECK (role IN ('driver', 'rider', 'self', 'absent', 'undecided'));
