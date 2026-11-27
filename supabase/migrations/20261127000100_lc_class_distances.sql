-- LapCenter のクラスごとのコース距離（B クラス候補の計算に使う）
-- 計画: docs/plans/2026-11-27_b-class-candidates.md
create table if not exists public.lc_class_distances (
  lc_event_id integer not null,
  lc_class_id integer not null,
  class_name text not null,
  distance_km numeric(5, 2) not null check (distance_km > 0),
  fetched_at timestamptz not null default now(),
  primary key (lc_event_id, lc_class_id)
);

-- 読み書きとも service_role のみ（ビルド時に使うだけで公開しない）
alter table public.lc_class_distances enable row level security;
