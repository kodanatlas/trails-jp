-- 週次ランキングスナップショット（先週比 wow の材料）。
-- week = その週の月曜日 YYYY-MM-DD。stats = { "選手名": { r: rank, p: total_points } }。
-- ranking_snapshot（月次）と同型。書き込みは build の service_role キー（RLS バイパス）。
create table if not exists public.ranking_snapshot_weekly (
  week text not null,
  file_key text not null,
  stats jsonb not null,
  created_at timestamptz not null default now(),
  primary key (week, file_key)
);

alter table public.ranking_snapshot_weekly enable row level security;

-- 公開読み取り（月次 ranking_snapshot と同じ public_read 方針）
drop policy if exists public_read on public.ranking_snapshot_weekly;
create policy public_read on public.ranking_snapshot_weekly for select to public using (true);
