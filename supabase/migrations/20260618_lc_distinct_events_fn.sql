-- lc_performances の distinct (event_date, event_name, race_type) を返す軽量 RPC。
-- build-analysis-index の race_type バックフィル（JOYランキング種目で補正）が、
-- 全行(2万件)を引かずに大会単位の現在の種目を取得するために使う。サーバー専用。
create or replace function lc_distinct_events()
returns table (
  event_date date,
  event_name text,
  race_type text
)
language sql
stable
as $$
  select distinct event_date, event_name, race_type
  from lc_performances;
$$;

revoke all on function lc_distinct_events() from public, anon;
grant execute on function lc_distinct_events() to service_role;
