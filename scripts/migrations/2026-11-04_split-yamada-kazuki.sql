-- 山田和輝（KOLC／神戸大学／東北大学）の同姓同名分離。
-- 所属・リレーのチーム名・出走時刻の重なりで全行を人が監査し、その分類結果を主キー id で固定した
-- 一回限りのデータ移行（docs/plans/2026-11-04_homonym-yamada-kazuki.md）。SQL 内では分類を再計算しない。
-- 判定不能の lc_leg_splits 7 行（CC7 2023・阪神奈2025・東慶工対抗戦2024・東京科学大スプリント2026）は対象外＝旧名のまま。
--
-- 実行: cron（sync-events / sync-entries / sync-lapcenter）が動いていない時間帯に、
--   ~/bin/sbq < scripts/migrations/2026-11-04_split-yamada-kazuki.sql
-- 想定件数: lc_performances 74（KOLC 72・神戸大学 2）、
--           lc_leg_splits 115（KOLC 101・神戸大学 8・東北大学 6）

begin;

create temporary table yk_split (tbl text not null, id bigint not null, new_name text not null, primary key (tbl, id)) on commit drop;

insert into yk_split (tbl, id, new_name) values
  ('perf', 21863, '山田和輝（KOLC）'),
  ('perf', 21864, '山田和輝（KOLC）'),
  ('perf', 21865, '山田和輝（KOLC）'),
  ('perf', 21866, '山田和輝（KOLC）'),
  ('perf', 21867, '山田和輝（KOLC）'),
  ('perf', 21868, '山田和輝（KOLC）'),
  ('perf', 21869, '山田和輝（KOLC）'),
  ('perf', 21870, '山田和輝（KOLC）'),
  ('perf', 21871, '山田和輝（KOLC）'),
  ('perf', 21872, '山田和輝（KOLC）'),
  ('perf', 21873, '山田和輝（KOLC）'),
  ('perf', 21874, '山田和輝（KOLC）'),
  ('perf', 21875, '山田和輝（KOLC）'),
  ('perf', 21876, '山田和輝（KOLC）'),
  ('perf', 21877, '山田和輝（KOLC）'),
  ('perf', 21878, '山田和輝（KOLC）'),
  ('perf', 21879, '山田和輝（KOLC）'),
  ('perf', 21880, '山田和輝（KOLC）'),
  ('perf', 21881, '山田和輝（KOLC）'),
  ('perf', 21882, '山田和輝（KOLC）'),
  ('perf', 21883, '山田和輝（KOLC）'),
  ('perf', 21884, '山田和輝（KOLC）'),
  ('perf', 21885, '山田和輝（KOLC）'),
  ('perf', 21886, '山田和輝（KOLC）'),
  ('perf', 36712, '山田和輝（KOLC）'),
  ('perf', 37125, '山田和輝（KOLC）'),
  ('perf', 39304, '山田和輝（KOLC）'),
  ('perf', 39851, '山田和輝（KOLC）'),
  ('perf', 40555, '山田和輝（KOLC）'),
  ('perf', 40857, '山田和輝（KOLC）'),
  ('perf', 44383, '山田和輝（KOLC）'),
  ('perf', 52434, '山田和輝（KOLC）'),
  ('perf', 54674, '山田和輝（KOLC）'),
  ('perf', 55247, '山田和輝（KOLC）'),
  ('perf', 56776, '山田和輝（KOLC）'),
  ('perf', 61301, '山田和輝（KOLC）'),
  ('perf', 64251, '山田和輝（KOLC）'),
  ('perf', 66127, '山田和輝（KOLC）'),
  ('perf', 66156, '山田和輝（KOLC）'),
  ('perf', 66160, '山田和輝（KOLC）'),
  ('perf', 71506, '山田和輝（KOLC）'),
  ('perf', 71723, '山田和輝（KOLC）'),
  ('perf', 72849, '山田和輝（KOLC）'),
  ('perf', 72875, '山田和輝（KOLC）'),
  ('perf', 73198, '山田和輝（KOLC）'),
  ('perf', 73804, '山田和輝（KOLC）'),
  ('perf', 75569, '山田和輝（KOLC）'),
  ('perf', 75665, '山田和輝（KOLC）'),
  ('perf', 75805, '山田和輝（KOLC）'),
  ('perf', 76194, '山田和輝（KOLC）'),
  ('perf', 76632, '山田和輝（KOLC）'),
  ('perf', 77159, '山田和輝（KOLC）'),
  ('perf', 78805, '山田和輝（KOLC）'),
  ('perf', 79050, '山田和輝（KOLC）'),
  ('perf', 79414, '山田和輝（KOLC）'),
  ('perf', 79932, '山田和輝（KOLC）'),
  ('perf', 82323, '山田和輝（KOLC）'),
  ('perf', 95728, '山田和輝（KOLC）'),
  ('perf', 102167, '山田和輝（KOLC）'),
  ('perf', 105381, '山田和輝（KOLC）'),
  ('perf', 105437, '山田和輝（KOLC）'),
  ('perf', 105511, '山田和輝（KOLC）'),
  ('perf', 108133, '山田和輝（KOLC）'),
  ('perf', 108378, '山田和輝（KOLC）'),
  ('perf', 110992, '山田和輝（KOLC）'),
  ('perf', 111005, '山田和輝（KOLC）'),
  ('perf', 114978, '山田和輝（KOLC）'),
  ('perf', 114988, '山田和輝（KOLC）'),
  ('perf', 115418, '山田和輝（KOLC）'),
  ('perf', 118708, '山田和輝（KOLC）'),
  ('perf', 123970, '山田和輝（KOLC）'),
  ('perf', 124697, '山田和輝（KOLC）'),
  ('perf', 122730, '山田和輝（神戸大学）'),
  ('perf', 123188, '山田和輝（神戸大学）'),
  ('leg', 178, '山田和輝（KOLC）'),
  ('leg', 2861, '山田和輝（KOLC）'),
  ('leg', 3710, '山田和輝（KOLC）'),
  ('leg', 4001, '山田和輝（KOLC）'),
  ('leg', 4437, '山田和輝（KOLC）'),
  ('leg', 4657, '山田和輝（KOLC）'),
  ('leg', 4929, '山田和輝（KOLC）'),
  ('leg', 5125, '山田和輝（KOLC）'),
  ('leg', 6042, '山田和輝（KOLC）'),
  ('leg', 7245, '山田和輝（KOLC）'),
  ('leg', 7454, '山田和輝（KOLC）'),
  ('leg', 8214, '山田和輝（KOLC）'),
  ('leg', 8847, '山田和輝（KOLC）'),
  ('leg', 9151, '山田和輝（KOLC）'),
  ('leg', 9152, '山田和輝（KOLC）'),
  ('leg', 10816, '山田和輝（KOLC）'),
  ('leg', 14949, '山田和輝（KOLC）'),
  ('leg', 16939, '山田和輝（KOLC）'),
  ('leg', 16940, '山田和輝（KOLC）'),
  ('leg', 17207, '山田和輝（KOLC）'),
  ('leg', 18359, '山田和輝（KOLC）'),
  ('leg', 18840, '山田和輝（KOLC）'),
  ('leg', 21493, '山田和輝（KOLC）'),
  ('leg', 21603, '山田和輝（KOLC）'),
  ('leg', 21751, '山田和輝（KOLC）'),
  ('leg', 21919, '山田和輝（KOLC）'),
  ('leg', 24516, '山田和輝（KOLC）'),
  ('leg', 25383, '山田和輝（KOLC）'),
  ('leg', 27114, '山田和輝（KOLC）'),
  ('leg', 28146, '山田和輝（KOLC）'),
  ('leg', 28220, '山田和輝（KOLC）'),
  ('leg', 28229, '山田和輝（KOLC）'),
  ('leg', 28624, '山田和輝（KOLC）'),
  ('leg', 31773, '山田和輝（KOLC）'),
  ('leg', 38195, '山田和輝（KOLC）'),
  ('leg', 38956, '山田和輝（KOLC）'),
  ('leg', 39394, '山田和輝（KOLC）'),
  ('leg', 41617, '山田和輝（KOLC）'),
  ('leg', 41693, '山田和輝（KOLC）'),
  ('leg', 41859, '山田和輝（KOLC）'),
  ('leg', 42584, '山田和輝（KOLC）'),
  ('leg', 43861, '山田和輝（KOLC）'),
  ('leg', 47274, '山田和輝（KOLC）'),
  ('leg', 47520, '山田和輝（KOLC）'),
  ('leg', 47878, '山田和輝（KOLC）'),
  ('leg', 48602, '山田和輝（KOLC）'),
  ('leg', 49592, '山田和輝（KOLC）'),
  ('leg', 51022, '山田和輝（KOLC）'),
  ('leg', 51266, '山田和輝（KOLC）'),
  ('leg', 54054, '山田和輝（KOLC）'),
  ('leg', 54931, '山田和輝（KOLC）'),
  ('leg', 55594, '山田和輝（KOLC）'),
  ('leg', 56335, '山田和輝（KOLC）'),
  ('leg', 56597, '山田和輝（KOLC）'),
  ('leg', 57661, '山田和輝（KOLC）'),
  ('leg', 63921, '山田和輝（KOLC）'),
  ('leg', 106826, '山田和輝（KOLC）'),
  ('leg', 117911, '山田和輝（KOLC）'),
  ('leg', 119372, '山田和輝（KOLC）'),
  ('leg', 120118, '山田和輝（KOLC）'),
  ('leg', 121352, '山田和輝（KOLC）'),
  ('leg', 122982, '山田和輝（KOLC）'),
  ('leg', 124314, '山田和輝（KOLC）'),
  ('leg', 124593, '山田和輝（KOLC）'),
  ('leg', 125504, '山田和輝（KOLC）'),
  ('leg', 129901, '山田和輝（KOLC）'),
  ('leg', 130491, '山田和輝（KOLC）'),
  ('leg', 130580, '山田和輝（KOLC）'),
  ('leg', 130679, '山田和輝（KOLC）'),
  ('leg', 130774, '山田和輝（KOLC）'),
  ('leg', 132954, '山田和輝（KOLC）'),
  ('leg', 138084, '山田和輝（KOLC）'),
  ('leg', 138517, '山田和輝（KOLC）'),
  ('leg', 139648, '山田和輝（KOLC）'),
  ('leg', 140224, '山田和輝（KOLC）'),
  ('leg', 141163, '山田和輝（KOLC）'),
  ('leg', 142525, '山田和輝（KOLC）'),
  ('leg', 143531, '山田和輝（KOLC）'),
  ('leg', 143952, '山田和輝（KOLC）'),
  ('leg', 144331, '山田和輝（KOLC）'),
  ('leg', 144855, '山田和輝（KOLC）'),
  ('leg', 145422, '山田和輝（KOLC）'),
  ('leg', 145766, '山田和輝（KOLC）'),
  ('leg', 146172, '山田和輝（KOLC）'),
  ('leg', 146692, '山田和輝（KOLC）'),
  ('leg', 153476, '山田和輝（KOLC）'),
  ('leg', 153795, '山田和輝（KOLC）'),
  ('leg', 153872, '山田和輝（KOLC）'),
  ('leg', 161196, '山田和輝（KOLC）'),
  ('leg', 164724, '山田和輝（KOLC）'),
  ('leg', 164738, '山田和輝（KOLC）'),
  ('leg', 164765, '山田和輝（KOLC）'),
  ('leg', 166236, '山田和輝（KOLC）'),
  ('leg', 178524, '山田和輝（KOLC）'),
  ('leg', 179728, '山田和輝（KOLC）'),
  ('leg', 180578, '山田和輝（KOLC）'),
  ('leg', 181413, '山田和輝（KOLC）'),
  ('leg', 182449, '山田和輝（KOLC）'),
  ('leg', 183312, '山田和輝（KOLC）'),
  ('leg', 184409, '山田和輝（KOLC）'),
  ('leg', 185334, '山田和輝（KOLC）'),
  ('leg', 120912, '山田和輝（神戸大学）'),
  ('leg', 122020, '山田和輝（神戸大学）'),
  ('leg', 122215, '山田和輝（神戸大学）'),
  ('leg', 180119, '山田和輝（神戸大学）'),
  ('leg', 180953, '山田和輝（神戸大学）'),
  ('leg', 181797, '山田和輝（神戸大学）'),
  ('leg', 182997, '山田和輝（神戸大学）'),
  ('leg', 183796, '山田和輝（神戸大学）'),
  ('leg', 31975, '山田和輝（東北大学）'),
  ('leg', 59313, '山田和輝（東北大学）'),
  ('leg', 70425, '山田和輝（東北大学）'),
  ('leg', 76888, '山田和輝（東北大学）'),
  ('leg', 158380, '山田和輝（東北大学）'),
  ('leg', 158925, '山田和輝（東北大学）');

-- 対象行を主キー順にロック
select id from public.lc_performances where id in (select id from yk_split where tbl = 'perf') order by id for update;
select id from public.lc_leg_splits where id in (select id from yk_split where tbl = 'leg') order by id for update;

-- 更新前検証: 件数と、全行がまだ旧名であること
do $$
declare n_found bigint; n_old bigint;
begin
  if (select count(*) from yk_split where tbl = 'perf') <> 74 or (select count(*) from yk_split where tbl = 'leg') <> 115 then
    raise exception 'yk_split の件数が想定と違う';
  end if;
  select count(*), count(*) filter (where p.athlete_name = '山田和輝') into n_found, n_old
  from public.lc_performances p join yk_split s on s.tbl = 'perf' and s.id = p.id;
  if n_found <> 74 or n_old <> 74 then
    raise exception 'lc_performances precondition mismatch: found=% old_name=% expected=74/74', n_found, n_old;
  end if;
  select count(*), count(*) filter (where l.runner_key = '山田和輝') into n_found, n_old
  from public.lc_leg_splits l join yk_split s on s.tbl = 'leg' and s.id = l.id;
  if n_found <> 115 or n_old <> 115 then
    raise exception 'lc_leg_splits precondition mismatch: found=% old_name=% expected=115/115', n_found, n_old;
  end if;
end
$$;

update public.lc_performances p set athlete_name = s.new_name
from yk_split s where s.tbl = 'perf' and s.id = p.id and p.athlete_name = '山田和輝';

update public.lc_leg_splits l set runner_key = s.new_name
from yk_split s where s.tbl = 'leg' and s.id = l.id and l.runner_key = '山田和輝';

-- 更新後検証: 全対象行が新名になったこと
do $$
begin
  if (select count(*) from public.lc_performances p join yk_split s on s.tbl = 'perf' and s.id = p.id and p.athlete_name = s.new_name) <> 74 then
    raise exception 'lc_performances postcondition mismatch';
  end if;
  if (select count(*) from public.lc_leg_splits l join yk_split s on s.tbl = 'leg' and s.id = l.id and l.runner_key = s.new_name) <> 115 then
    raise exception 'lc_leg_splits postcondition mismatch';
  end if;
end
$$;

commit;

-- 結果の確認
select 'perf' tbl, athlete_name name, count(*) from public.lc_performances
where athlete_name like '山田和輝%' group by 2
union all
select 'leg', runner_key, count(*) from public.lc_leg_splits
where runner_key like '山田和輝%' group by 2
order by 1, 2;
