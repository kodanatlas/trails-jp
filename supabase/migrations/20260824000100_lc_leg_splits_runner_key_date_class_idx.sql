-- ============================================================
-- マイグレーション記録: lc_leg_splits の複合索引
-- 記録日: 2026-08-24
-- ============================================================
--
-- 背景:
--   2026-08-24 のカバレッジ突合で、本番に存在する一方、どのマイグレーションでも
--   作られていない索引として検出された。
--   2026-08-24 に pg_indexes から実測した本番定義は次のとおり:
--     CREATE INDEX lc_leg_splits_runner_key_date_class_idx ON public.lc_leg_splits USING btree (runner_key, event_date, class_name)
--
-- 位置づけ:
--   この索引自体は以前から本番に存在しており、このファイルは新規作成ではなく記録である。
--   したがって本番へは適用せず、マイグレーション台帳へ applied として登録するだけとする。
--   台帳への登録は呼び出し側が行う。
--
-- 追加時期について:
--   get_lc_perf_with_rank(p_name) の LEFT JOIN LATERAL における検索条件の 3 列
--   （runner_key、event_date、class_name）と一致するため、2026-07-08 前後に手で
--   追加されたものと推測される。これは実測で確認された由来ではない。
--

create index if not exists lc_leg_splits_runner_key_date_class_idx
  on public.lc_leg_splits (runner_key, event_date, class_name);
