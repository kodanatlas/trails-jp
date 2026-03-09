# アーキテクチャ移行計画: 静的JSON → Supabase DB + API

## 概要

静的JSONファイルによるデータ配信を廃止し、Supabase PostgreSQL + Next.js API Routeに移行する。
GPTの「分割JSON中間形態」案は採用せず、**DB移行とAPI化を同時に実施**して二度手間を避ける。

## 現状 → 目標

```
現状:
  ビルド時 → 巨大JSON (public/data/) → クライアントが全量fetch
  Cron → Supabase Storage (JSON) → API → フォールバック → 静的JSON
  問題: データソース二重管理、巨大配信、フォールバックバグ

目標:
  Cron/ビルド → Supabase DB (PostgreSQL) に書き込み
  クライアント → API Route → DB クエリ → 必要分だけ返す
  静的JSON廃止、データソース一本化
```

---

## Phase 1: LCデータ + 選手検索の DB移行・API化

**目的**: 最も問題の大きい lapcenter-runners.json (2.8MB) と athlete-index.json (2.1MB) のクライアント全量配信を廃止

### 1-1. テーブル設計

```sql
-- 選手マスタ（athlete-index.json から）
CREATE TABLE athletes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  clubs TEXT[] NOT NULL DEFAULT '{}',
  best_rank INT,
  avg_total_points NUMERIC(8,1),
  forest_count INT DEFAULT 0,
  sprint_count INT DEFAULT 0,
  athlete_type TEXT CHECK (athlete_type IN ('forester','sprinter','allrounder','unknown')),
  recent_form NUMERIC(5,1),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_athletes_name ON athletes USING btree (name);

-- 選手のランキング出場情報
CREATE TABLE athlete_appearances (
  id SERIAL PRIMARY KEY,
  athlete_id INT REFERENCES athletes(id) ON DELETE CASCADE,
  ranking_type TEXT NOT NULL,   -- 'age_forest', 'age_sprint', 'elite_forest', 'elite_sprint'
  class_name TEXT NOT NULL,     -- 'M15', 'S_M15', 'M21E' 等
  rank INT NOT NULL,
  total_points NUMERIC(8,1),
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_appearances_athlete ON athlete_appearances(athlete_id);

-- LCパフォーマンス（lapcenter-runners.json から）
CREATE TABLE lc_performances (
  id SERIAL PRIMARY KEY,
  athlete_name TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_name TEXT NOT NULL,
  class_name TEXT,
  cruising_speed NUMERIC(5,1),  -- s: 巡航速度 (%)
  miss_rate NUMERIC(5,1),       -- m: ミス率 (%)
  race_type TEXT CHECK (race_type IN ('forest','sprint')),
  UNIQUE(athlete_name, event_date, event_name, class_name)
);

CREATE INDEX idx_lc_athlete ON lc_performances(athlete_name);
CREATE INDEX idx_lc_date ON lc_performances(event_date DESC);
```

### 1-2. API Route 設計

| エンドポイント | 用途 | レスポンスサイズ | キャッシュ |
|--------------|------|----------------|----------|
| `GET /api/lc/[name]` | 1選手のLC全履歴 | 数KB | `s-maxage=3600` |
| `GET /api/athletes/search?q=xxx` | 選手名検索（上位20件） | 数KB | `s-maxage=60` |
| `GET /api/athletes/[name]` | 1選手の詳細情報 | 数KB | `s-maxage=3600` |

**検索**: 2,400人程度なので `WHERE name ILIKE '%xxx%'` で十分。pg_trgm 不要。

### 1-3. Cron 改修

- `sync-lapcenter`: 書き込み先を Supabase Storage → DB (`lc_performances` テーブル) に変更
- `build-analysis-index.ts`: 生成結果を `public/data/` に加えて DB (`athletes`, `athlete_appearances`) にも書き込み（Phase 2 で static 廃止後は DB のみ）

### 1-4. クライアント改修

- `AthleteDetail.tsx`: `/api/lapcenter-runners` 全量fetch → `/api/lc/[name]` に変更。フォールバック分岐削除
- `CompareAthletes.tsx`: 同上（比較対象の名前分だけ `/api/lc/[name]` を並列fetch）
- `AnalysisHub.tsx`: `athlete-index.json` 全量fetch → `/api/athletes/search` に変更

### 1-5. 影響範囲

| ファイル | 変更内容 |
|---------|---------|
| `docs/sql/002_analysis_tables.sql` | 新規: テーブル定義 |
| `src/app/api/lc/[name]/route.ts` | 新規: 1選手LC取得API |
| `src/app/api/athletes/search/route.ts` | 新規: 選手検索API |
| `src/app/api/athletes/[name]/route.ts` | 新規: 選手詳細API |
| `src/app/api/cron/sync-lapcenter/route.ts` | 改修: 書き込み先をDBに |
| `scripts/build-analysis-index.ts` | 改修: DB書き込み追加 |
| `src/app/analysis/AthleteDetail.tsx` | 改修: API呼び出し変更 |
| `src/app/analysis/CompareAthletes.tsx` | 改修: API呼び出し変更 |
| `src/app/analysis/AnalysisHub.tsx` | 改修: 検索API化 |
| `src/app/api/lapcenter-runners/route.ts` | 廃止予定（Phase 1 完了後） |
| `src/lib/lapcenter-runners-store.ts` | 廃止予定 |

---

## Phase 2: ランキング・クラブの DB化 + 静的JSON完全廃止

**目的**: 残りのデータもDB化し、ビルド時のスクレイプ依存と静的JSONを完全廃止

### 2-1. 追加テーブル

```sql
-- クラブ統計
CREATE TABLE clubs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  member_count INT DEFAULT 0,
  active_count INT DEFAULT 0,
  avg_points NUMERIC(8,1),
  forest_count INT DEFAULT 0,
  sprint_count INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ランキング（個別クラスのランキングデータ）
CREATE TABLE rankings (
  id SERIAL PRIMARY KEY,
  ranking_type TEXT NOT NULL,
  class_name TEXT NOT NULL,
  athlete_name TEXT NOT NULL,
  club TEXT,
  rank INT NOT NULL,
  points NUMERIC(8,1),
  event_scores JSONB,  -- イベントごとのスコア配列（構造が複雑なためJSONB）
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ranking_type, class_name, athlete_name)
);

CREATE INDEX idx_rankings_class ON rankings(ranking_type, class_name);
CREATE INDEX idx_rankings_athlete ON rankings(athlete_name);
```

### 2-2. 追加API

| エンドポイント | 用途 | キャッシュ |
|--------------|------|----------|
| `GET /api/clubs/[name]` | 1クラブの詳細 | `s-maxage=3600` |
| `GET /api/clubs/search?q=xxx` | クラブ検索 | `s-maxage=60` |
| `GET /api/rankings/[type]/[class]` | 1クラスのランキング | `s-maxage=3600` |

### 2-3. ビルドスクリプト改修

- `build-analysis-index.ts`: JSON出力を完全廃止、DB書き込みのみに
- JOYランキングのスクレイプもCronに移行（ビルド時間を8分→1分以下に短縮）
- `public/data/` ディレクトリのJSON群を削除

### 2-4. 削除対象

- `public/data/athlete-index.json`
- `public/data/lapcenter-runners.json`
- `public/data/club-stats.json`
- `public/data/rankings/` (77ファイル)
- `src/lib/lapcenter-runners-store.ts`
- `src/app/api/lapcenter-runners/route.ts`
- `src/lib/analysis/utils.ts` の静的JSON fetch関連

---

## Phase 3: ISR（Incremental Static Regeneration）

**目的**: 選手詳細ページをサーバー側で事前レンダリングし、クライアントJSを最小化

### 3-1. 変更内容

- `/analysis/[name]/page.tsx` に動的ルート化
- `generateStaticParams`: 上位100選手のみ事前生成
- 残りはオンデマンドISR（`revalidate = 86400`、1日キャッシュ）
- 初期表示データ（LC履歴、ランキング）をサーバーコンポーネントで取得しpropsで渡す
- Rechartsなどクライアント要素は `"use client"` の子コンポーネントに分離

### 3-2. Hobby プラン制約の確認

- `generateStaticParams` で100人 → ビルド時間への影響は軽微
- ISRのrevalidateはServerless Functionで実行 → 10秒制限内でDBクエリ+レンダリングは余裕
- ISRキャッシュはVercel CDN管理なのでHobbyでも利用可能

---

## 移行戦略

### 安全な段階リリース

```
Phase 1a: テーブル作成 + データ投入スクリプト
  → 既存のJSONからDBに初期データをインポート
  → この時点ではクライアントは変更なし（DBにデータがある状態を確認）

Phase 1b: API Route 作成
  → /api/lc/[name] 等を作成、動作確認
  → 旧APIと並行稼働（クライアントはまだ旧API）

Phase 1c: クライアント切り替え
  → AthleteDetail, CompareAthletes, AnalysisHub を新APIに切り替え
  → フォールバック分岐を削除

Phase 1d: Cron改修
  → sync-lapcenter の書き込み先をDBに変更
  → 旧Storage書き込みを廃止

Phase 2: 残りのDB化（同じ a→b→c→d パターン）

Phase 3: ISR化
```

### ロールバック方針

- Phase 1 完了まで `public/data/` の静的JSONは削除しない
- API に障害が出た場合、クライアント側で静的JSONへのフォールバックを一時的に戻せる
- Phase 2 完了・動作確認後に静的JSONを削除

---

## Supabase Free プラン制約の確認

| リソース | 制限 | 想定使用量 | 余裕 |
|---------|------|----------|------|
| DB容量 | 500MB | ~50MB（全テーブル合計） | 十分 |
| API リクエスト | 無制限 | - | OK |
| Edge Functions | 500K/月 | 使用しない | - |
| Storage | 1GB | 既存events.json等（移行後は縮小） | 十分 |
| 同時接続 | 60 | ピーク時でも数十 | OK |

---

## 成功指標

| 指標 | 現状 | Phase 1 後 | Phase 2 後 |
|------|------|-----------|-----------|
| 初回ページロード転送量 | ~5MB | ~50KB | ~50KB |
| athlete-index.json | 2.1MB全量 | API検索（数KB） | 同左 |
| lapcenter-runners.json | 2.8MB全量 | 1選手分（数KB） | 同左 |
| データソース | 2つ（バグ温床） | 1つ（DB） | 1つ |
| フォールバック分岐 | 全画面に必要 | 不要 | 不要 |
| ビルド時間 | 8分超 | 8分（Phase 2で解消） | 1分以下 |
