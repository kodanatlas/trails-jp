-- 分析システム用テーブル（Phase 1: DB移行）
-- athletes + athlete_appearances + lc_performances

-- ============================================================
-- 選手マスタ（athlete-index.json から移行）
-- ============================================================
CREATE TABLE public.athletes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  clubs TEXT[] NOT NULL DEFAULT '{}',
  best_rank INT,
  avg_total_points NUMERIC(8,1),
  forest_count INT DEFAULT 0,
  sprint_count INT DEFAULT 0,
  athlete_type TEXT CHECK (athlete_type IN ('forester','sprinter','allrounder','unknown')),
  recent_form NUMERIC(5,1) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_athletes_name ON public.athletes USING btree (name);

-- ============================================================
-- 選手のランキング出場情報
-- ============================================================
CREATE TABLE public.athlete_appearances (
  id SERIAL PRIMARY KEY,
  athlete_id INT NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  ranking_type TEXT NOT NULL,
  class_name TEXT NOT NULL,
  rank INT NOT NULL,
  total_points NUMERIC(8,1),
  is_active BOOLEAN DEFAULT true,
  UNIQUE(athlete_id, ranking_type, class_name)
);

CREATE INDEX idx_appearances_athlete ON public.athlete_appearances(athlete_id);

-- ============================================================
-- LCパフォーマンス（lapcenter-runners.json から移行）
-- ============================================================
CREATE TABLE public.lc_performances (
  id SERIAL PRIMARY KEY,
  athlete_name TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_name TEXT NOT NULL,
  class_name TEXT,
  cruising_speed NUMERIC(5,1),
  miss_rate NUMERIC(5,1),
  race_type TEXT CHECK (race_type IN ('forest','sprint')),
  UNIQUE(athlete_name, event_date, event_name, class_name)
);

CREATE INDEX idx_lc_athlete ON public.lc_performances(athlete_name);
CREATE INDEX idx_lc_date ON public.lc_performances(event_date DESC);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.athletes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read athletes" ON public.athletes FOR SELECT USING (true);
CREATE POLICY "Service role can manage athletes" ON public.athletes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.athlete_appearances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read appearances" ON public.athlete_appearances FOR SELECT USING (true);
CREATE POLICY "Service role can manage appearances" ON public.athlete_appearances FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.lc_performances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read lc" ON public.lc_performances FOR SELECT USING (true);
CREATE POLICY "Service role can manage lc" ON public.lc_performances FOR ALL USING (true) WITH CHECK (true);
