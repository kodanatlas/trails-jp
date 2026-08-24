-- ============================================================
-- 本番 pg_cron ジョブの baseline（2026-08-24 実測）
-- ============================================================
--
-- jobid=1 / jobname=db-health-sample / schedule=*/5 * * * * /
-- command=select sample_db_health() / username=postgres / active=true
-- 新環境で pg_cron が未導入の場合に失敗しないよう、スキーマ baseline から分けて
-- 拡張の存在を確認してから登録する。
--
-- 3 引数の cron.schedule はジョブ所有者を実行ロール（current_user）にする。
-- 本番のジョブ所有者は postgres なので、新環境でも postgres で流すこと。
-- named job の競合キーは (jobname, username) であり、別ロールで流すと同名の
-- 別ジョブが増えて二重実行になる。
-- cron.schedule の upsert が更新するのは schedule / command / database だけで
-- active は戻らないため、cron スキーマの alter_job 関数で明示的に有効化している。
-- 以上は 2026-08-24 の二次レビューでの指摘に基づく修正である。

do $$
declare
  v_jobid bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select cron.schedule('db-health-sample', '*/5 * * * *', 'select sample_db_health()')
      into v_jobid;
    perform cron.alter_job(v_jobid, active := true);
  else
    raise notice 'pg_cron not installed; skipping db-health-sample schedule';
  end if;
end $$;
