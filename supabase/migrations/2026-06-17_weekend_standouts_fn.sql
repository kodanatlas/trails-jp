-- 直近の土日祝大会「合成上昇度」算出 RPC（トップページ下リスト用）
-- 巡航速度・ミス率が各選手の自己平均をどれだけ上回ったかを、その週末の出場者内で
-- z-score 標準化して合算する。呼び出しはサーバー専用(supabaseAdmin/service_role)を想定。
--
-- 引数:
--   candidate_dates : 直近の土日祝の候補日（曜日/祝日判定はアプリ側 weekend-window.ts で実施し配列で渡す）
--   min_samples     : baseline に必要な同種目・対象前の最小レース数（既定5）
--   max_results     : 返却上限（既定8）
-- 仕様:
--   - clean: 速度30〜250 かつ ミス0〜80（データ誤りの外れ値を除外）
--   - 対象クラスタ: candidate_dates のうち clean に存在する最大日 + その2日前までの土日祝ブロック
--   - target:   対象クラスタの (athlete, race_type) 別 平均速度/平均ミス
--   - baseline: 対象クラスタ開始日より前の (athlete, race_type) 別 平均速度/平均ミス/件数(>=min_samples)
--   - speed_gain_pct = (ts-bs)/bs*100, miss_drop_pp = bm-tm
--   - composite = z(speed_gain_pct) + z(miss_drop_pp)（コホート内 stddev_samp、sd=0は1で代替）
--   - 採用ゲート: ts>bs（自己平均より速い）, 並び: composite 降順
create or replace function weekend_standouts(
  candidate_dates date[],
  min_samples int default 5,
  max_results int default 8
)
returns table (
  athlete_name text,
  race_type text,
  target_speed numeric,
  baseline_speed numeric,
  target_miss numeric,
  baseline_miss numeric,
  baseline_n int,
  speed_gain_pct numeric,
  miss_drop_pp numeric,
  composite numeric,
  class_name text,
  cluster_dates date[]
)
language sql
stable
as $$
  with clean as (
    select athlete_name, race_type, event_date, class_name,
           cruising_speed::float as s, miss_rate::float as m
    from lc_performances
    where cruising_speed between 30 and 250 and miss_rate between 0 and 80
  ),
  present as (
    select distinct event_date from clean where event_date = any(candidate_dates)
  ),
  tmax as (select max(event_date) as d from present),
  cluster as (
    select p.event_date
    from present p, tmax
    where tmax.d is not null and p.event_date > tmax.d - 3   -- 最大日とその2日前まで（土日/連休ブロック）
  ),
  cluster_min as (select min(event_date) as d from cluster),
  target as (
    select c.athlete_name, c.race_type,
           avg(c.s) as ts, avg(c.m) as tm,
           (array_agg(c.class_name order by c.s desc))[1] as class_name
    from clean c
    where c.event_date in (select event_date from cluster)
    group by 1, 2
  ),
  baseline as (
    select c.athlete_name, c.race_type,
           avg(c.s) as bs, avg(c.m) as bm, count(*) as bn
    from clean c, cluster_min
    where c.event_date < cluster_min.d
    group by 1, 2
  ),
  cohort as (
    select t.athlete_name, t.race_type, t.ts, b.bs, t.tm, b.bm, b.bn, t.class_name,
           (t.ts - b.bs) / nullif(b.bs, 0) * 100 as speed_gain_pct,
           (b.bm - t.tm) as miss_drop_pp
    from target t
    join baseline b using (athlete_name, race_type)
    where b.bn >= min_samples
  ),
  stats as (
    select avg(speed_gain_pct) as sg_mean,
           coalesce(nullif(stddev_samp(speed_gain_pct), 0), 1) as sg_sd,
           avg(miss_drop_pp) as md_mean,
           coalesce(nullif(stddev_samp(miss_drop_pp), 0), 1) as md_sd
    from cohort
  )
  select c.athlete_name,
         c.race_type,
         round(c.ts::numeric, 1),
         round(c.bs::numeric, 1),
         round(c.tm::numeric, 1),
         round(c.bm::numeric, 1),
         c.bn::int,
         round(c.speed_gain_pct::numeric, 1),
         round(c.miss_drop_pp::numeric, 1),
         round((((c.speed_gain_pct - s.sg_mean) / s.sg_sd)
              + ((c.miss_drop_pp  - s.md_mean) / s.md_sd))::numeric, 3) as composite,
         c.class_name,
         (select array_agg(event_date order by event_date) from cluster)
  from cohort c, stats s
  where c.ts > c.bs
  order by composite desc, c.athlete_name   -- 同値時の順位を決定的にする
  limit max_results;
$$;

revoke all on function weekend_standouts(date[], int, int) from public, anon;
grant execute on function weekend_standouts(date[], int, int) to service_role;
