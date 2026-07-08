-- /api/lc の出走順位(rank)補完を1クエリ化する RPC。
-- 背景: 2クエリ(lc_performances + lc_leg_splits)に分けると1リクエストあたりのDB負荷が
-- 倍化し、脆弱な小インスタンスを飽和させた(2026-07-08 regression)。DB側 LEFT JOIN LATERAL
-- で1クエリに統合し、元の単一クエリと同じ負荷プロファイルに戻す。
-- runner_key・event_date は既存インデックスあり(lc_leg_splits_runner_key_idx 等)。

create or replace function get_lc_perf_with_rank(p_name text)
returns table(
  event_date date,
  event_name text,
  class_name text,
  cruising_speed numeric,
  miss_rate numeric,
  race_type text,
  rank integer
)
language sql
stable
as $$
  select p.event_date, p.event_name, p.class_name, p.cruising_speed, p.miss_rate, p.race_type, ls.rank
  from lc_performances p
  left join lateral (
    select l.rank from lc_leg_splits l
    where l.runner_key = regexp_replace(p_name, '\s', '', 'g')
      and l.event_date = p.event_date
      and l.class_name = p.class_name
    limit 1
  ) ls on true
  where p.athlete_name = p_name
  order by p.event_date;
$$;
