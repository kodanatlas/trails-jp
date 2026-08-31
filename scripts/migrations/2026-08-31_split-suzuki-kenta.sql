-- 鈴木健太（金沢大学／筑波大学）の同姓同名分離。
-- 事前に event_date / class_name / leg 側の所属 / 大会名を人が全行監査し、
-- その分類結果を主キー id で固定した一回限りのデータ移行。SQL 内では分類を再計算しない。
--
-- 実行手順（Supabase Management API）:
-- 1. sync-events（19:07）、sync-entries（20:23）、sync-lapcenter（21:41）の各 cron が
--    動いていない時間帯を選ぶ（時刻はいずれも JST）。
-- 2. jq -Rs '{query: .}' scripts/migrations/2026-08-31_split-suzuki-kenta.sql \
--      > /tmp/2026-08-31_split-suzuki-kenta.json
-- 3. curl --request POST \
--      "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
--      --header "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
--      --header "Content-Type: application/json" \
--      --data-binary @/tmp/2026-08-31_split-suzuki-kenta.json
-- 日本語を含む SQL を curl の -d に直接書かず、必ずファイル経由の JSON payload で送る。

begin;

-- 検証から更新完了まで、明示した対象行だけを主キー順にロックする。
-- 対象外の新規行はロックせず、旧名の総数も条件にしない。
select id
from public.lc_performances
where id in (
  4692, 4693, 4695, 4696, 4697, 4698, 4699, 4700, 4701, 4702, 4704, 4706,
  4708, 4709, 4710, 4711, 4712, 36296, 37555, 38210, 39123, 39265, 40829, 45964,
  46448, 52447, 55013, 55515, 56405, 56683, 58357, 58854, 59690, 59720, 61415, 62318,
  104346, 104363, 105332, 106595, 109139,
  4691, 4694, 4703, 4705, 4707, 39339, 40890, 45786, 56968, 71684, 75574, 78880
)
order by id
for update;

select id
from public.lc_leg_splits
where id in (
  1114, 2839, 3774, 4021, 4483, 4708, 5473, 6384, 7893, 8560, 8901, 10219,
  10690, 13442, 14729, 14798, 14848, 15482, 15881, 16073, 16131, 16782, 17094, 17134,
  18751, 19024, 19067, 20800, 21316, 118275, 119055, 122936, 123968, 124219, 125460, 126395,
  128251, 128817, 128845, 129044, 130422, 131400, 133046, 138549, 141447,
  5338, 6002, 11060, 17745, 18496, 23646, 32025, 39324, 42504, 43779, 47283, 54494,
  55093, 118018, 121061, 123022, 125541, 143489, 145746
)
order by id
for update;

-- 更新前検証。監査済み id 群の重複・交差、欠落、現在値の変化を検出する。
-- 対象外で旧名の行が増減していても、この検証は中断条件にしない。
do $$
declare
  performance_tsukuba_ids bigint[] := array[
    4692, 4693, 4695, 4696, 4697, 4698, 4699, 4700, 4701, 4702, 4704, 4706,
    4708, 4709, 4710, 4711, 4712, 36296, 37555, 38210, 39123, 39265, 40829, 45964,
    46448, 52447, 55013, 55515, 56405, 56683, 58357, 58854, 59690, 59720, 61415, 62318,
    104346, 104363, 105332, 106595, 109139
  ]::bigint[];
  performance_kanazawa_ids bigint[] := array[
    4691, 4694, 4703, 4705, 4707, 39339, 40890, 45786, 56968, 71684, 75574, 78880
  ]::bigint[];
  leg_tsukuba_ids bigint[] := array[
    1114, 2839, 3774, 4021, 4483, 4708, 5473, 6384, 7893, 8560, 8901, 10219,
    10690, 13442, 14729, 14798, 14848, 15482, 15881, 16073, 16131, 16782, 17094, 17134,
    18751, 19024, 19067, 20800, 21316, 118275, 119055, 122936, 123968, 124219, 125460, 126395,
    128251, 128817, 128845, 129044, 130422, 131400, 133046, 138549, 141447
  ]::bigint[];
  leg_kanazawa_ids bigint[] := array[
    5338, 6002, 11060, 17745, 18496, 23646, 32025, 39324, 42504, 43779, 47283, 54494,
    55093, 118018, 121061, 123022, 125541, 143489, 145746
  ]::bigint[];
  found_count bigint;
  old_name_count bigint;
begin
  if cardinality(performance_tsukuba_ids) <> 41
    or (select count(distinct id) from unnest(performance_tsukuba_ids) as ids(id)) <> 41
  then
    raise exception 'lc_performances Tsukuba id list must contain 41 unique ids';
  end if;

  if cardinality(performance_kanazawa_ids) <> 12
    or (select count(distinct id) from unnest(performance_kanazawa_ids) as ids(id)) <> 12
  then
    raise exception 'lc_performances Kanazawa id list must contain 12 unique ids';
  end if;

  if exists (
    select 1
    from unnest(performance_tsukuba_ids) as tsukuba(id)
    join unnest(performance_kanazawa_ids) as kanazawa(id) using (id)
  ) then
    raise exception 'lc_performances Tsukuba and Kanazawa id lists overlap';
  end if;

  if cardinality(leg_tsukuba_ids) <> 45
    or (select count(distinct id) from unnest(leg_tsukuba_ids) as ids(id)) <> 45
  then
    raise exception 'lc_leg_splits Tsukuba id list must contain 45 unique ids';
  end if;

  if cardinality(leg_kanazawa_ids) <> 19
    or (select count(distinct id) from unnest(leg_kanazawa_ids) as ids(id)) <> 19
  then
    raise exception 'lc_leg_splits Kanazawa id list must contain 19 unique ids';
  end if;

  if exists (
    select 1
    from unnest(leg_tsukuba_ids) as tsukuba(id)
    join unnest(leg_kanazawa_ids) as kanazawa(id) using (id)
  ) then
    raise exception 'lc_leg_splits Tsukuba and Kanazawa id lists overlap';
  end if;

  select count(*), count(*) filter (where athlete_name = '鈴木健太')
  into found_count, old_name_count
  from public.lc_performances
  where id = any(performance_tsukuba_ids);

  if found_count <> 41 or old_name_count <> 41 then
    raise exception
      'lc_performances Tsukuba precondition mismatch: found=% old_name=% expected=41/41',
      found_count,
      old_name_count;
  end if;

  select count(*), count(*) filter (where athlete_name = '鈴木健太')
  into found_count, old_name_count
  from public.lc_performances
  where id = any(performance_kanazawa_ids);

  if found_count <> 12 or old_name_count <> 12 then
    raise exception
      'lc_performances Kanazawa precondition mismatch: found=% old_name=% expected=12/12',
      found_count,
      old_name_count;
  end if;

  select count(*), count(*) filter (where runner_key = '鈴木健太')
  into found_count, old_name_count
  from public.lc_leg_splits
  where id = any(leg_tsukuba_ids);

  if found_count <> 45 or old_name_count <> 45 then
    raise exception
      'lc_leg_splits Tsukuba precondition mismatch: found=% old_name=% expected=45/45',
      found_count,
      old_name_count;
  end if;

  select count(*), count(*) filter (where runner_key = '鈴木健太')
  into found_count, old_name_count
  from public.lc_leg_splits
  where id = any(leg_kanazawa_ids);

  if found_count <> 19 or old_name_count <> 19 then
    raise exception
      'lc_leg_splits Kanazawa precondition mismatch: found=% old_name=% expected=19/19',
      found_count,
      old_name_count;
  end if;
end
$$;

update public.lc_performances
set athlete_name = '鈴木健太（筑波大学）'
where id in (
  4692, 4693, 4695, 4696, 4697, 4698, 4699, 4700, 4701, 4702, 4704, 4706,
  4708, 4709, 4710, 4711, 4712, 36296, 37555, 38210, 39123, 39265, 40829, 45964,
  46448, 52447, 55013, 55515, 56405, 56683, 58357, 58854, 59690, 59720, 61415, 62318,
  104346, 104363, 105332, 106595, 109139
)
  and athlete_name = '鈴木健太';

update public.lc_performances
set athlete_name = '鈴木健太（金沢大学）'
where id in (
  4691, 4694, 4703, 4705, 4707, 39339, 40890, 45786, 56968, 71684, 75574, 78880
)
  and athlete_name = '鈴木健太';

update public.lc_leg_splits
set runner_key = '鈴木健太（筑波大学）'
where id in (
  1114, 2839, 3774, 4021, 4483, 4708, 5473, 6384, 7893, 8560, 8901, 10219,
  10690, 13442, 14729, 14798, 14848, 15482, 15881, 16073, 16131, 16782, 17094, 17134,
  18751, 19024, 19067, 20800, 21316, 118275, 119055, 122936, 123968, 124219, 125460, 126395,
  128251, 128817, 128845, 129044, 130422, 131400, 133046, 138549, 141447
)
  and runner_key = '鈴木健太';

update public.lc_leg_splits
set runner_key = '鈴木健太（金沢大学）'
where id in (
  5338, 6002, 11060, 17745, 18496, 23646, 32025, 39324, 42504, 43779, 47283, 54494,
  55093, 118018, 121061, 123022, 125541, 143489, 145746
)
  and runner_key = '鈴木健太';

-- 更新後検証。対象 id 群の実値だけを数え、対象外の同名行は件数に含めない。
do $$
declare
  performance_tsukuba_ids bigint[] := array[
    4692, 4693, 4695, 4696, 4697, 4698, 4699, 4700, 4701, 4702, 4704, 4706,
    4708, 4709, 4710, 4711, 4712, 36296, 37555, 38210, 39123, 39265, 40829, 45964,
    46448, 52447, 55013, 55515, 56405, 56683, 58357, 58854, 59690, 59720, 61415, 62318,
    104346, 104363, 105332, 106595, 109139
  ]::bigint[];
  performance_kanazawa_ids bigint[] := array[
    4691, 4694, 4703, 4705, 4707, 39339, 40890, 45786, 56968, 71684, 75574, 78880
  ]::bigint[];
  leg_tsukuba_ids bigint[] := array[
    1114, 2839, 3774, 4021, 4483, 4708, 5473, 6384, 7893, 8560, 8901, 10219,
    10690, 13442, 14729, 14798, 14848, 15482, 15881, 16073, 16131, 16782, 17094, 17134,
    18751, 19024, 19067, 20800, 21316, 118275, 119055, 122936, 123968, 124219, 125460, 126395,
    128251, 128817, 128845, 129044, 130422, 131400, 133046, 138549, 141447
  ]::bigint[];
  leg_kanazawa_ids bigint[] := array[
    5338, 6002, 11060, 17745, 18496, 23646, 32025, 39324, 42504, 43779, 47283, 54494,
    55093, 118018, 121061, 123022, 125541, 143489, 145746
  ]::bigint[];
  performance_tsukuba_count bigint;
  performance_kanazawa_count bigint;
  performance_old_name_count bigint;
  leg_tsukuba_count bigint;
  leg_kanazawa_count bigint;
  leg_old_name_count bigint;
begin
  select
    count(*) filter (
      where id = any(performance_tsukuba_ids)
        and athlete_name = '鈴木健太（筑波大学）'
    ),
    count(*) filter (
      where id = any(performance_kanazawa_ids)
        and athlete_name = '鈴木健太（金沢大学）'
    ),
    count(*) filter (where athlete_name = '鈴木健太')
  into
    performance_tsukuba_count,
    performance_kanazawa_count,
    performance_old_name_count
  from public.lc_performances
  where id = any(performance_tsukuba_ids || performance_kanazawa_ids);

  if performance_tsukuba_count <> 41
    or performance_kanazawa_count <> 12
    or performance_old_name_count <> 0
  then
    raise exception
      'lc_performances postcondition mismatch: tsukuba=% kanazawa=% old_name=% expected=41/12/0',
      performance_tsukuba_count,
      performance_kanazawa_count,
      performance_old_name_count;
  end if;

  select
    count(*) filter (
      where id = any(leg_tsukuba_ids)
        and runner_key = '鈴木健太（筑波大学）'
    ),
    count(*) filter (
      where id = any(leg_kanazawa_ids)
        and runner_key = '鈴木健太（金沢大学）'
    ),
    count(*) filter (where runner_key = '鈴木健太')
  into
    leg_tsukuba_count,
    leg_kanazawa_count,
    leg_old_name_count
  from public.lc_leg_splits
  where id = any(leg_tsukuba_ids || leg_kanazawa_ids);

  if leg_tsukuba_count <> 45
    or leg_kanazawa_count <> 19
    or leg_old_name_count <> 0
  then
    raise exception
      'lc_leg_splits postcondition mismatch: tsukuba=% kanazawa=% old_name=% expected=45/19/0',
      leg_tsukuba_count,
      leg_kanazawa_count,
      leg_old_name_count;
  end if;
end
$$;

-- 所属を判別できないため、次の lc_leg_splits 4件は意図的に旧名のまま据え置く。
-- id=38930  2024-08-18 第18回名椙大会(2日目) ME-Y             所属欄が空
-- id=140312 2024-09-29 クラブカップ7人リレー2024 3E          リレー・relay-result-list に該当なし
-- id=143029 2026-08-30 クラブカップ7人リレー2026 1走オープン リレー・9:00発走のチーム不明
-- id=145414 2026-08-30 クラブカップ7人リレー2026 12BD        同上（同一走の別クラス掲載）

-- likes は既存票がどちらの人物へのものか判定できないため触らない。旧名を指したまま孤立する。
-- athletes / athlete_appearances はこの SQL では変更しない。
-- scripts/import-to-db.ts を丸ごと実行してはいけない。
-- public/data/lapcenter-runners.json は 2026-03-01 の古いスナップショットであり、丸ごと実行すると
-- lc_performances に半年前の行を再投入し、race_type の訂正を巻き戻すためである。
-- athlete のみを投入する経路を別途用意すること。

commit;

-- ロールバック用 SQL（必要時に以下のコメントを外して実行する）。
-- 名前だけを条件にせず同じ id を明示するため、移行後に cron が作った新名行は巻き戻さない。
-- begin;
--
-- select id
-- from public.lc_performances
-- where id in (
--   4692, 4693, 4695, 4696, 4697, 4698, 4699, 4700, 4701, 4702, 4704, 4706,
--   4708, 4709, 4710, 4711, 4712, 36296, 37555, 38210, 39123, 39265, 40829, 45964,
--   46448, 52447, 55013, 55515, 56405, 56683, 58357, 58854, 59690, 59720, 61415, 62318,
--   104346, 104363, 105332, 106595, 109139,
--   4691, 4694, 4703, 4705, 4707, 39339, 40890, 45786, 56968, 71684, 75574, 78880
-- )
-- order by id
-- for update;
--
-- select id
-- from public.lc_leg_splits
-- where id in (
--   1114, 2839, 3774, 4021, 4483, 4708, 5473, 6384, 7893, 8560, 8901, 10219,
--   10690, 13442, 14729, 14798, 14848, 15482, 15881, 16073, 16131, 16782, 17094, 17134,
--   18751, 19024, 19067, 20800, 21316, 118275, 119055, 122936, 123968, 124219, 125460, 126395,
--   128251, 128817, 128845, 129044, 130422, 131400, 133046, 138549, 141447,
--   5338, 6002, 11060, 17745, 18496, 23646, 32025, 39324, 42504, 43779, 47283, 54494,
--   55093, 118018, 121061, 123022, 125541, 143489, 145746
-- )
-- order by id
-- for update;
--
-- do $$
-- declare
--   performance_tsukuba_ids bigint[] := array[
--     4692, 4693, 4695, 4696, 4697, 4698, 4699, 4700, 4701, 4702, 4704, 4706,
--     4708, 4709, 4710, 4711, 4712, 36296, 37555, 38210, 39123, 39265, 40829, 45964,
--     46448, 52447, 55013, 55515, 56405, 56683, 58357, 58854, 59690, 59720, 61415, 62318,
--     104346, 104363, 105332, 106595, 109139
--   ]::bigint[];
--   performance_kanazawa_ids bigint[] := array[
--     4691, 4694, 4703, 4705, 4707, 39339, 40890, 45786, 56968, 71684, 75574, 78880
--   ]::bigint[];
--   leg_tsukuba_ids bigint[] := array[
--     1114, 2839, 3774, 4021, 4483, 4708, 5473, 6384, 7893, 8560, 8901, 10219,
--     10690, 13442, 14729, 14798, 14848, 15482, 15881, 16073, 16131, 16782, 17094, 17134,
--     18751, 19024, 19067, 20800, 21316, 118275, 119055, 122936, 123968, 124219, 125460, 126395,
--     128251, 128817, 128845, 129044, 130422, 131400, 133046, 138549, 141447
--   ]::bigint[];
--   leg_kanazawa_ids bigint[] := array[
--     5338, 6002, 11060, 17745, 18496, 23646, 32025, 39324, 42504, 43779, 47283, 54494,
--     55093, 118018, 121061, 123022, 125541, 143489, 145746
--   ]::bigint[];
--   performance_tsukuba_count bigint;
--   performance_kanazawa_count bigint;
--   leg_tsukuba_count bigint;
--   leg_kanazawa_count bigint;
-- begin
--   select
--     count(*) filter (where id = any(performance_tsukuba_ids) and athlete_name = '鈴木健太（筑波大学）'),
--     count(*) filter (where id = any(performance_kanazawa_ids) and athlete_name = '鈴木健太（金沢大学）')
--   into performance_tsukuba_count, performance_kanazawa_count
--   from public.lc_performances
--   where id = any(performance_tsukuba_ids || performance_kanazawa_ids);
--
--   if performance_tsukuba_count <> 41 or performance_kanazawa_count <> 12 then
--     raise exception
--       'lc_performances rollback precondition mismatch: tsukuba=% kanazawa=% expected=41/12',
--       performance_tsukuba_count,
--       performance_kanazawa_count;
--   end if;
--
--   select
--     count(*) filter (where id = any(leg_tsukuba_ids) and runner_key = '鈴木健太（筑波大学）'),
--     count(*) filter (where id = any(leg_kanazawa_ids) and runner_key = '鈴木健太（金沢大学）')
--   into leg_tsukuba_count, leg_kanazawa_count
--   from public.lc_leg_splits
--   where id = any(leg_tsukuba_ids || leg_kanazawa_ids);
--
--   if leg_tsukuba_count <> 45 or leg_kanazawa_count <> 19 then
--     raise exception
--       'lc_leg_splits rollback precondition mismatch: tsukuba=% kanazawa=% expected=45/19',
--       leg_tsukuba_count,
--       leg_kanazawa_count;
--   end if;
-- end
-- $$;
--
-- update public.lc_performances
-- set athlete_name = '鈴木健太'
-- where id in (
--   4692, 4693, 4695, 4696, 4697, 4698, 4699, 4700, 4701, 4702, 4704, 4706,
--   4708, 4709, 4710, 4711, 4712, 36296, 37555, 38210, 39123, 39265, 40829, 45964,
--   46448, 52447, 55013, 55515, 56405, 56683, 58357, 58854, 59690, 59720, 61415, 62318,
--   104346, 104363, 105332, 106595, 109139
-- )
--   and athlete_name = '鈴木健太（筑波大学）';
--
-- update public.lc_performances
-- set athlete_name = '鈴木健太'
-- where id in (
--   4691, 4694, 4703, 4705, 4707, 39339, 40890, 45786, 56968, 71684, 75574, 78880
-- )
--   and athlete_name = '鈴木健太（金沢大学）';
--
-- update public.lc_leg_splits
-- set runner_key = '鈴木健太'
-- where id in (
--   1114, 2839, 3774, 4021, 4483, 4708, 5473, 6384, 7893, 8560, 8901, 10219,
--   10690, 13442, 14729, 14798, 14848, 15482, 15881, 16073, 16131, 16782, 17094, 17134,
--   18751, 19024, 19067, 20800, 21316, 118275, 119055, 122936, 123968, 124219, 125460, 126395,
--   128251, 128817, 128845, 129044, 130422, 131400, 133046, 138549, 141447
-- )
--   and runner_key = '鈴木健太（筑波大学）';
--
-- update public.lc_leg_splits
-- set runner_key = '鈴木健太'
-- where id in (
--   5338, 6002, 11060, 17745, 18496, 23646, 32025, 39324, 42504, 43779, 47283, 54494,
--   55093, 118018, 121061, 123022, 125541, 143489, 145746
-- )
--   and runner_key = '鈴木健太（金沢大学）';
--
-- do $$
-- declare
--   performance_tsukuba_ids bigint[] := array[
--     4692, 4693, 4695, 4696, 4697, 4698, 4699, 4700, 4701, 4702, 4704, 4706,
--     4708, 4709, 4710, 4711, 4712, 36296, 37555, 38210, 39123, 39265, 40829, 45964,
--     46448, 52447, 55013, 55515, 56405, 56683, 58357, 58854, 59690, 59720, 61415, 62318,
--     104346, 104363, 105332, 106595, 109139
--   ]::bigint[];
--   performance_kanazawa_ids bigint[] := array[
--     4691, 4694, 4703, 4705, 4707, 39339, 40890, 45786, 56968, 71684, 75574, 78880
--   ]::bigint[];
--   leg_tsukuba_ids bigint[] := array[
--     1114, 2839, 3774, 4021, 4483, 4708, 5473, 6384, 7893, 8560, 8901, 10219,
--     10690, 13442, 14729, 14798, 14848, 15482, 15881, 16073, 16131, 16782, 17094, 17134,
--     18751, 19024, 19067, 20800, 21316, 118275, 119055, 122936, 123968, 124219, 125460, 126395,
--     128251, 128817, 128845, 129044, 130422, 131400, 133046, 138549, 141447
--   ]::bigint[];
--   leg_kanazawa_ids bigint[] := array[
--     5338, 6002, 11060, 17745, 18496, 23646, 32025, 39324, 42504, 43779, 47283, 54494,
--     55093, 118018, 121061, 123022, 125541, 143489, 145746
--   ]::bigint[];
--   performance_tsukuba_count bigint;
--   performance_kanazawa_count bigint;
--   performance_new_name_count bigint;
--   leg_tsukuba_count bigint;
--   leg_kanazawa_count bigint;
--   leg_new_name_count bigint;
-- begin
--   select
--     count(*) filter (where id = any(performance_tsukuba_ids) and athlete_name = '鈴木健太'),
--     count(*) filter (where id = any(performance_kanazawa_ids) and athlete_name = '鈴木健太'),
--     count(*) filter (where athlete_name in ('鈴木健太（筑波大学）', '鈴木健太（金沢大学）'))
--   into performance_tsukuba_count, performance_kanazawa_count, performance_new_name_count
--   from public.lc_performances
--   where id = any(performance_tsukuba_ids || performance_kanazawa_ids);
--
--   if performance_tsukuba_count <> 41
--     or performance_kanazawa_count <> 12
--     or performance_new_name_count <> 0
--   then
--     raise exception
--       'lc_performances rollback postcondition mismatch: tsukuba=% kanazawa=% new_name=% expected=41/12/0',
--       performance_tsukuba_count,
--       performance_kanazawa_count,
--       performance_new_name_count;
--   end if;
--
--   select
--     count(*) filter (where id = any(leg_tsukuba_ids) and runner_key = '鈴木健太'),
--     count(*) filter (where id = any(leg_kanazawa_ids) and runner_key = '鈴木健太'),
--     count(*) filter (where runner_key in ('鈴木健太（筑波大学）', '鈴木健太（金沢大学）'))
--   into leg_tsukuba_count, leg_kanazawa_count, leg_new_name_count
--   from public.lc_leg_splits
--   where id = any(leg_tsukuba_ids || leg_kanazawa_ids);
--
--   if leg_tsukuba_count <> 45
--     or leg_kanazawa_count <> 19
--     or leg_new_name_count <> 0
--   then
--     raise exception
--       'lc_leg_splits rollback postcondition mismatch: tsukuba=% kanazawa=% new_name=% expected=45/19/0',
--       leg_tsukuba_count,
--       leg_kanazawa_count,
--       leg_new_name_count;
--   end if;
-- end
-- $$;
--
-- commit;
