-- 直近の土日祝大会「合成上昇度」算出 RPC（トップページ下リスト用）
-- 巡航速度・ミス率が各選手の自己平均をどれだけ上回ったかを、その週末の出場者内で
-- z-score 標準化して合算する。呼び出しはサーバー専用(supabaseAdmin/service_role)を想定。
--
-- ★重要: LapCenter の cruising_speed は「巡航ペース指数」で **値が小さいほど速い（良い）**。
--   （実測: 優勝者=最小値付近。基準ランナー=100。既存 AthleteDetail も低=良で配色）
--   したがって「速くなった＝値が下がった」を改善とする。miss_rate は 低いほど良い（従来どおり）。
--
-- 引数:
--   candidate_dates : 直近の土日祝の候補日（曜日/祝日判定はアプリ側 weekend-window.ts で実施し配列で渡す）
--   min_samples     : baseline に必要な同種目・対象前の最小レース数（既定5）
--   max_results     : 返却上限（既定8）
-- 仕様:
--   - clean: 速度 70〜300 かつ ミス 0〜80（データ誤りの外れ値を除外。低すぎる速度=計測誤りを除く）
--   - 対象クラスタ: candidate_dates のうち clean に存在する最大日 + その2日前までの土日祝ブロック
--   - 同一週末に複数大会×出場の場合は「良い方の大会（合成スコア最大）を1つ選択」（平均しない／event_name 返却）
--   - baseline: 対象クラスタ開始日より前の (athlete, race_type) 別 平均速度/平均ミス/件数(>=min_samples)
--   - speed_gain_pct = (bs - s)/bs*100  … ＋＝自己平均より速い（値が下がった）
--   - miss_drop_pp   = bm - m           … ＋＝自己平均よりミスが少ない
--   - composite = z(speed_gain_pct) + z(miss_drop_pp)（対象クラスタの大会×選手行で stddev_samp、sd=0は1で代替）
--   - 採用ゲート: s < bs（自己平均より速い）, 並び: composite 降順 → athlete_name（決定的）
-- 返却列を変更したため一旦 DROP（CREATE OR REPLACE は戻り型変更不可）
drop function if exists weekend_standouts(date[], int, int);
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
  event_name text,
  cluster_dates date[]
)
language sql
stable
as $$
  with clean as (
    select athlete_name, race_type, event_date, event_name, class_name,
           cruising_speed::float as s, miss_rate::float as m
    from lc_performances
    where cruising_speed between 70 and 300 and miss_rate between 0 and 80
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
  -- 対象クラスタ内を (選手, 種目, 大会名) 単位に集約。
  -- 同一大会で複数クラス出走時はその大会での最速（=最小 s）行を代表値とする。
  ev as (
    select c.athlete_name, c.race_type, c.event_date, c.event_name,
           min(c.s) as s,
           (array_agg(c.m order by c.s asc))[1] as m,
           (array_agg(c.class_name order by c.s asc))[1] as class_name
    from clean c
    where c.event_date in (select event_date from cluster)
    group by c.athlete_name, c.race_type, c.event_date, c.event_name
  ),
  -- baseline も「大会単位の代表値(最速)」に集約してから平均する（target と粒度を揃える）。
  -- 同一大会で複数クラス出走した過去レースが生行のまま平均に効いて自己平均が歪むのを防ぐ。
  baseline_ev as (
    select c.athlete_name, c.race_type, c.event_date, c.event_name,
           min(c.s) as s, (array_agg(c.m order by c.s asc))[1] as m
    from clean c, cluster_min
    where c.event_date < cluster_min.d
    group by c.athlete_name, c.race_type, c.event_date, c.event_name
  ),
  baseline as (
    select athlete_name, race_type, avg(s) as bs, avg(m) as bm, count(*) as bn
    from baseline_ev
    group by athlete_name, race_type
  ),
  ev_scored as (
    select e.athlete_name, e.race_type, e.event_name, e.class_name, e.s, e.m,
           b.bs, b.bm, b.bn,
           (b.bs - e.s) / nullif(b.bs, 0) * 100 as speed_gain_pct,   -- ＋＝速くなった（値が下がった）
           (b.bm - e.m) as miss_drop_pp
    from ev e
    join baseline b using (athlete_name, race_type)
    where b.bn >= min_samples
  ),
  stats as (
    select avg(speed_gain_pct) as sg_mean,
           coalesce(nullif(stddev_samp(speed_gain_pct), 0), 1) as sg_sd,
           avg(miss_drop_pp) as md_mean,
           coalesce(nullif(stddev_samp(miss_drop_pp), 0), 1) as md_sd
    from ev_scored
  ),
  ev_z as (
    select s2.*,
           ((s2.speed_gain_pct - st.sg_mean) / st.sg_sd
          + (s2.miss_drop_pp  - st.md_mean) / st.md_sd) as zcomp
    from ev_scored s2, stats st
  ),
  -- 選手×種目ごとに合成(zcomp)が最大の大会＝「良い方の大会」を1つ選択（平均しない）
  best as (
    select distinct on (athlete_name, race_type) *
    from ev_z
    order by athlete_name, race_type, zcomp desc
  )
  select b.athlete_name,
         b.race_type,
         round(b.s::numeric, 1),
         round(b.bs::numeric, 1),
         round(b.m::numeric, 1),
         round(b.bm::numeric, 1),
         b.bn::int,
         round(b.speed_gain_pct::numeric, 1),
         round(b.miss_drop_pp::numeric, 1),
         round(b.zcomp::numeric, 3) as composite,
         b.class_name,
         b.event_name,
         (select array_agg(event_date order by event_date) from cluster)
  from best b
  where b.s < b.bs                          -- 自己平均より速い（値が小さい）
  order by composite desc, b.athlete_name   -- 同値時の順位を決定的にする
  limit max_results;
$$;

revoke all on function weekend_standouts(date[], int, int) from public, anon;
grant execute on function weekend_standouts(date[], int, int) to service_role;
