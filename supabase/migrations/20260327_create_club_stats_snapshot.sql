-- クラブ統計の月次スナップショット（前月比・前年比算出用）
CREATE TABLE club_stats_snapshot (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  month text NOT NULL UNIQUE,
  stats jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE club_stats_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON club_stats_snapshot FOR SELECT USING (true);
