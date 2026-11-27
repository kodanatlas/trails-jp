-- ルーキーリーグ（docs/plans/2026-11-27_rookie-league.md）
-- 1) JOA 競技者登録の初登録年度（公開名簿の年度スナップショットから算出）。service_role だけが読み書きする
create table if not exists public.joa_registrations (
  name_key text primary key,
  first_fy integer not null,
  first_valid_from date,
  updated_at timestamptz not null default now()
);
alter table public.joa_registrations enable row level security;
revoke all on public.joa_registrations from anon, authenticated;

-- 2) 年度の B/A/E 候補の出走（クラスの厳密な判定は TS 側。ここは大まかな絞り込み）。
--    PostgREST の max-rows を避けるため jsonb 1 値で返す
create or replace function public.rookie_season_results(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'e', lc_event_id, 'c', lc_class_id, 'd', event_date, 'en', event_name, 'cn', class_name,
    'n', runner_name, 'k', runner_key, 'cl', club, 'r', rank, 's', result_sec
  )), '[]'::jsonb)
  from lc_leg_splits
  where event_date >= p_from and event_date <= p_to
    and class_name ~ '(A|B|E)'
    and result_sec is not null and rank is not null and rank > 0;
$$;

-- 3) その期間に出走した人の LapCenter 初出日（全期間の最小）
create or replace function public.rookie_lc_first(p_from date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(runner_key, f), '{}'::jsonb)
  from (
    select runner_key, min(event_date) as f
    from lc_leg_splits
    where runner_key in (select distinct runner_key from lc_leg_splits where event_date >= p_from)
    group by runner_key
  ) q;
$$;

revoke all on function public.rookie_season_results(date, date) from public, anon, authenticated;
revoke all on function public.rookie_lc_first(date) from public, anon, authenticated;
grant execute on function public.rookie_season_results(date, date) to service_role;
grant execute on function public.rookie_lc_first(date) to service_role;
