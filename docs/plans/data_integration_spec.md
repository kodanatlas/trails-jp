# Japan-O-entrY データ連携仕様書

## 調査結果サマリー

### イベント
- **一覧URL**: `https://japan-o-entry.com/` (table.index)
- **アーカイブ**: `https://japan-o-entry.com/event/archive` (年度別)
- **詳細URL**: `https://japan-o-entry.com/event/view/{EVENT_ID}`
- **フィルタ**: 地域 / 受付状態 / タグ(公認大会,初心者歓迎等)
- **データ項目**: 日付, 大会名, 開催地, 主催者, 受付状態, タグ, クラス, 参加費

### ランキング
- **URL**: `https://japan-o-entry.com/ranking/ranking/ranking_index/{TYPE}/{CLASS_ID}`
- **ランキング種別**:
  - 1 = 年齢別フォレスト
  - 5 = エリートフォレスト
  - 15 = 年齢別スプリント
  - 17, 19 等 = その他
- **クラスID例**: 39=男子(エリート), 46=女子(エリート)
- **データ項目**: 順位, 氏名, 所属, 合計点数, 各大会スコア
- **CSSクラス**: normal_ranker(有効), out_ranker(対象外/条件未満)

---

## 1. イベント連携

### 1.1 取得方式

HTMLスクレイピング（APIなし）

```
[japan-o-entry.com] --HTML--> [Next.js API Route] --parse--> [Supabase DB]
```

### 1.2 スクレイピング対象

| URL | 頻度 | 取得データ |
|-----|------|----------|
| `/` (トップ) | 日次 06:00 JST | 今後のイベント一覧 |
| `/event/archive` | 日次 06:00 JST | 過去イベント（成績リンク更新検出） |
| `/event/view/{id}` | 新規イベント検出時 | イベント詳細 |

### 1.3 パース対象HTML構造

```
<table class="index">
  <tr date-sort="20260302">
    <td>2026/3/2</td>
    <td><a href="/event/view/2400">大会名</a></td>
    <td>東京都</td>
    <td>受付中</td>
    <td>公認大会, ランキング対象</td>
  </tr>
</table>
```

### 1.4 trails.jp での表示

- イベント一覧に japan-o-entry のデータを統合表示
- 各イベントに「japan-o-entry で詳細を見る」リンク付き
- エントリーボタン → japan-o-entry の該当ページへ直リンク

---

## 2. ランキング連携

### 2.1 取得方式

HTMLスクレイピング（JS動的レンダリングの可能性あり → cheerio or puppeteer）

### 2.2 スクレイピング対象

| URL | 頻度 | 取得データ |
|-----|------|----------|
| `/ranking/ranking/ranking_index/5/39` | 週次 月曜 06:00 | エリートフォレスト男子 |
| `/ranking/ranking/ranking_index/5/46` | 週次 月曜 06:00 | エリートフォレスト女子 |
| `/ranking/ranking/ranking_index/1/{class}` | 週次 月曜 06:00 | 年齢別フォレスト各クラス |
| `/ranking/ranking/ranking_index/15/{class}` | 週次 月曜 06:00 | 年齢別スプリント各クラス |

### 2.3 trails.jp での改善ポイント（元UIの問題点）

元のランキングの問題:
- テーブルが横に広すぎる（大会ごとのスコア列が多い）
- モバイルで見切れる
- 選手のクリックで詳細が見れない
- ビジュアライゼーションがない

trails.jp での改善:
1. **コンパクトテーブル**: 順位・名前・所属・合計点のみ表示、詳細は展開式
2. **成績グラフ**: 大会ごとのポイント推移を折れ線グラフで表示
3. **検索**: 選手名・所属で検索可能
4. **比較機能**: 2人の選手を選んで成績比較
5. **モバイル最適化**: カード形式でモバイルファーストUI

---

## 3. 技術実装

### 3.1 スクレイパー (API Route + Cron)

```typescript
// /api/cron/sync-events (Vercel Cron: 0 21 * * * = 日次 06:00 JST)
// /api/cron/sync-rankings (Vercel Cron: 0 21 * * 0 = 週次月曜 06:00 JST)
```

### 3.2 使用ライブラリ

```
cheerio    - HTMLパース（サーバーサイド）
node-cron  - Vercel Cron Job（vercel.json で設定）
```

### 3.3 DB テーブル

```sql
-- japan-o-entry から取得したイベント
CREATE TABLE external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  joe_event_id INTEGER UNIQUE NOT NULL,  -- japan-o-entry のID
  name TEXT NOT NULL,
  date DATE NOT NULL,
  end_date DATE,
  prefecture TEXT,
  venue TEXT,
  organizer TEXT,
  entry_status TEXT,  -- 'open', 'closed', 'none'
  tags TEXT[],
  joe_url TEXT NOT NULL,  -- japan-o-entry 詳細ページURL
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- japan-o-entry から取得したランキング
CREATE TABLE external_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ranking_type TEXT NOT NULL,     -- 'elite_forest', 'age_forest', 'age_sprint'
  class_name TEXT NOT NULL,       -- 'M21E', 'W21E', 'M35' etc
  rank INTEGER NOT NULL,
  athlete_name TEXT NOT NULL,
  club TEXT,
  total_points NUMERIC(8,1) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE, -- normal_ranker=true, out_ranker=false
  event_scores JSONB,             -- [{event_name, date, points}]
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ranking_type, class_name, rank, synced_at::date)
);
```
