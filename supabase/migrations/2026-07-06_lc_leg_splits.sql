-- per-leg スプリットの永続化（Stage 2a・方法論プラン 2026-06-29 §6.1）
-- lc_leg_splits: 走者×レース 1行。per-leg は配列カラム（秒 int・null 要素=未計測）。
--   MP/DISQ/DNS も rank=null で全走者保持（DNF クリーンプレフィックスを基準プールに使うため）。
--   クラス保持ルール: 追跡選手が1人以上いるクラスのみ・ただしそのクラスは全走者保存
--   （フィールド中央値・コホート基盤に全走者が必要）。
-- lc_leg_events: イベント単位の取込台帳（cron のイベント選択・backfill の resume・健全性検証）。
--   classes>0 のときのみ記帳＝結果未掲載イベントの再試行を維持しつつ、
--   zero-tracked イベントの永久再スクレイプを防ぐ。
begin;

create table if not exists public.lc_leg_splits (
  id              bigint generated always as identity primary key,
  lc_event_id     integer  not null,
  lc_class_id     integer  not null,
  event_date      date     not null,          -- JOY 側 date/name（lc_performances と同キー系・race_type PATCH 対象）
  event_name      text     not null,
  class_name      text,
  race_type       text     not null check (race_type in ('forest','sprint')),
  runner_index    smallint not null,          -- split-list のパース順 = 冪等キー
  runner_name     text     not null,          -- 原文（空白込み）
  runner_key      text     not null,          -- 空白除去キー（athlete-index 突合用）
  club            text,
  rank            smallint,                   -- null = MP/DISQ/DNS（relay-first: 全走者保持）
  result_sec      integer,
  start_time      text,
  speed           numeric(6,1),               -- 巡航速度（LapCenter relay・低いほど速い）
  loss_rate       numeric(6,1),               -- ミス率 %（LapCenter relay・低いほど良い）
  ideal_sec       integer,
  total_loss_sec  integer,
  lap_sec         integer[]  not null,        -- 要素 null = 未計測レッグ
  lap_rank        smallint[] not null,
  elapsed_sec     integer[]  not null,
  elapsed_rank    smallint[] not null,
  leg_loss_sec    integer[]  not null,        -- 符号付き（負 = 自分の巡航ペース基準より速い）
  leg_speed       integer[]  not null,        -- round(100·lap/Ave3)（LapCenter relay。破損レッグで巨大値が出るため smallint 不可＝2026-07-07 実データで判明し ALTER 済み）
  tracked         boolean  not null default false,  -- athlete-index 突合（名前+クラブ照合のみ・MP でも true）
  created_at      timestamptz not null default now(),
  unique (lc_event_id, lc_class_id, runner_index)   -- (lc_event_id, lc_class_id) の前方一致 index を兼ねる
);
create index if not exists lc_leg_splits_runner_key_idx on public.lc_leg_splits (runner_key);
create index if not exists lc_leg_splits_event_date_idx on public.lc_leg_splits (event_date);

create table if not exists public.lc_leg_events (
  lc_event_id      integer primary key,
  event_date       date not null,
  event_name       text not null,
  class_count      smallint not null,
  kept_class_count smallint not null,
  runner_row_count integer  not null,
  source           text not null check (source in ('cron','backfill')),
  ingested_at      timestamptz not null default now()
);

-- RLS 有効・ポリシーなし = anon/authenticated 全拒否（service_role のみアクセス。クライアント読取経路なし）
alter table public.lc_leg_splits enable row level security;
alter table public.lc_leg_events enable row level security;

commit;
