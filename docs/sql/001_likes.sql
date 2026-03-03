-- いいね機能テーブル
DROP VIEW IF EXISTS public.athlete_like_counts;
DROP TABLE IF EXISTS public.likes;

CREATE TABLE public.likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  athlete_name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_date DATE DEFAULT CURRENT_DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 同一セッションから同一選手への重複防止
CREATE UNIQUE INDEX likes_session_athlete_idx ON public.likes (session_id, athlete_name);

-- 同一IP(日次)から同一選手への重複防止
CREATE UNIQUE INDEX likes_ip_athlete_day_idx ON public.likes (ip_hash, athlete_name, created_date);

-- 選手名での検索用
CREATE INDEX likes_athlete_idx ON public.likes (athlete_name);

-- RLS
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert likes" ON public.likes FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read likes" ON public.likes FOR SELECT USING (true);

-- いいね数集計ビュー
CREATE VIEW public.athlete_like_counts AS
SELECT athlete_name, COUNT(*) AS like_count
FROM public.likes
GROUP BY athlete_name;
