-- cron_log の履歴クエリ高速化用 複合インデックス
CREATE INDEX IF NOT EXISTS cron_log_job_created_idx
  ON cron_log (job_name, created_at DESC);

-- 通知デダブ用テーブル: 同一エラーを24h内に複数通送らないための記録
CREATE TABLE IF NOT EXISTS cron_notification_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name text NOT NULL,
  error_signature text NOT NULL,
  sent_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cron_notification_log_lookup_idx
  ON cron_notification_log (job_name, error_signature, sent_at DESC);

ALTER TABLE cron_notification_log ENABLE ROW LEVEL SECURITY;
-- ポリシーを付与しない = anon / authenticated は全拒否、service_role だけバイパスで読み書き可能
