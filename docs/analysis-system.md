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
│  │  build-analysis  │ │  sync-events      │ │  Supabase DB      │      │
│  │  scrape-lc-run.  │ │  sync-lapcenter   │ │  + Storage/JSON   │      │
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

オリエンテーリングのエントリー管理・ランキングサイト（japan-o-entry.com）。

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

**巡航速度** (cruising speed): LapCenter が算出する走行速度指標。低いほど速い。
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
1. イベント名を正規化（全角→半角、回次・年度・括弧内の除去、大学略称展開、イベント略称展開、表記揺れ統一）
2. ストップワード除去後の完全一致
3. 部分文字列一致（3文字以上）
4. 有意語トークンの双方向含有チェック
5. トライグラム類似度（閾値 0.65 以上、5 共通以上）

**正規化で適用される名寄せ:**
- 大学略称展開（21校）: 筑波大→筑波大学、新大→新潟大学、神大→神戸大学 等
- イベント略称展開: BMO→忘年マウンテンオリエンテーリング、OMO→奥武蔵マウンテンオリエンテーリング、スプセレ→スプリントセレクション、インカレ→日本学生選手権 等
- 表記揺れ: ウエ→ウェ

現在 912 イベントが JOY ↔ LapCenter で紐づけ済み。

---

## 3. バッチ処理スクリプト

### 3.1 分析インデックスビルド (`scripts/build-analysis-index.ts`)

全ランキング JSON を読み込み、以下の2ファイルを生成:

| 出力ファイル | 内容 | サイズ目安 |
|---|---|---|
| `public/data/athlete-index.json` | 全選手の軽量プロフィール（検索・一覧用） | ~4,400 選手 |
| `public/data/club-stats.json` | クラブ別統計 | ~400 クラブ |

**選手プロフィール (`AthleteSummary`) の構成:**

```typescript
interface AthleteSummary {
  name: string;              // 選手名
  clubs: string[];           // 所属クラブ（名寄せ済み）
  appearances: RankingRef[]; // 出場カテゴリ一覧
  bestRank: number;          // 最高順位
  avgTotalPoints: number;        // F・S 無差別平均ポイント
  forestCount: number;       // Forest カテゴリ数
  sprintCount: number;       // Sprint カテゴリ数
  type: "sprinter" | "forester" | "allrounder" | "unknown";
  recentForm: number;        // 直近3大会 vs 全体平均 (%), 種目別算出
}
```

**特性分類ロジック (`classifyType`):**

年齢別無差別カテゴリ（`age_forest/無差別`, `age_sprint/S_無差別`）の totalPoints を z-score で正規化して比較。Forest と Sprint はスコア体系が異なるため、母集団の平均・標準偏差で正規化した上で差を判定する。

1. 両方の無差別カテゴリに出場 → z-score 差で判定（閾値 0.3）
   - `fZ - sZ > 0.3` → forester
   - `fZ - sZ < -0.3` → sprinter
   - それ以外 → allrounder
2. Forest 無差別のみ出場 → forester
3. Sprint 無差別のみ出場 → sprinter
4. どちらも未出場 → appearances の種目で判定（Forest のみ→forester 等）

**avgTotalPoints の算出:**

年齢別無差別カテゴリ（`age_forest/無差別` と `age_sprint/S_無差別`）のポイントの平均値。女子選手は `女子無差別` / `S_女子無差別` を使用。どちらか一方しかない場合はその値をそのまま使用。

各カテゴリの totalPoints は、JOY ランキング規則に基づき**上位3大会の獲得点の合計**で算出される。ProfileHeader で展開すると、どの大会が上位3に該当するか確認できる。

**クラブ名の名寄せ (`normalizeClubName`):**

JOY のクラブ名表記のゆれを統一:
- 全角英数字 → 半角
- 大学OLC略称 → 正式大学名（例: 京大OLC → 京都大学）
- 大学院 → 大学
- 末尾数字・期数の除去（例: 金大OLC44期 → 金沢大学）
- 日本語名の末尾数字除去（例: 青葉会18 → 青葉会、越王会'14 → 越王会）
- OLクラブ → OLC
- 個別エイリアス（大阪 → 大阪OLC、練馬 → 練馬OLC、新潟 → 新潟大学、金沢 → 金沢大学、神戸 → 神戸大学）

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
        "s": 87.3,            // 巡航速度（低いほど速い）
        "m": 12.5,            // ミス率 (%)
        "t": "forest"         // forest | sprint
      }
    ]
  },
  "generatedAt": "2026-03-01T..."
}
```

**現在のデータ規模:** 2,289 選手 / 18,848 パフォーマンスレコード（DB `lc_performances` テーブル）

> **注記**: 以前は `public/data/lapcenter-runners.json` に出力していたが、Phase 1 DB移行により `lc_performances` テーブルに移行済み。Cron (`sync-lapcenter`) も DB に直接書き込む。

---

## 4. 自動化 (Vercel Cron)

Vercel Hobby プラン（1 日 1 回制限）で 2 つの Cron ジョブを運用:

### 4.1 イベント同期 (`/api/cron/sync-events`)

| 項目 | 値 |
|---|---|
| スケジュール | 毎日 03:00 JST (18:00 UTC) |
| 実行内容 | JOY イベント同期 + LC マッチング |
| 水曜追加 | Vercel 再デプロイをトリガー（ビルド時にランキング最新取得） |

**処理フロー:**
1. JOY トップページ + アーカイブからイベント取得
2. 既存データとマージ（座標・LC リンクを引き継ぎ）
3. LapCenter イベントマッチング
4. Supabase Storage に保存
5. 水曜日のみ: Vercel Deploy Hook で再デプロイをトリガー（`VERCEL_DEPLOY_HOOK` 使用）
6. 実行結果を Supabase `cron_log` テーブルに記録

**ランキング更新の自動化:**
- JOY ランキングは火曜更新 → 水曜 03:00 JST に Cron が再デプロイをトリガー
- ビルド時に `build-analysis-index.ts` がランキングを取得:
  - Proxy API (`/api/rankings/proxy`) 経由で JOY から無差別4クラスを全ページ取得
  - Vercel ビルド環境から JOY への直接 curl が失敗するため、前回デプロイの Serverless Function をプロキシとして使用
  - プロキシ失敗時は JOY 直接 fetch にフォールバック
- 既存データとマージ（過去のイベントスコアを保持）
- 手動作業は不要（完全自動化、PC 起動不要）

### 4.2 LapCenter 同期 (`/api/cron/sync-lapcenter`)

| 項目 | 値 |
|---|---|
| スケジュール | 毎日 12:00 JST (03:00 UTC) |
| 実行内容 | LC イベントマッチング（日次） |
| 水曜追加 | 巡航速度・ミス率スクレイプ（最大 3 イベント/回） |

**処理フロー:**
1. 未マッチイベントに対して LapCenter イベント自動マッチング
2. 水曜日のみ: 未処理 LC イベント（新しい順、最大 3 件）から走者データをスクレイプ
3. Supabase DB (`lc_performances` テーブル) にバッチ upsert

---

## 5. データ永続化

### 5.1 Supabase PostgreSQL

#### 分析データ（Phase 1 DB移行済み）

| テーブル | 説明 | データ量 |
|---|---|---|
| `athletes` | 選手マスタ（名前、クラブ、ポイント、特性分類等） | ~2,500件 |
| `athlete_appearances` | ランキング出場情報（カテゴリ、順位、ポイント） | 8,750件 |
| `lc_performances` | LapCenter巡航速度・ミス率（選手×イベント×クラス） | 18,848件 |

#### 応援機能

| テーブル / ビュー | 説明 |
|---|---|
| `likes` | いいねデータ（session_id + IP hash で重複防止） |
| `athlete_like_counts` | 選手別いいね数集計ビュー |

#### 運用監視・スナップショット

| テーブル | 説明 |
|---|---|
| `cron_log` | Cron ジョブ実行ログ（job_name, status, result, duration_ms, created_at） |
| `club_stats_snapshot` | クラブ統計月次スナップショット（前月比・前年比算出用） |
| `ranking_snapshot` | ランキング月次スナップショット（順位・ポイント変動算出用） |

ビルド時に現月のスナップショットを保存し、前月・前年のスナップショットと比較してdeltaを算出。クラブ一覧とランキングページに増減を表示。

RLS 有効: SELECT は誰でも可能。INSERT/UPDATE/DELETE は service role のみ（分析データ・cron_log・スナップショット）、誰でも可能（likes）。

SQL定義: `docs/sql/001_likes.sql`, `docs/sql/002_analysis_tables.sql`, `supabase/migrations/20260325_create_cron_log.sql`, `supabase/migrations/20260327_create_club_stats_snapshot.sql`

### 5.2 Supabase Storage

| バケット | ファイル | 用途 |
|---|---|---|
| `app-data` | `events.json` | イベントデータ（Cron 更新） |

`events-store.ts` が読み書きを担当。

> **廃止済み**: `lapcenter-runners.json` は Supabase Storage から削除。LC データは `lc_performances` テーブルに移行済み。

### 5.3 静的 JSON（ビルド時同梱、Phase 2 で廃止予定）

| ファイル | 生成元 | 更新タイミング |
|---|---|---|
| `public/data/rankings/*.json` | `build-analysis-index.ts` (ビルド時JOY取得) + `scrape-rankings.mjs` (手動フル取得) | ビルド時自動（水曜Cron再デプロイ） |
| `public/data/athlete-index.json` | `build-analysis-index.ts` | ビルド時自動 |
| `public/data/club-stats.json` | `build-analysis-index.ts` | ビルド時自動 |
| `src/data/events.json` | `scrapeEvents()` + 手動編集 | 手動 + Cron |

> **廃止済み**: `public/data/lapcenter-runners.json` はクライアントからの直接参照を廃止。LC データは DB API 経由で取得。

### 5.4 API エンドポイント

| パス | 説明 | データソース |
|---|---|---|
| `GET /api/rankings/proxy` | JOY ランキングページのプロキシ（ビルド時使用、CRON_SECRET 認証） | JOY 直接 fetch |
| `GET /api/lc/[name]` | 1選手のLC巡航速度・ミス率全履歴 | DB (`lc_performances`) |
| `GET /api/athletes/search?q=xxx` | 選手名・クラブ名で検索（上位20件） | DB (`athletes`) |
| `GET /api/athletes/[name]` | 1選手の詳細情報（appearances含む） | DB (`athletes` + `athlete_appearances`) |
| `POST /api/likes` | いいね送信（session_id + IP hash で重複防止、409 で既にいいね済み） | DB (`likes`) |
| `GET /api/likes?athletes=A,B` | 指定選手のいいね数取得 | DB (`athlete_like_counts`) |
| `GET /api/likes/top?limit=10` | いいね数上位ランキング取得 | DB (`athlete_like_counts`) |

フロントエンドは DB ベースの API から直接データを取得（フォールバック不要）:
```
AthleteDetail / CompareAthletes → /api/lc/[name] (DB, 1選手分のみ、数KB)
```

> **廃止済み**: `GET /api/lapcenter-runners`（全選手2.8MB一括返却）は廃止。`/api/lc/[name]` に置き換え。

---

## 6. 分析ロジック

### 6.1 統計指標 (`src/lib/analysis/utils.ts`)

| 指標 | 関数 | 算出方法 |
|---|---|---|
| **安定性** | `calcConsistency()` | 変動係数 (CV = σ/μ) の逆数を 0-100 にマッピング。`score = (1 - CV/0.3) × 100`。CV=0 で 100、CV≧0.3 で 0。 |
| **最近の調子** | `calcRecentForm()` | 直近 3 大会の平均ポイントと全体平均の差を%表示。種目別算出（後述） |
| **ベストスコア** | `getAllEvents()` から最大値 | カテゴリ横断で重複排除した全イベントから最高得点を抽出 |

### 6.2 最近の調子 (recentForm) — 種目別算出

`recentForm` は選手の `type` に基づき、主戦場の種目のみでスコア推移を評価する:

| 選手タイプ | 算出対象 |
|---|---|
| Forester | Forest イベントのみ |
| Sprinter | Sprint イベントのみ |
| Allrounder | Forest と Sprint を個別に算出し平均 |
| Unknown | データが多い方、または両方の平均 |

算出式: `(直近3大会の平均 - 全体平均) / 全体平均 × 100`（%）

ビルドスクリプト (`build-analysis-index.ts`) と フロントエンド (`utils.ts`) の両方で同一ロジックを使用。イベント名は末尾「大会」を除去して正規化し、エリート/年齢別間の表記ゆれ（野呂山 ↔ 野呂山大会）による重複を防止。

### 6.3 Forest / Sprint 分類（LapCenter データ）

LapCenter のイベントデータには Forest / Sprint の区分がないため、JOY のランキングカテゴリ情報を使って判定:

1. JOY ランキングの各イベントから日付とランキングタイプ（forest / sprint）を収集
2. LapCenter のデータと日付で突合
3. 同日に1カテゴリしかなければそのタイプを採用
4. 複数カテゴリがある場合はイベント名のファジーマッチングで特定
5. JOY にない日付のデータはチャートに表示しない

### 6.4 トレンドライン（Theil–Sen 頑健回帰）

サイト内の全トレンド線（スコア推移・巡航速度・ミス率・比較ページ）は Forest / Sprint 独立に **Theil–Sen 回帰**で描画する（2026-07 に最小二乗から置換）:

```
slope     = median( (y_j - y_i) / (x_j - x_i) )   全ペア i<j（Δx=0 は除外）
intercept = median( y_i - slope·x_i )
```

- x はレース順（等間隔 index）。暦時間ベースの傾きではない（不等間隔の日付軸と描画を一致させるため）
- **5点未満はトレンド線を表示しない**（小標本のトレンドは誤導）。旧実装の4点ゲートから引き上げ
- 数値スロープは表示しない（レース順ベースの値に時間単位の意味がないため）
- 値のあるデータ点のみで係数を算出し、最初と最後のデータ点に回帰値を配置して直線を描画

最小二乗でなく Theil–Sen を使う理由: 単発の大崩れレース（外れ値）でトレンドの向きが反転しない（breakdown point ~29%）。

### 6.5 クロスレース分析（同水準巡航速度帯のミス残差）— Stage 1

方法論プラン層Aのスカラー版。入力は LapCenter が算出した per-race スカラー（巡航速度・ミス率）のみで、**再計算はしない**（relay-first）。per-leg ミス指紋・信頼度加重は Stage 2（per-leg DB ingestion 後）。

種目 d ∈ {forest, sprint} ごとに独立に、当該種目 **n≥5 レース**の選手のみを対象に:

1. **走力プロキシ** x_i = 巡航速度の中央値。**注意: 巡航速度は出走クラスのトップ3（Ave3）基準の相対値であり、クラスをまたぐ絶対走力ではない**（絶対走力αは層B・対象外）。x は「普段の出走フィールドに対する優位度」の代理
2. **ミス水準** y_i = ミス率の中央値（典型レースを測る・単発大崩れに頑健）
3. **高ミス率レース**: 種目内全レースのミス率の第3四分位 Q3 を閾値とし、本人レースのうち miss≥Q3 の本数/総数を併記（中央値が捨てる大崩れ情報を回収。閾値はデータ駆動）
4. **期待ミス率**: 対象選手の (x_i, y_i) に Theil–Sen 回帰。leave-one-out は N≈数百で影響 O(1/N) のため省略
5. **残差** e_i = y_i − ŷ(x_i)（負=期待よりミスが少ない=良い）。z = e/(1.4826·MAD)（MAD=0 は z=0・**z は UI 非表示の診断値**）。表示は順位百分位を **10% 幅の帯**に丸めた「ミスの少なさ 上位P帯」（小標本で精密に見せない）
6. **明記する限界**: (i) コホートは JOY ランキング掲載選手 × LapCenter 取込レースのみ＝母集団非網羅・選抜バイアス (ii) 走力プロキシのクラス相対性・共有基準（トップ3）由来のアーティファクト・測定誤差による回帰の希薄化 (iii) forest/sprint の2分では ミドル/ロング・地形・地域・コース難度・年度差を吸収できない (iv) 一次近似のため分布の端（極端に速い/遅い）では適合が粗い (v) パック走行・フォーク/リレーは per-race スカラーからは検出不能 (vi) 同姓同名は同一人物として合算されうる (vii) race_type は JOY 週次バックフィルで自己修復されるが残誤分類がありうる

生成: `scripts/build-analysis-index.ts` がビルド時に `lc_performances` 全行（Range ページング）から `public/data/cross-race.json`（~130KB）を生成。失敗時は既存ファイル保持（無ければ空スケルトン）でビルド継続。表示: `CrossRaceCard`（選手ページ・LapCenterChart の下）。

### 6.6 per-leg 取込（lc_leg_splits）と「順位が動いたレッグ」— Stage 2a

**per-leg 取込**: `sync-lapcenter` cron は split-list を詳細パース（`parseSplitListDetailed`・scalar 版と同一 URL＝追加リクエストなし）し、1回のフェッチから
- `lc_performances`（従来と同一選別のスカラー行）
- `lc_leg_splits`（**全走者**の per-leg 配列行。MP/DISQ/DNS も rank=null で保持＝DNF クリーンプレフィックス確保）

の両方を書き込む。クラス保持ルール＝追跡選手が1人以上いるクラスのみ・そのクラスは全走者保存（フィールド中央値・コホート基盤に必要）。イベント選択は取込台帳 `lc_leg_events`（lc_event_id 基準・classes>0 のときのみ記帳）で管理し、歴史イベントは `scripts/backfill-lc-legs.ts`（Management API 書込・resume 可能）で一括投入する。race_type は週次の JOY バックフィルが両テーブルを PATCH する。

**順位が動いたレッグ（⑤・単一レースページ）**:
- 主指標 = **通過順位の平均変動**: 各レッグでの LapCenter elapsedRank（relay）の 1人あたり |Δ順位| 平均。仮定ゼロの記述統計で、単独クラッシュも順位変動として自然に現れる
- 副指標 = **ミス残差連動度 C(l)** = Σ(R_l−mean)((T−R_l)−mean) / Σ(T−mean)²。R = legLossTime（符号付き残差・relay）、**T = R の行和**（最終タイムは走力・レッグ長に支配され、totalLossTime=Σmax(0,·) は非線形で「合計から自レッグを除く」構成と相性が悪い）。分子分母同一除数＝ddof 非依存。コホート＝優勝+25%以内の完走者・全レッグ parseable
- ゲート: 完走者<8 非表示／コホート<15 は「参考」／**百分率表現は全面禁止**（ΣC(l)=1 は成立しない・相対バーのみ）
- 明記する限界: 巡航ペース推定を介した自己相関の残存（厳密な独立分解ではない）／長いレッグほど残差分散が構造的に大きい／コホートは結果による選択（上位完走者内の傾向に限定）／リレー・フォーク構造の自動検出は未実装（クラス名ベースの表示抑制のみ）
- 参考値: Spearman ρ(区間タイム, 最終タイム)（同順位平均・分散0は null）

### 6.7 ミスの傾向（クロスレース）＋信頼度加重トレンド — Stage 2b

入力は `lc_leg_splits` の relay 値のみ（lap_sec/leg_loss_sec/leg_speed/elapsed_sec/start_time/speed/rank）。種目独立。生成はビルド時 `buildLegFingerprintStep`（2本の pruned select・#33 ページングイディオム・<40k 行ガード）→ `public/data/leg-fingerprint.json`（~2.1MB）。

**ミス判定（規約）**: `loss ≥ max(FLOOR_d, 0.30×(lap−loss))`。lap−loss = Ave3·(speed/100) は LapCenter 恒等式（=自分の巡航ペース想定タイム）。FLOOR は罠レッグ判定と同値（forest 10s/sprint 5s）。**0.30 に自然な切れ目はなく、実測ミス率（forest ≈18-21%・sprint ≈12-13%＝3-4本/レース）に較正した運用上の規約**である（params として artifact に埋込・公開）。ミスは「LapCenter loss event」であり、ナビミスそのもの・パック・地形・コンディション・安全ルートを区別しない。

**パック除染**: clock[k]=start+elapsed[k] のペア間 |Δ|≤ε（forest 15s/sprint 10s）が4境界以上連続する run の内部レッグを**両者とも**除外（リーダー/フォロワー識別なし）。**除外は無作為ではない**（パック発生は能力・局面・スタート間隔に依存）ため除外数を選手ごとに表示し、除染 ON/OFF の感度分析でフラグ一致率 99.1% を確認済（2026-07-07 実データ）。start 不明レースは未チェック採用＋件数開示。パック過半レースは除外。実測パックレッグ率: forest 11.4%/sprint 9.4%。

**セル分類**: 局面=レッグ index ターシル（序/中/終盤）× レッグ長=レース内 Ave3（=100·lap/leg_speed・丸め±0.5%）ターシル＝9セル。レースゲート=除染後クリーンレッグ≥6・選手ゲート=racesUsed≥5 かつ legsValid≥50。

**セル検定（レース層別 permutation）**: 各レースのミス総数を固定してレッグへの割当を並べ替えた帰無分布（B=400・決定的シード）に対する片側経験 p 値 → BH-FDR（q=0.10・family=選手×種目内の9セル）→ さらに効果量ゲート（自己基準率の1.3倍以上）。**exact 二項は不採用**（レース内相関・日次調子で独立性が壊れ名目より甘くなる。permutation はレースごとのミス総数を保存するためこれらを帰無に取り込む）。フラグの約1割は偶然でも生じうる（FDR の定義）ことを UI で開示。

**重大度**: Δ 3ビン（forest [10,30)/[30,90)/[90,∞)s・sprint [5,15)/[15,45)/[45,∞)s）＋ミスの ρ 中央値。

**lag-1 動揺（参考）**: Mantel–Haenszel 層別（層=レース）RR＋同じ permutation による p ≤ 0.10 と標本ゲート（Σn1≥15・Σn0≥30）を通過したときのみ表示。**コース系列の交絡（難レッグの連続配置等）は除去できない**ため「参考」表示に留める。

**信頼度加重トレンド**: レース重み w=クリーンレッグ数×min(出走規模,20)（Ave3=上位3平均のため規模の情報量が飽和）。Theil–Sen を加重中央値化（slope: w_i·w_j／intercept: w_i・等重みで無加重版と厳密一致）。reliable=クリーンレッグ≥6∧規模≥5 が5本未満なら線を抑制。artifact に無いレースは既知重みの中央値で補完し reliable 扱い（メタデータ欠測で退行させない）。照合は（種目, 日付）・同日複数レースは max(w)。

**方法論からの明示的置換**: 上位方法論（2026-06-29 §153）の「FDR後の残差のみプール」は混合モデルの per-leg 事後確率を前提とした要求である。relay-first では per-leg の仮説検定が存在しない（決定的閾値判定）ため、**多重性の制御はセルレベルの permutation＋BH に置換**した（方法論文書側にも追記済み）。

---

## 7. フロントエンド構成

### 7.1 ページ構成

`/analysis` ページは `AnalysisHub` コンポーネントが 4 つのタブを管理:

| タブ | コンポーネント | 機能 |
|---|---|---|
| 選手分析 | `AthleteDetail` | 個人プロフィール・チャート・大会参加状況 |
| クラブ | `ClubAnalysis` | クラブ別統計・メンバー一覧（全クラブ表示、ブラウザ戻る対応） |
| 比較 | `CompareAthletes` | 2 選手の並列比較・分布図上の位置比較 |
| 応援 | `SupportTab` | トレンド選手一覧・グループ応援・(将来) 寄付金プール分配 |

### 7.2 AthleteDetail の構成

`AthleteDetail` は以下のセクションで構成:

1. **ProfileHeader**: 選手名、クラブ、F・S 無差別平均ポイント（展開で上位3大会の内訳・計算式を表示）
2. **TypeBadge**: 特性分類（スプリンター/フォレスター/オールラウンダー）+ Forest vs Sprint バー
3. **StatsCards**: 安定性 / 最近の調子 / ベストスコア の 3 カード
4. **ScoreChart**: JOY ポイント推移チャート（Forest=緑, Sprint=青）。年齢別無差別クラス（`age_forest/無差別`, `age_sprint/S_無差別`、女子は `女子無差別` / `S_女子無差別`）のスコアのみを使用し、エリートランキングとの重複を排除。
5. **LapCenterChart**: 巡航速度・ミス率推移チャート（2 段構成、Theil–Sen トレンドライン付き）
6. **CrossRaceCard**: クロスレース分析（同水準巡航速度帯のミス残差・§6.5）。`public/data/cross-race.json` を参照し、未掲載選手（種目 n<5）は非表示
7. **RecentEvents**: 月別参加頻度ヒートマップ + 直近 10 大会リスト（成績レベル 5 段階色分け: 好成績=水色, やや良い=緑, 平均的=黄, やや低い=橙, 低い=赤）。各大会名の横に Forest(緑F) / Sprint(青S) タグを表示

LapCenter チャートはデータが 2 件以上ある選手にのみ表示。

### 7.3 データロード

ページ初期化時に軽量インデックス 2 ファイルをフェッチ（Phase 2 で API 化予定）:
- `athlete-index.json` → 選手検索・一覧表示・分布図
- `club-stats.json` → クラブ分析

選手選択時に詳細データを遅延ロード:
- `rankings/{type}_{className}.json` → 大会別スコア（`loadAthleteDetail()`）
- `/api/lc/[name]` → 巡航速度・ミス率（DB から1選手分のみ取得、数KB）

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
                          │                         + cron_log に記録
                          ├─→  LapCenter マッチング
                          └─→  水曜: Deploy Hook で再デプロイトリガー
                                       │
                                 build-analysis-index.ts（ビルド時実行）
                                       │
                                       ├─→  Proxy API 経由で JOY から無差別4クラス全ページ取得 → rankings/*.json 更新
                                       │
                                       ├───────────────────────────┐
                                       ▼                           ▼
                                 athlete-index.json          club-stats.json
                                 (Phase 2 で DB化予定)       (Phase 2 で DB化予定)

LapCenter (成績)  ──→  sync-lapcenter Cron  ──→  Supabase DB (lc_performances テーブル)
                          │                              │
                          ├─→  イベントマッチ (日次)       │
                          └─→  走者スクレイプ (水曜,3件)    │
                                                          ▼
                                                  /api/lc/[name]  ──→  フロントエンド
                                                  (1選手分のみ、数KB、CDNキャッシュ1h)
```

---

## 9. 既知の制限

| 制限 | 詳細 |
|---|---|
| Vercel Hobby Cron 制限 | 1 日 1 回のみ実行可能。2 つの Cron パスを登録 |
| Vercel Function タイムアウト | Hobby プランは 10 秒制限。ランキング取得はビルド時に実行（45分制限内） |
| LapCenter データ欠損 | 一部イベントはLapCenter側にクラスデータなし（例: 中高選手権） |
| Forest/Sprint 分類 | JOY ランキングに出現しない日付のLapCenterデータはチャートに表示されない |
| デプロイ | `npx vercel --prod` での手動デプロイ、または水曜 Cron による自動再デプロイ（Deploy Hook） |
| ランキング取得 | Vercel ビルド環境から JOY への直接 curl が失敗するため、Proxy API 経由で取得。初回デプロイ時はプロキシ未配置のためフォールバック動作 |

---

## 10. 応援機能

### 10.1 概要

選手の調子（recentForm）に基づいてトレンド選手を一覧化し、閲覧者がグループ応援で選手を応援できる機能。寄付金はプラットフォームが一か所で集め、半年ごとにハート数に応じて選手に分配する。

### 10.2 現在の実装（Phase 1-2.5）

| 機能 | 状態 | 説明 |
|---|---|---|
| トレンド一覧 | 実装済み | 調子上昇中20名 / 下降中20名（bestRank ≤ 500 かつ recentForm ≠ 0） |
| 種目バッジ | 実装済み | Forester(緑F), Sprinter(青S), Allrounder(紫F+S) |
| グループ応援 | 実装済み | セクション単位（上昇中/下降中）で20名一括応援。即時アニメーション + バックグラウンドAPI |
| ハート表示 | 実装済み | LikeDisplay（表示のみ、クリック不可）。カウントは一括取得 |
| 応援アニメーション | 実装済み | GroupCelebrationOverlay: 20名の名前を5秒間表示、パーティクル演出 |

