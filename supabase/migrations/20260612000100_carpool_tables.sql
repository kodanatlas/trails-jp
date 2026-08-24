-- ============================================================================
-- 配車割ツール（carpool）テーブル一式 — Phase 2
-- 仕様: orienteering-carpool/docs/spec/02_データモデル.md（2026-06-12 確定版）
--
-- 設計原則:
--   - 全テーブル carpool_ プレフィックスで名前空間分離（trails.jp と同居）
--   - 全テーブルに club_id（子テーブルにも非正規化で保持。マルチクラブ設計）
--   - PK は uuid DEFAULT gen_random_uuid()（change_log のみ bigserial 相当）
--   - created_at / updated_at は timestamptz DEFAULT now()
--   - RLS は全テーブル ENABLE するがポリシーは一切作らない
--     → anon 全拒否（既存 cron_notification_log と同形）。service role はバイパス。
--   - 物理削除はしない（active フラグ / change_log で復元）
--
-- 適用はこのファイルを書くだけ。Management API での適用はメインセッションが行う。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. clubs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_clubs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  joe_club_names  text[] NOT NULL DEFAULT '{}',
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. nodes（エリア / 集合場所 / 会場の統一モデル）
--    members.home_node_id が参照するため先に定義する。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_nodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES carpool_clubs(id),
  kind        text NOT NULL CHECK (kind IN ('area', 'pickup', 'venue')),
  name        text NOT NULL,
  lat         numeric,
  lng         numeric,
  parking     boolean NOT NULL DEFAULT false,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carpool_nodes_club ON carpool_nodes(club_id);
CREATE INDEX IF NOT EXISTS idx_carpool_nodes_club_kind ON carpool_nodes(club_id, kind);

-- ---------------------------------------------------------------------------
-- 3. members
--    default_capacity は「運転手含む乗車可能人数」（API 入出力は −1 した seatsAvailable）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id             uuid NOT NULL REFERENCES carpool_clubs(id),
  display_name        text NOT NULL,
  athlete_key         text,
  home_node_id        uuid REFERENCES carpool_nodes(id),
  has_car             boolean NOT NULL DEFAULT false,
  default_capacity    int,
  default_willingness text NOT NULL DEFAULT 'if_needed'
                        CHECK (default_willingness IN ('always', 'if_needed')),
  earliest_departure  time,
  luggage_in_car      boolean NOT NULL DEFAULT true,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carpool_members_club ON carpool_members(club_id);
CREATE INDEX IF NOT EXISTS idx_carpool_members_athlete_key ON carpool_members(club_id, athlete_key);

-- ---------------------------------------------------------------------------
-- 4. travel_times（移動時間マトリクス）
--    PK は (from_node_id, to_node_id, mode)。club_id は非正規化保持。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_travel_times (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES carpool_clubs(id),
  from_node_id  uuid NOT NULL REFERENCES carpool_nodes(id),
  to_node_id    uuid NOT NULL REFERENCES carpool_nodes(id),
  mode          text NOT NULL CHECK (mode IN ('car', 'transit')),
  minutes       int NOT NULL,
  source        text NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'osrm', 'api')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carpool_travel_times_unique UNIQUE (from_node_id, to_node_id, mode)
);
CREATE INDEX IF NOT EXISTS idx_carpool_travel_times_club ON carpool_travel_times(club_id);

-- ---------------------------------------------------------------------------
-- 5. driver_pickup_prefs（メンバー既定のピックアップ希望）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_driver_pickup_prefs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES carpool_clubs(id),
  member_id   uuid NOT NULL REFERENCES carpool_members(id),
  node_id     uuid NOT NULL REFERENCES carpool_nodes(id),
  strength    text NOT NULL CHECK (strength IN ('hard', 'soft')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carpool_pickup_prefs_member ON carpool_driver_pickup_prefs(member_id);
CREATE INDEX IF NOT EXISTS idx_carpool_pickup_prefs_club ON carpool_driver_pickup_prefs(club_id);

-- ---------------------------------------------------------------------------
-- 6. events（配車イベント = 大会×日）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         uuid NOT NULL REFERENCES carpool_clubs(id),
  joe_event_id    integer,
  name            text NOT NULL,
  event_date      date NOT NULL,
  venue_node_id   uuid REFERENCES carpool_nodes(id),
  buffer_min      int NOT NULL DEFAULT 75,
  status          text NOT NULL DEFAULT 'planning'
                    CHECK (status IN ('planning', 'provisional', 'final', 'closed')),
  bulletin_url    text,
  startlist_url   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carpool_events_club ON carpool_events(club_id);
CREATE INDEX IF NOT EXISTS idx_carpool_events_club_date ON carpool_events(club_id, event_date);

-- ---------------------------------------------------------------------------
-- 7. routes（イベント別ルート候補）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_routes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES carpool_clubs(id),
  event_id     uuid NOT NULL REFERENCES carpool_events(id),
  name         text NOT NULL,
  toll_yen     int NOT NULL DEFAULT 0,
  distance_km  numeric NOT NULL DEFAULT 0,
  risk_score   int NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 3),
  risk_windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carpool_routes_event ON carpool_routes(event_id);
CREATE INDEX IF NOT EXISTS idx_carpool_routes_club ON carpool_routes(club_id);

-- ---------------------------------------------------------------------------
-- 8. route_times（ルート経由の会場までの所要）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_route_times (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL REFERENCES carpool_clubs(id),
  route_id         uuid NOT NULL REFERENCES carpool_routes(id),
  node_id          uuid NOT NULL REFERENCES carpool_nodes(id),
  minutes_to_venue int NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carpool_route_times_unique UNIQUE (route_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_carpool_route_times_route ON carpool_route_times(route_id);
CREATE INDEX IF NOT EXISTS idx_carpool_route_times_club ON carpool_route_times(club_id);

-- ---------------------------------------------------------------------------
-- 9. participations（大会ごとの参加情報）
--    unique(event_id, member_id)。capacity_override も +1 保存規約。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_participations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                     uuid NOT NULL REFERENCES carpool_clubs(id),
  event_id                    uuid NOT NULL REFERENCES carpool_events(id),
  member_id                   uuid NOT NULL REFERENCES carpool_members(id),
  role                        text NOT NULL
                                CHECK (role IN ('driver', 'rider', 'self', 'absent')),
  capacity_override           int,
  willingness                 text CHECK (willingness IN ('always', 'if_needed')),
  earliest_departure_override time,
  fixed_driver_member_id      uuid REFERENCES carpool_members(id),
  pickup_prefs_override       jsonb,
  start_time                  time,
  class_name                  text,
  est_course_min              int,
  entry_source                text NOT NULL DEFAULT 'manual'
                                CHECK (entry_source IN ('auto', 'manual')),
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carpool_participations_unique UNIQUE (event_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_carpool_participations_event ON carpool_participations(event_id);
CREATE INDEX IF NOT EXISTS idx_carpool_participations_member ON carpool_participations(member_id);
CREATE INDEX IF NOT EXISTS idx_carpool_participations_club ON carpool_participations(club_id);

-- ---------------------------------------------------------------------------
-- 10. plans（配車案バージョン）
--     unique(event_id, kind, version)。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES carpool_clubs(id),
  event_id    uuid NOT NULL REFERENCES carpool_events(id),
  version     int NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('outbound', 'return')),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  locks       jsonb NOT NULL DEFAULT '{}'::jsonb,
  weights     jsonb NOT NULL DEFAULT '{}'::jsonb,
  kpi         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carpool_plans_unique UNIQUE (event_id, kind, version)
);
CREATE INDEX IF NOT EXISTS idx_carpool_plans_event ON carpool_plans(event_id);
CREATE INDEX IF NOT EXISTS idx_carpool_plans_club ON carpool_plans(club_id);

-- ---------------------------------------------------------------------------
-- 11. plan_cars
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_plan_cars (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                uuid NOT NULL REFERENCES carpool_clubs(id),
  plan_id                uuid NOT NULL REFERENCES carpool_plans(id),
  driver_member_id       uuid NOT NULL REFERENCES carpool_members(id),
  route_id               uuid REFERENCES carpool_routes(id),
  pickup_node_ids        jsonb NOT NULL DEFAULT '[]'::jsonb,
  departure_time         time,
  arrival_time           time,
  cost_yen               int,
  recommended_departure  jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carpool_plan_cars_plan ON carpool_plan_cars(plan_id);
CREATE INDEX IF NOT EXISTS idx_carpool_plan_cars_club ON carpool_plan_cars(club_id);

-- ---------------------------------------------------------------------------
-- 12. plan_riders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_plan_riders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id               uuid NOT NULL REFERENCES carpool_clubs(id),
  plan_id               uuid NOT NULL REFERENCES carpool_plans(id),
  member_id             uuid NOT NULL REFERENCES carpool_members(id),
  car_driver_member_id  uuid NOT NULL REFERENCES carpool_members(id),
  pickup_node_id        uuid REFERENCES carpool_nodes(id),
  board_time            time,
  locked                boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carpool_plan_riders_plan ON carpool_plan_riders(plan_id);
CREATE INDEX IF NOT EXISTS idx_carpool_plan_riders_club ON carpool_plan_riders(club_id);

-- ---------------------------------------------------------------------------
-- 13. change_log（監査・復元・レート制限）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carpool_change_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  club_id     uuid,
  table_name  text NOT NULL,
  record_id   uuid,
  action      text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  payload     jsonb,
  actor_name  text,
  ip_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- レート制限は ip_hash + created_at で直近1時間を COUNT するため複合インデックス。
CREATE INDEX IF NOT EXISTS idx_carpool_change_log_ip_created ON carpool_change_log(ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_carpool_change_log_record ON carpool_change_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_carpool_change_log_club ON carpool_change_log(club_id, created_at);

-- ============================================================================
-- RLS: 全テーブル ENABLE、ポリシーは作らない（= anon 全拒否、service role バイパス）
-- ============================================================================
ALTER TABLE carpool_clubs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_nodes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_travel_times        ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_driver_pickup_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_routes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_route_times         ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_participations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_plans               ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_plan_cars           ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_plan_riders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE carpool_change_log          ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- シード: 入間市OLC（冪等 = slug ユニークで ON CONFLICT DO NOTHING）
--   settings: 燃料単価170円/L・燃費12km/L・運転手係数0.5・既定バッファ75分・丸め100円
-- ============================================================================
INSERT INTO carpool_clubs (name, slug, joe_club_names, settings)
VALUES (
  '入間市OLC',
  'iruma-olc',
  ARRAY['入間市OLC'],
  jsonb_build_object(
    'fuel_price_per_liter', 170,
    'fuel_efficiency_km_per_liter', 12,
    'driver_coefficient', 0.5,
    'default_buffer_min', 75,
    'rounding_unit_yen', 100
  )
)
ON CONFLICT (slug) DO NOTHING;
