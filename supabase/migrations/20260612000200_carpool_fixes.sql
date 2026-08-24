-- ============================================================================
-- 配車割テーブル修正 — code-reviewer 指摘対応（2026-06-12）
-- 前提: 20260612_carpool_tables.sql は本番適用済み（本ファイルはその差分のみ）。
-- 適用はメインセッションが Management API で行う。
--
-- 内容:
--   M6: carpool_travel_times に PK 付与（初版で PK 未定義だった）
--   B1: travel_times の UNIQUE を club_id 込みに張り替え
--       （他クラブのノード UUID 指定による行の乗っ取り上書きを DB 層でも防壁）
--       ※ API 側 upsert の onConflict も "club_id,from_node_id,to_node_id,mode" に追従済み
--   M1: moddatetime による updated_at 自動更新トリガ（updated_at を持つ12テーブル）
--   M4: events の (club_id, joe_event_id, event_date) 部分ユニーク
--       （同一 JOY 大会の二重登録防止。events POST の 23505 分岐が機能する）
-- ============================================================================

-- ---------------------------------------------------------------------------
-- M6: travel_times に PK
-- （初版は UNIQUE(from,to,mode) のみで PK 無し。id 列は存在済み）
-- ---------------------------------------------------------------------------
ALTER TABLE carpool_travel_times ADD PRIMARY KEY (id);

-- ---------------------------------------------------------------------------
-- B1: UNIQUE 制約の張り替え (from,to,mode) → (club_id, from,to,mode)
-- テーブルはシード以外空のため衝突なし。
-- ---------------------------------------------------------------------------
ALTER TABLE carpool_travel_times DROP CONSTRAINT carpool_travel_times_unique;
ALTER TABLE carpool_travel_times
  ADD CONSTRAINT carpool_travel_times_unique
  UNIQUE (club_id, from_node_id, to_node_id, mode);

-- ---------------------------------------------------------------------------
-- M1: updated_at の自動更新（moddatetime）
-- Supabase 慣例に従い extensions スキーマに導入。
-- CREATE OR REPLACE TRIGGER で冪等（PG14+）。
-- change_log は updated_at を持たないため対象外（12テーブル）。
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

CREATE OR REPLACE TRIGGER trg_carpool_clubs_updated_at
  BEFORE UPDATE ON carpool_clubs
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE OR REPLACE TRIGGER trg_carpool_nodes_updated_at
  BEFORE UPDATE ON carpool_nodes
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE OR REPLACE TRIGGER trg_carpool_members_updated_at
  BEFORE UPDATE ON carpool_members
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE OR REPLACE TRIGGER trg_carpool_travel_times_updated_at
  BEFORE UPDATE ON carpool_travel_times
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE OR REPLACE TRIGGER trg_carpool_driver_pickup_prefs_updated_at
  BEFORE UPDATE ON carpool_driver_pickup_prefs
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE OR REPLACE TRIGGER trg_carpool_events_updated_at
  BEFORE UPDATE ON carpool_events
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE OR REPLACE TRIGGER trg_carpool_routes_updated_at
  BEFORE UPDATE ON carpool_routes
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE OR REPLACE TRIGGER trg_carpool_route_times_updated_at
  BEFORE UPDATE ON carpool_route_times
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE OR REPLACE TRIGGER trg_carpool_participations_updated_at
  BEFORE UPDATE ON carpool_participations
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE OR REPLACE TRIGGER trg_carpool_plans_updated_at
  BEFORE UPDATE ON carpool_plans
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE OR REPLACE TRIGGER trg_carpool_plan_cars_updated_at
  BEFORE UPDATE ON carpool_plan_cars
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE OR REPLACE TRIGGER trg_carpool_plan_riders_updated_at
  BEFORE UPDATE ON carpool_plan_riders
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- M4: 同一 JOY 大会の二重登録防止（手動作成 = joe_event_id IS NULL は対象外）
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_carpool_events_club_joe
  ON carpool_events (club_id, joe_event_id, event_date)
  WHERE joe_event_id IS NOT NULL;
