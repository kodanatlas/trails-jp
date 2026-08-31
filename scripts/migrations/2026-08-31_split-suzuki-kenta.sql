-- 鈴木健太（金沢大学／筑波大学）の同姓同名分離。
-- 2026-08-31 実測値を固定した一回限りのデータ移行。
-- 再実行時を含め、分類件数が期待値と異なる場合は例外を投げてトランザクション全体を戻す。

begin;

-- 更新前の物理行と分類結果を固定する。lc_performances は club を持たないため、(runner_key, event_date, class_name) で lc_leg_splits と結ぶ。
-- event_name は JOY 正式名と LapCenter 短縮名という別系統の名前を持つため、結合には使わない。
create temporary table suzuki_kenta_performance_classification
on commit drop
as
select
  p.ctid as row_tid,
  exists (
    select 1
    from public.lc_leg_splits as l
    where l.runner_key = regexp_replace(p.athlete_name, '\s+', '', 'g')
      and l.event_date = p.event_date
      and l.class_name is not distinct from p.class_name
      and (
        l.club like '%筑波大学%'
        or l.club like '%筑波大%'
        or (l.lc_event_id = 9435 and l.lc_class_id = 11 and l.runner_index = 54)
        or (l.lc_event_id = 9435 and l.lc_class_id = 7 and l.runner_index = 65)
      )
  ) as is_tsukuba,
  exists (
    select 1
    from public.lc_leg_splits as l
    where l.runner_key = regexp_replace(p.athlete_name, '\s+', '', 'g')
      and l.event_date = p.event_date
      and l.class_name is not distinct from p.class_name
      and (
        l.club like '%金沢大学%'
        or l.club like '%金大OLC%'
        or (l.lc_event_id = 9983 and l.lc_class_id in (29, 16))
      )
  ) as is_kanazawa
from public.lc_performances as p
where p.athlete_name = '鈴木健太';

create temporary table suzuki_kenta_leg_classification
on commit drop
as
select
  l.ctid as row_tid,
  (
    coalesce(l.club like '%筑波大学%', false)
    or coalesce(l.club like '%筑波大%', false)
    or (l.lc_event_id = 9435 and l.lc_class_id = 11 and l.runner_index = 54)
    or (l.lc_event_id = 9435 and l.lc_class_id = 7 and l.runner_index = 65)
  ) as is_tsukuba,
  (
    coalesce(l.club like '%金沢大学%', false)
    or coalesce(l.club like '%金大OLC%', false)
    or (l.lc_event_id = 9983 and l.lc_class_id in (29, 16))
  ) as is_kanazawa
from public.lc_leg_splits as l
where l.runner_key = '鈴木健太';

-- 分類件数が一つでも実測値と異なれば、後続の UPDATE より前に中断する。
do $$
declare
  performance_tsukuba bigint;
  performance_kanazawa bigint;
  performance_total bigint;
  performance_both bigint;
  performance_unclassified bigint;
  leg_tsukuba bigint;
  leg_kanazawa bigint;
  leg_unchanged bigint;
  leg_total bigint;
  leg_both bigint;
begin
  select
    count(*) filter (where is_tsukuba),
    count(*) filter (where is_kanazawa),
    count(*),
    count(*) filter (where is_tsukuba and is_kanazawa),
    count(*) filter (where not is_tsukuba and not is_kanazawa)
  into
    performance_tsukuba,
    performance_kanazawa,
    performance_total,
    performance_both,
    performance_unclassified
  from suzuki_kenta_performance_classification;

  select
    count(*) filter (where is_tsukuba),
    count(*) filter (where is_kanazawa),
    count(*) filter (where not is_tsukuba and not is_kanazawa),
    count(*),
    count(*) filter (where is_tsukuba and is_kanazawa)
  into
    leg_tsukuba,
    leg_kanazawa,
    leg_unchanged,
    leg_total,
    leg_both
  from suzuki_kenta_leg_classification;

  if performance_tsukuba <> 41
    or performance_kanazawa <> 12
    or performance_total <> 53
    or performance_both <> 0
    or performance_unclassified <> 0
  then
    raise exception
      'lc_performances classification mismatch: tsukuba=% kanazawa=% total=% both=% unclassified=% (expected 41/12/53/0/0)',
      performance_tsukuba,
      performance_kanazawa,
      performance_total,
      performance_both,
      performance_unclassified;
  end if;

  if leg_tsukuba <> 45
    or leg_kanazawa <> 19
    or leg_unchanged <> 4
    or leg_total <> 68
    or leg_both <> 0
  then
    raise exception
      'lc_leg_splits classification mismatch: tsukuba=% kanazawa=% unchanged=% total=% both=% (expected 45/19/4/68/0)',
      leg_tsukuba,
      leg_kanazawa,
      leg_unchanged,
      leg_total,
      leg_both;
  end if;
end
$$;

update public.lc_performances as p
set athlete_name = case
  when classification.is_tsukuba then '鈴木健太（筑波大学）'
  when classification.is_kanazawa then '鈴木健太（金沢大学）'
end
from suzuki_kenta_performance_classification as classification
where p.ctid = classification.row_tid
  and (classification.is_tsukuba or classification.is_kanazawa);

update public.lc_leg_splits as l
set runner_key = case
  when classification.is_tsukuba then '鈴木健太（筑波大学）'
  when classification.is_kanazawa then '鈴木健太（金沢大学）'
end
from suzuki_kenta_leg_classification as classification
where l.ctid = classification.row_tid
  and (classification.is_tsukuba or classification.is_kanazawa);

-- athletes / athlete_appearances はこの SQL では変更しない。
-- athletes の旧統合行は、ランキング再生成後の import-to-db が新名2行を upsert しても自動削除されない。
-- athlete_appearances は athlete_id に従属し、旧統合行の appearance を安全に2分割できないため、
-- 新名2行の投入・件数照合後に旧統合行を削除するかは別途判断する。現時点では可逆性を優先して残す。
-- likes は既存票の帰属を判定できないため一切変更しない。旧名を指したまま孤立させる。

commit;

-- ロールバック用 SQL（必要時にコメントを外して実行する）。
-- begin;
-- select count(*) from public.lc_performances where athlete_name = '鈴木健太（筑波大学）'; -- 期待 41 件
-- update public.lc_performances set athlete_name = '鈴木健太' where athlete_name = '鈴木健太（筑波大学）';
-- select count(*) from public.lc_performances where athlete_name = '鈴木健太（金沢大学）'; -- 期待 12 件
-- update public.lc_performances set athlete_name = '鈴木健太' where athlete_name = '鈴木健太（金沢大学）';
-- select count(*) from public.lc_leg_splits where runner_key = '鈴木健太（筑波大学）'; -- 期待 45 件
-- update public.lc_leg_splits set runner_key = '鈴木健太' where runner_key = '鈴木健太（筑波大学）';
-- select count(*) from public.lc_leg_splits where runner_key = '鈴木健太（金沢大学）'; -- 期待 19 件
-- update public.lc_leg_splits set runner_key = '鈴木健太' where runner_key = '鈴木健太（金沢大学）';
-- commit;
