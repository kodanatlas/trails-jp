-- 応援ボタンの週次リセット
-- セッション×選手の「一度きり」一意制約を「JSTの週ごと」に変更し、
-- 1週間（JSTの週＝月曜起点）が変わると再度応援できるようにする。
--   旧: UNIQUE (session_id, athlete_name)                       ← 永続ブロック
--   新: UNIQUE (session_id, athlete_name, JST週(date_trunc))     ← 週1回
-- IP ベースの日次制限 (likes_ip_athlete_day_idx) は不正連打抑止としてそのまま維持。
-- クライアント側 (src/lib/session.ts の hasCheeredGroup/setCheeredGroup) も
-- 同じ JST 月曜境界で「応援済み」表示をリセットする。

DROP INDEX IF EXISTS public.likes_session_athlete_idx;

CREATE UNIQUE INDEX IF NOT EXISTS likes_session_athlete_week_idx
  ON public.likes (
    session_id,
    athlete_name,
    (date_trunc('week', created_at AT TIME ZONE 'Asia/Tokyo'))
  );
