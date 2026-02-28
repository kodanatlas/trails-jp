# 分析機能 システム構成ドキュメント

## 概要

trails.jp の分析機能は、日本オリエンテーリング界の2つの主要データソース（JOY / LapCenter）からデータを収集・統合し、選手・クラブ単位での成績分析と可視化を提供する。

```
┌──────────────────────────────────────────────────────────────────────┐
│                      データソース（外部）                              │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐    │
│  │  JOY (japan-o-entry)  │    │  LapCenter (mulka2.com)          │    │
│  │  - イベント情報        │    │  - 巡航速度 (cruising speed)      │    │
│  │  - ランキング (4種)    │    │  - ミス率 (miss rate)             │    │
│  │  - 選手名・クラブ      │    │  - クラス別成績                   │    │
│  └─────────┬────────────┘    └──────────────┬───────────────────┘    │
│            │                                │                       │
├────────────┼────────────────────────────────┼───────────────────────┤
│            ▼                                ▼                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    スクレイパー層                               │   │
│  │  src/lib/scraper/events.ts    ← イベント一覧・座標              │   │
│  │  src/lib/scraper/rankings.ts  ← ランキングデータ                │   │
│  │  src/lib/scraper/lapcenter.ts ← LC イベントマッチ・走者データ    │   │
│  └──────────────────────────────┬───────────────────────────────┘   │
│                                 │                                   │
│            ┌────────────────────┼────────────────────┐              │
│            ▼                    ▼                    ▼              │
│  ┌─────────────────┐ ┌──────────────────┐ ┌─────────────────┐      │
│  │  バッチ処理       │ │  Vercel Cron      │ │  永続化           │      │
│  │  (scripts/)      │ │  (api/cron/)      │ │                  │      │
│  │  build-analysis  │ │  sync-events      │ │  Supabase Storage │      │
│  │  scrape-lc-run.  │ │  sync-lapcenter   │ │  静的 JSON        │      │
│  └────────┬────────┘ └────────┬─────────┘ └────────┬────────┘      │
│           │                   │                     │               │
│           └───────────────────┼─────────────────────┘               │
│                               ▼                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │               フロントエンド (React / recharts)                 │   │
│  │  AnalysisHub → AthleteDetail / ClubAnalysis / CompareAthletes │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 1. データソース

### 1.1 JOY (Japan O-Entry)

日本オリエンテーリング協会のイベント管理・ランキングサイト。

| データ | 取得元 | 説明 |
|---|---|---|
| イベント一覧 | トップページ + 年度アーカイブ | 大会名、日程、座標 |
| ランキング | `/ranking/ranking/ranking_index/{typeId}/{classId}` | 選手名、クラブ、得点、大会別スコア |

**ランキングカテゴリ（4種）:**

| カテゴリ | typeId | クラス数 | 説明 |
|---|---|---|---|
| エリートフォレスト | 5 | 2 (M21E, W21E) | トップ選手のフォレスト |
| エリートスプリント | 17 | 2 (S_Open, S_W) | トップ選手のスプリント |
| 年齢別フォレスト | 1 | 38 (無差別～W90) | 年齢階級別フォレスト |
| 年齢別スプリント | 15 | 38 (S_無差別～S_W90) | 年齢階級別スプリント |

合計 80 クラスのランキングをスクレイプし、`public/data/rankings/{type}_{className}.json` として個別ファイルに保存。

### 1.2 LapCenter (mulka2.com)

大会成績データベース。OE/Mulka2 系の成績管理ソフトから登録されたラップタイムデータを公開。

| データ | 取得元URL | 説明 |
|---|---|---|
| イベント一覧 | `/lapcenter/index.jsp?year={year}` | 年別イベント一覧 |
| クラス一覧 | `/lapcenter/lapcombat2/index.jsp?event={id}&file=1` | イベント内のクラスとコース距離 |
| スプリットデータ | `/lapcenter/lapcombat2/split-list.jsp?event={id}&file=1&class={classId}` | 巡航速度・ミス率・順位 |

**巡航速度** (cruising speed): 最適タイムに対する走行速度の割合（%）。高いほど良い。
**ミス率** (miss rate): ナビゲーションエラーによるタイムロスの割合（%）。低いほど良い。

---

## 2. スクレイパー

### 2.1 イベントスクレイパー (`src/lib/scraper/events.ts`)

- `scrapeEvents()`: JOY トップページから現在のイベント一覧を取得
- `scrapeArchive(year)`: 年度別アーカイブから過去イベントを取得
- `enrichEventsWithCoordinates()`: 座標未取得のイベントを JOY の個別ページから補完

### 2.2 ランキングスクレイパー (`src/lib/scraper/rankings.ts`)

- `scrapeRanking(typeId, classId)`: 個別のランキングテーブルを HTML からパース
- `scrapeAllRankings()`: 全 80 クラスを一括スクレイプ（1.2 秒/リクエスト間隔）

パース対象は cheerio による HTML テーブル解析。各選手の `rank`, `athlete_name`, `club`, `total_points`, `is_active`, `event_scores[]` を抽出。

### 2.3 LapCenter スクレイパー (`src/lib/scraper/lapcenter.ts`)

**3つの主要関数:**

1. **`fetchLapCenterEvents(year)`**: 年別イベント一覧を取得
2. **`fetchEventClasses(eventId)`**: イベント内のクラス一覧を取得
3. **`fetchSplitList(eventId, classId)`**: 各クラスのランナーデータ（巡航速度・ミス率）を取得

`fetchSplitList` は HTML 内に埋め込まれた JavaScript 変数（`runnerData['speed']`, `runnerData['lossRate']` 等）を正規表現でパースして抽出する。

**イベントマッチング:**

JOY のイベントと LapCenter のイベントを紐づけるために `matchLapCenterEvents()` を使用。同一日付のイベントに対してファジーマッチング（`fuzzyMatch()`）を適用する。

ファジーマッチングのロジック:
1. イベント名を正規化（全角→半角、回次・年度・括弧内の除去）
2. ストップワード除去後の完全一致
3. 部分文字列一致（4文字以上）
4. 有意語トークンの双方向含有チェック
5. トライグラム類似度（閾値 0.65 以上、5 共通以上）

現在 858 イベントが JOY ↔ LapCenter で紐づけ済み。

---

## 3. バッチ処理スクリプト

### 3.1 分析インデックスビルド (`scripts/build-analysis-index.ts`)

全ランキング JSON を読み込み、以下の2ファイルを生成:

| 出力ファイル | 内容 | サイズ目安 |
|---|---|---|
| `public/data/athlete-index.json` | 全選手の軽量プロフィール（検索・一覧用） | ~2,400 選手 |
| `public/data/club-stats.json` | クラブ別統計 | ~200 クラブ |

**選手プロフィール (`AthleteSummary`) の構成:**

```typescript
interface AthleteSummary {
  name: string;              // 選手名
  clubs: string[];           // 所属クラブ（名寄せ済み）
  appearances: RankingRef[]; // 出場カテゴリ一覧
  bestRank: number;          // 最高順位
  bestPoints: number;        // F・S 無差別平均ポイント
  forestCount: number;       // Forest カテゴリ数
  sprintCount: number;       // Sprint カテゴリ数
  type: "sprinter" | "forester" | "allrounder" | "unknown";
}
```

**特性分類ロジック (`classifyType`):**

Forest / Sprint の最高ポイントを比較し、15% 以上の差がある場合にどちらかに分類:
- `bestForestPts / bestSprintPts > 1.15` → forester
- `bestForestPts / bestSprintPts < 1/1.15` → sprinter
- それ以外 → allrounder

**bestPoints の算出:**

年齢別無差別カテゴリ（`age_forest/無差別` と `age_sprint/S_無差別`）のポイントの平均値。女子選手は `女子無差別` / `S_女子無差別` を使用。どちらか一方しかない場合はその値をそのまま使用。

**クラブ名の名寄せ (`normalizeClubName`):**

JOY のクラブ名表記のゆれを統一:
- 全角英数字 → 半角
- 大学OLC略称 → 正式大学名（例: 京大OLC → 京都大学）
- 大学院 → 大学
- 末尾数字・期数の除去（例: 金大OLC44期 → 金沢大学）
- OLクラブ → OLC
- 個別エイリアス（大阪 → 大阪OLC、練馬 → 練馬OLC）

### 3.2 LapCenter ランナースクレイパー (`scripts/scrape-lapcenter-runners.ts`)

全 LapCenter 紐づけ済みイベントに対して、JOY ランキング登録選手の巡航速度・ミス率を収集するバッチスクリプト。

**実行方法:**
```bash
npx tsx scripts/scrape-lapcenter-runners.ts           # 全イベント
npx tsx scripts/scrape-lapcenter-runners.ts --limit 5  # 5イベントのみ
```

**処理フロー:**
1. `events.json` から `lapcenter_event_id` 付きイベントを取得
2. `athlete-index.json` からJOYランキング登録選手リストをロード
3. 各イベント → クラス一覧 → split-list をスクレイプ
4. 選手名マッチング + クラブ照合で同一人物を特定
5. 有効データのみ保持（フィルタ条件は後述）
6. `public/data/lapcenter-runners.json` に出力

**選手名マッチング:**

LapCenter と JOY で選手名の書式が異なるため正規化が必要:
- LapCenter: 半角スペース付き（例: `前川 一彦`）
- JOY: スペースなし（例: `前川一彦`）
- `.replace(/\s+/g, "")` で両者を正規化して一致判定

**クラブ照合:**

名前の一致だけでは同姓同名の誤マッチが発生するため、クラブ名でも照合:
- LapCenter: スラッシュ区切り（例: `筑波大学/ときわ走林会`）
- JOY: 配列形式（例: `["筑波大学", "ときわ走林会"]`）
- `normalizeClub()` で統一後、部分一致で判定
- どちらかのクラブ情報が空の場合は照合をスキップ（名前のみで判定）

**無効データフィルタ:**
- `speed === 100 && missRate === 0`: 1人クラス等で比較対象がない場合のデフォルト値（除外）
- `speed > 500`: 明らかな計算異常値（除外）
- `rank` が NaN: MP（ミスパンチ）/ DISQ（失格）/ DNS（不出走）の選手（除外）

**JOY 優先ソート:**

JOY ランキングに使用されている日付のイベントを優先的にスクレイプ:
1. ランキングファイルから全イベント日付を収集
2. JOY ランキング日付のイベントを先に処理
3. 同じ優先度内では新しい日付順

**出力フォーマット:**
```json
{
  "athletes": {
    "選手名": [
      {
        "d": "2025-11-03",    // 日付
        "e": "全日本大会",     // イベント名
        "c": "MA",            // クラス名
        "s": 87.3,            // 巡航速度 (%)
        "m": 12.5,            // ミス率 (%)
        "t": "forest"         // forest | sprint
      }
    ]
  },
  "generatedAt": "2026-03-01T..."
}
```

**現在のデータ規模:** 2,289 選手 / 19,136 パフォーマンスレコード

---

## 4. 自動化 (Vercel Cron)

Vercel Hobby プラン（1 日 1 回制限）で 2 つの Cron ジョブを運用:

### 4.1 イベント同期 (`/api/cron/sync-events`)

| 項目 | 値 |
|---|---|
| スケジュール | 毎日 03:00 JST (18:00 UTC) |
| 実行内容 | JOY イベント同期 + 座標補完 + LC マッチング |
| 水曜追加 | JOY ランキング全クラス再スクレイプ |

**処理フロー:**
1. JOY トップページ + アーカイブからイベント取得
2. 既存データとマージ（座標・LC リンクを引き継ぎ）
3. 座標未取得イベントを 50 件/回バッチで補完
4. LapCenter イベントマッチング
5. Supabase Storage に保存
6. 水曜日のみ: 全 80 クラスのランキングを再スクレイプ

### 4.2 LapCenter 同期 (`/api/cron/sync-lapcenter`)

| 項目 | 値 |
|---|---|
| スケジュール | 毎日 12:00 JST (03:00 UTC) |
| 実行内容 | LC イベントマッチング（日次） |
| 水曜追加 | 巡航速度・ミス率スクレイプ（最大 3 イベント/回） |

**処理フロー:**
1. 未マッチイベントに対して LapCenter イベント自動マッチング
2. 水曜日のみ: 未処理 LC イベント（新しい順、最大 3 件）から走者データをスクレイプ
3. Supabase Storage に保存

---

## 5. データ永続化

### 5.1 Supabase Storage

Vercel のサーバーレス環境ではファイルシステムが揮発的なため、Supabase Storage（S3 互換オブジェクトストレージ）を使用:

| バケット | ファイル | 用途 |
|---|---|---|
| `app-data` | `events.json` | イベントデータ（Cron 更新） |
| `app-data` | `lapcenter-runners.json` | LC 走者データ（Cron 更新） |

`events-store.ts` / `lapcenter-runners-store.ts` が読み書きを担当。読み込み失敗時は静的 JSON にフォールバック。

### 5.2 静的 JSON（ビルド時同梱）

| ファイル | 生成元 | 更新タイミング |
|---|---|---|
| `public/data/rankings/*.json` | `scrapeAllRankings()` | Cron（水曜）or 手動 |
| `public/data/athlete-index.json` | `build-analysis-index.ts` | 手動（ランキング更新後） |
| `public/data/club-stats.json` | `build-analysis-index.ts` | 手動（ランキング更新後） |
| `public/data/lapcenter-runners.json` | `scrape-lapcenter-runners.ts` | 手動（初回）+ Cron（増分） |
| `src/data/events.json` | `scrapeEvents()` + 手動編集 | 手動 + Cron |

### 5.3 API エンドポイント

| パス | 説明 |
|---|---|
| `GET /api/lapcenter-runners` | Supabase Storage から LC ランナーデータを返却。未設定時 404。 |

フロントエンドは API 優先 → 静的 JSON フォールバックで LC データを取得:
```
/api/lapcenter-runners (Supabase) → /data/lapcenter-runners.json (静的)
```

---

## 6. 分析ロジック

### 6.1 統計指標 (`src/lib/analysis/utils.ts`)

| 指標 | 関数 | 算出方法 |
|---|---|---|
| **安定性** | `calcConsistency()` | 変動係数 (CV = σ/μ) の逆数を 0-100 にマッピング。`score = (1 - CV/0.3) × 100`。CV=0 で 100、CV≧0.3 で 0。 |
| **最近の調子** | `calcRecentForm()` | 直近 3 大会の平均ポイントと全体平均の差を%表示。`(recentAvg - allAvg) / allAvg × 100` |
| **ベストスコア** | `getAllEvents()` から最大値 | カテゴリ横断で重複排除した全イベントから最高得点を抽出 |

### 6.2 Forest / Sprint 分類（LapCenter データ）

LapCenter のイベントデータには Forest / Sprint の区分がないため、JOY のランキングカテゴリ情報を使って判定:

1. JOY ランキングの各イベントから日付とランキングタイプ（forest / sprint）を収集
2. LapCenter のデータと日付で突合
3. 同日に1カテゴリしかなければそのタイプを採用
4. 複数カテゴリがある場合はイベント名のファジーマッチングで特定
5. JOY にない日付のデータはチャートに表示しない

### 6.3 トレンドライン（線形回帰）

巡航速度・ミス率チャートには、Forest / Sprint 独立に線形回帰トレンドラインを表示:

```
y = ax + b  (最小二乗法)

a = (n·Σxy - Σx·Σy) / (n·Σxx - (Σx)²)
b = (Σy - a·Σx) / n
```

値のあるデータ点のみで回帰係数を算出し、最初と最後のデータ点に回帰値を配置して直線を描画。

---

## 7. フロントエンド構成

### 7.1 ページ構成

`/analysis` ページは `AnalysisHub` コンポーネントが 3 つのタブを管理:

| タブ | コンポーネント | 機能 |
|---|---|---|
| 選手分析 | `AthleteDetail` | 個人プロフィール・チャート・大会参加状況 |
| クラブ | `ClubAnalysis` | クラブ別統計・メンバー一覧 |
| 比較 | `CompareAthletes` | 2 選手の並列比較 |

### 7.2 AthleteDetail の構成

`AthleteDetail` は以下のセクションで構成:

1. **ProfileHeader**: 選手名、クラブ、F・S 無差別平均ポイント
2. **TypeBadge**: 特性分類（スプリンター/フォレスター/オールラウンダー）+ Forest vs Sprint バー
3. **StatsCards**: 安定性 / 最近の調子 / ベストスコア の 3 カード
4. **ScoreChart**: JOY ポイント推移チャート（Forest=緑, Sprint=青）
5. **LapCenterChart**: 巡航速度・ミス率推移チャート（2 段構成、線形回帰トレンドライン付き）
6. **RecentEvents**: 月別参加頻度ヒートマップ + 直近 10 大会リスト（成績レベル 5 段階色分け）

LapCenter チャートはデータが 2 件以上ある選手にのみ表示。

### 7.3 データロード

ページ初期化時に軽量インデックス 2 ファイルをフェッチ:
- `athlete-index.json` → 選手検索・一覧表示
- `club-stats.json` → クラブ分析

選手選択時に詳細データを遅延ロード:
- `rankings/{type}_{className}.json` → 大会別スコア（`loadAthleteDetail()`）
- `/api/lapcenter-runners` or `/data/lapcenter-runners.json` → 巡航速度・ミス率

### 7.4 使用ライブラリ

| ライブラリ | 用途 |
|---|---|
| recharts | LineChart（スコア推移、巡航速度、ミス率） |
| lucide-react | アイコン |
| cheerio | HTML スクレイピング（サーバーサイド） |

---

## 8. データフロー全体図

```
JOY (イベント)  ──→  sync-events Cron  ──→  Supabase Storage (events.json)
                          │
                          ├─→  座標補完 (50件/日)
                          ├─→  LapCenter マッチング
                          └─→  ランキングスクレイプ (水曜)  ──→  rankings/*.json
                                                                    │
                                                              build-analysis-index.ts
                                                                    │
                                                        ┌───────────┴───────────┐
                                                        ▼                       ▼
                                                  athlete-index.json      club-stats.json

LapCenter (成績)  ──→  sync-lapcenter Cron  ──→  Supabase Storage (lapcenter-runners.json)
                          │                              │
                          ├─→  イベントマッチ (日次)       │
                          └─→  走者スクレイプ (水曜,3件)    │
                                                          ▼
                                                  /api/lapcenter-runners  ──→  フロントエンド
                                                  /data/lapcenter-runners.json  (フォールバック)
```

---

## 9. 既知の制限

| 制限 | 詳細 |
|---|---|
| Vercel Hobby Cron 制限 | 1 日 1 回のみ実行可能。2 つの Cron パスを登録しているが、制限内で交互実行される可能性あり |
| Vercel Function タイムアウト | Hobby プランは 60 秒制限。全ランキングスクレイプ（80 クラス × 1.2 秒）は超過リスクあり |
| LapCenter データ欠損 | 一部イベントはLapCenter側にクラスデータなし（例: 中高選手権） |
| Forest/Sprint 分類 | JOY ランキングに出現しない日付のLapCenterデータはチャートに表示されない |
| 手動デプロイ | Vercel Git Integration のWebhookが不安定。`npx vercel --prod` での手動デプロイが必要な場合あり |
| GitHub Actions | PAT に `workflow` スコープがないため `.github/workflows/` のプッシュが未完了 |
