-- ============================================================
-- 2026-08-24 に本番カタログから抽出した baseline
-- ============================================================
--
-- 対象は、作成マイグレーションが存在しなかったオブジェクトのみ。
-- 他の 16 ファイルが作るオブジェクトは意図的に含めていない。
-- 本番には既に存在するため、このファイルを本番へ適用しない。
-- 本番ではマイグレーション台帳へ applied として登録するだけとする。
-- ビュー athlete_like_counts は security_invoker=false（postgres 所有・RLS を迂回）だが、
-- 現状を忠実に再現する方針で、そのまま収録する。
--
-- replay の前提:
-- 本ファイル群の適用対象は Supabase が提供する DB であり、anon / authenticated /
-- service_role ロールと extensions スキーマが既に存在することを前提とする。
-- 素の PostgreSQL では、後続の 20260311_fix_security_policies.sql にある
-- CREATE POLICY ... TO authenticated や、20260612000200_carpool_fixes.sql にある
-- moddatetime 拡張で失敗する。これらは Supabase が用意する前提のため、
-- 本ファイル群はブートストラップ済みの Supabase プロジェクトを対象とする。
-- 以上は 2026-08-24 の二次レビューでの指摘に基づく追記である。
--
-- 二次レビューで見送った指摘:
-- 関数 sample_db_health() の本体にある db_health_samples と、ビュー
-- athlete_like_counts の本体にある likes の非修飾参照は、あえて修飾しない。
-- この 2 つは pg_get_functiondef / pg_get_viewdef の出力そのままであり、修飾すると
-- 新環境に保存される定義文が本番と食い違うため、忠実な再現を優先する。
-- 非標準の search_path では解決先が変わりうるという限界は認識したうえでの判断である。

-- ==== TABLES ====
-- [athletes]
create table if not exists public.athletes (
  id serial not null,
  name text not null,
  clubs text[] default '{}'::text[] not null,
  best_rank integer,
  avg_total_points numeric(8,1),
  forest_count integer default 0,
  sprint_count integer default 0,
  athlete_type text,
  recent_form numeric(5,1) default 0,
  updated_at timestamp with time zone default now(),
  constraint athletes_pkey PRIMARY KEY (id),
  constraint athletes_athlete_type_check CHECK ((athlete_type = ANY (ARRAY['forester'::text, 'sprinter'::text, 'allrounder'::text, 'unknown'::text]))),
  constraint athletes_name_key UNIQUE (name)
);

-- [athlete_appearances]
create table if not exists public.athlete_appearances (
  id serial not null,
  athlete_id integer not null,
  ranking_type text not null,
  class_name text not null,
  rank integer not null,
  total_points numeric(8,1),
  is_active boolean default true,
  constraint athlete_appearances_pkey PRIMARY KEY (id),
  constraint athlete_appearances_athlete_id_fkey FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE,
  constraint athlete_appearances_athlete_id_ranking_type_class_name_key UNIQUE (athlete_id, ranking_type, class_name)
);

-- [db_health_samples]
create table if not exists public.db_health_samples (
  ts timestamp with time zone default now(),
  total integer,
  active integer,
  idle integer,
  idle_txn integer,
  lock_waits integer,
  any_wait integer,
  max_active_age_s integer
);

-- [lc_performances]
create table if not exists public.lc_performances (
  id serial not null,
  athlete_name text not null,
  event_date date not null,
  event_name text not null,
  class_name text,
  cruising_speed numeric(5,1),
  miss_rate numeric(5,1),
  race_type text,
  constraint lc_performances_pkey PRIMARY KEY (id),
  constraint lc_performances_athlete_name_event_date_event_name_class_na_key UNIQUE (athlete_name, event_date, event_name, class_name),
  constraint lc_performances_race_type_check CHECK ((race_type = ANY (ARRAY['forest'::text, 'sprint'::text])))
);

-- [likes]
create table if not exists public.likes (
  id uuid default gen_random_uuid() not null,
  athlete_name text not null,
  session_id text not null,
  ip_hash text not null,
  created_date date default CURRENT_DATE not null,
  created_at timestamp with time zone default now() not null,
  constraint likes_pkey PRIMARY KEY (id)
);

-- [ranking_snapshot]
create table if not exists public.ranking_snapshot (
  id bigint generated always as identity not null,
  month text not null,
  file_key text not null,
  stats jsonb not null,
  created_at timestamp with time zone default now(),
  constraint ranking_snapshot_pkey PRIMARY KEY (id),
  constraint ranking_snapshot_month_file_key_key UNIQUE (month, file_key)
);


-- ==== INDEXES ====
-- [idx_appearances_athlete]
CREATE INDEX IF NOT EXISTS idx_appearances_athlete ON public.athlete_appearances USING btree (athlete_id);

-- [idx_athletes_name]
CREATE INDEX IF NOT EXISTS idx_athletes_name ON public.athletes USING btree (name);

-- [idx_lc_athlete]
CREATE INDEX IF NOT EXISTS idx_lc_athlete ON public.lc_performances USING btree (athlete_name);

-- [idx_lc_date]
CREATE INDEX IF NOT EXISTS idx_lc_date ON public.lc_performances USING btree (event_date DESC);

-- [likes_athlete_idx]
CREATE INDEX IF NOT EXISTS likes_athlete_idx ON public.likes USING btree (athlete_name);

-- [likes_ip_athlete_day_idx]
CREATE UNIQUE INDEX IF NOT EXISTS likes_ip_athlete_day_idx ON public.likes USING btree (ip_hash, athlete_name, created_date);


-- ==== ROW LEVEL SECURITY ====
-- [athlete_appearances]
alter table public.athlete_appearances enable row level security;

-- [athletes]
alter table public.athletes enable row level security;

-- [lc_performances]
alter table public.lc_performances enable row level security;

-- [likes]
alter table public.likes enable row level security;

-- [ranking_snapshot]
alter table public.ranking_snapshot enable row level security;


-- ==== POLICIES ====
-- [Anyone can read appearances]
drop policy if exists "Anyone can read appearances" on public.athlete_appearances;
create policy "Anyone can read appearances" on public.athlete_appearances as permissive for select to public using (true);

-- [Anyone can read athletes]
drop policy if exists "Anyone can read athletes" on public.athletes;
create policy "Anyone can read athletes" on public.athletes as permissive for select to public using (true);

-- [Anyone can read lc]
drop policy if exists "Anyone can read lc" on public.lc_performances;
create policy "Anyone can read lc" on public.lc_performances as permissive for select to public using (true);

-- [Anyone can read likes]
drop policy if exists "Anyone can read likes" on public.likes;
create policy "Anyone can read likes" on public.likes as permissive for select to public using (true);

-- [public_read]
drop policy if exists "public_read" on public.ranking_snapshot;
create policy public_read on public.ranking_snapshot as permissive for select to public using (true);


-- ==== FUNCTIONS ====
-- [sample_db_health]
CREATE OR REPLACE FUNCTION public.sample_db_health()
 RETURNS void
 LANGUAGE sql
AS $function$
  insert into db_health_samples(total, active, idle, idle_txn, lock_waits, any_wait, max_active_age_s)
  select
    (select count(*) from pg_stat_activity),
    (select count(*) from pg_stat_activity where state = 'active'),
    (select count(*) from pg_stat_activity where state = 'idle'),
    (select count(*) from pg_stat_activity where state = 'idle in transaction'),
    (select count(*) from pg_stat_activity where wait_event_type = 'Lock'),
    (select count(*) from pg_stat_activity where wait_event_type is not null),
    (select coalesce(max(extract(epoch from now() - query_start))::int, 0) from pg_stat_activity where state = 'active');
$function$
;


-- ==== VIEWS ====
-- [athlete_like_counts]
create or replace view public.athlete_like_counts as
 SELECT athlete_name,
    count(*) AS like_count
   FROM likes
  GROUP BY athlete_name;
