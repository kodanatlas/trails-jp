# 技術アーキテクチャ設計書

## 全体構成図

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Client    │────▶│   Vercel     │────▶│  Supabase   │
│  (Browser)  │◀────│  (Next.js)   │◀────│ (PostgreSQL │
│             │     │              │     │  + PostGIS) │
└─────────────┘     └──────────────┘     └─────────────┘
       │                    │                    │
       │              ┌─────┴─────┐              │
       │              │  Vercel   │              │
       │              │  Blob     │              │
       │              │ (Images)  │              │
       │              └───────────┘              │
       │                                         │
       ▼                                         │
┌─────────────┐                                  │
│  MapLibre   │                                  │
│   GL JS     │                                  │
│     +       │                                  │
│ 国土地理院  │                                  │
│   タイル    │                                  │
└─────────────┘                                  │
```

## ディレクトリ構成（詳細）

```
src/
├── app/
│   ├── layout.tsx              # RootLayout: フォント、メタデータ
│   ├── page.tsx                # トップページ
│   ├── globals.css             # Tailwind + カスタムCSS
│   │
│   ├── maps/
│   │   ├── page.tsx            # 地図一覧 (Server Component)
│   │   ├── MapGrid.tsx         # 地図カードグリッド (Client)
│   │   ├── MapFilters.tsx      # フィルターUI (Client)
│   │   └── [id]/
│   │       ├── page.tsx        # 地図詳細 (Server Component)
│   │       └── MapViewer.tsx   # 地図オーバーレイビューア (Client)
│   │
│   ├── events/
│   │   ├── page.tsx            # イベント一覧
│   │   ├── Calendar.tsx        # カレンダーコンポーネント (Client)
│   │   ├── EventList.tsx       # リスト表示 (Client)
│   │   └── [id]/
│   │       ├── page.tsx        # イベント詳細
│   │       └── ResultsTable.tsx # 成績テーブル (Client)
│   │
│   └── rankings/
│       ├── page.tsx            # ランキング
│       └── RankingTable.tsx    # ランキングテーブル (Client)
│
├── components/
│   ├── ui/                     # shadcn/ui コンポーネント
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── Navigation.tsx
│   └── MobileMenu.tsx
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Supabase クライアント初期化
│   │   ├── server.ts           # サーバーサイド用クライアント
│   │   └── types.ts            # DB型定義 (generated)
│   │
│   ├── map/
│   │   ├── config.ts           # 地図設定（タイルURL等）
│   │   ├── overlay.ts          # 地図オーバーレイ関数
│   │   └── gpx.ts              # GPXパーサー
│   │
│   └── utils.ts                # 汎用ユーティリティ
│
└── types/
    ├── map.ts                  # 地図関連の型
    ├── event.ts                # イベント関連の型
    └── ranking.ts              # ランキング関連の型
```

## データベーススキーマ

### maps テーブル

```sql
CREATE TABLE maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  prefecture TEXT NOT NULL,
  city TEXT NOT NULL,
  terrain_type TEXT NOT NULL CHECK (terrain_type IN ('forest', 'park', 'urban', 'sand', 'mixed')),
  scale TEXT NOT NULL,
  contour_interval NUMERIC(3,1) NOT NULL,
  created_year INTEGER NOT NULL,
  updated_year INTEGER,
  creator TEXT NOT NULL,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  bounds JSONB NOT NULL,           -- {north, south, east, west}
  center GEOGRAPHY(POINT, 4326),   -- PostGIS point
  tags TEXT[] DEFAULT '{}',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_maps_prefecture ON maps(prefecture);
CREATE INDEX idx_maps_terrain ON maps(terrain_type);
CREATE INDEX idx_maps_year ON maps(created_year);
CREATE INDEX idx_maps_center ON maps USING GIST(center);
```

### events テーブル

```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  date DATE NOT NULL,
  end_date DATE,
  event_type TEXT NOT NULL CHECK (event_type IN ('official', 'local', 'training', 'trail_run')),
  prefecture TEXT NOT NULL,
  city TEXT NOT NULL,
  venue TEXT,
  location GEOGRAPHY(POINT, 4326),
  organizer TEXT NOT NULL,
  map_id UUID REFERENCES maps(id),
  entry_url TEXT,
  results_url TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'ongoing', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_date ON events(date);
CREATE INDEX idx_events_prefecture ON events(prefecture);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_status ON events(status);
```

### event_classes テーブル

```sql
CREATE TABLE event_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,              -- "M21E", "W21E" etc.
  distance_km NUMERIC(5,2),
  climb_m INTEGER,
  controls INTEGER
);

CREATE INDEX idx_event_classes_event ON event_classes(event_id);
```

### event_results テーブル

```sql
CREATE TABLE event_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  rank INTEGER,
  athlete_name TEXT NOT NULL,
  club TEXT,
  time_seconds INTEGER,            -- 秒数で格納
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'dnf', 'dns', 'mp')),
  splits JSONB                     -- [{control, time_seconds, leg_seconds, rank}]
);

CREATE INDEX idx_results_event ON event_results(event_id);
CREATE INDEX idx_results_class ON event_results(event_id, class_name);
CREATE INDEX idx_results_athlete ON event_results(athlete_name);
```

### rankings テーブル

```sql
CREATE TABLE rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  class_name TEXT NOT NULL,
  rank INTEGER NOT NULL,
  athlete_name TEXT NOT NULL,
  club TEXT,
  points NUMERIC(8,2) NOT NULL,
  events_counted INTEGER NOT NULL,
  best_results JSONB,              -- [{event_name, date, rank, points}]

  UNIQUE(year, class_name, rank)
);

CREATE INDEX idx_rankings_year_class ON rankings(year, class_name);
```

## API エンドポイント設計

Phase 1 では Next.js Server Components で直接 Supabase にアクセスするため、
明示的な API Routes は最小限とする。

### 必要な API Routes

```
GET /api/maps?prefecture=&terrain=&year=&q=     # 地図検索（クライアントフィルタ用）
GET /api/events?month=&prefecture=&type=         # イベント検索
```

## パフォーマンス戦略

### 画像最適化
- Next.js Image コンポーネント使用
- 地図サムネイル: WebP, 400x300px
- 地図本体: 元画像を保持、ブラウザ側でズーム

### キャッシュ戦略
- 地図詳細: ISR (revalidate: 86400) - 1日キャッシュ
- イベント一覧: ISR (revalidate: 3600) - 1時間キャッシュ
- ランキング: ISR (revalidate: 86400) - 1日キャッシュ

### バンドル最適化
- MapLibre GL JS: dynamic import (地図ページのみ読み込み)
- shadcn/ui: tree-shakable、必要なコンポーネントのみ
