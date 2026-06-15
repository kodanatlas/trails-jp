-- ============================================================================
-- 配車割: 到着バッファの分解（準備時間＋会場→スタート徒歩）— Phase 4 追補
-- 設計: orienteering-carpool/docs/plans/2026-06-15_buffer_breakdown_venue_to_start.md
--
-- 背景:
--   到着バッファ B（車の現地到着 → 最早スタート）は現状 carpool_events.buffer_min の
--   単一値（既定75）。これを「準備時間 prep_min（既定60）＋ 会場→スタート徒歩
--   venue_to_start_min（nullable=未設定）」に分解し、画面に内訳表示できるようにする。
--
--   ソルバ入力の B は plan-input.ts 側で B = prep_min + (venue_to_start_min ?? 0) と
--   合成する。既存 buffer_min カラムは後方互換のため残すが、B の算定には使わない。
--
-- 安全性: 追加カラムのみ。ADD COLUMN IF NOT EXISTS で冪等。既存行は prep_min=60 /
--         venue_to_start_min=NULL（未設定）で埋まる。デフォルト B = 60（旧75より小さく
--         なるが、未入力時の控えめな既定として妥当。会場→徒歩は手入力/自動取得で上積み）。
--
-- 適用はこのファイルを書くだけ。Management API での適用はメインセッションが行う。
-- ============================================================================

ALTER TABLE carpool_events
  ADD COLUMN IF NOT EXISTS prep_min int NOT NULL DEFAULT 60;

ALTER TABLE carpool_events
  ADD COLUMN IF NOT EXISTS venue_to_start_min int;
