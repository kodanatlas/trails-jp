-- Cronジョブ実行ログ（稼働監視用）
CREATE TABLE cron_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name text NOT NULL,
  status text NOT NULL,
  result jsonb,
  duration_ms integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cron_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON cron_log FOR SELECT USING (true);
