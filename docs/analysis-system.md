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
| `public/data/club-stats.json` | クラブ別統計 | ~380 クラブ |

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
5. 水曜日のみ: Vercel Deployments API で再デプロイをトリガー（`VERCEL_DEPLOY_TOKEN` 使用）

**ランキング更新の自動化:**
- JOY ランキングは火曜更新 → 水曜 03:00 JST に Cron が再デプロイをトリガー
- ビルド時に `build-analysis-index.ts` が JOY から無差別4クラスを全ページ取得
- 既存データとマージ（過去のイベントスコアを保持）
- 手動作業は不要（完全自動化）

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
| `athletes` | 選手マスタ（名前、クラブ、ポイント、特性分類等） | 2,418件 |
| `athlete_appearances` | ランキング出場情報（カテゴリ、順位、ポイント） | 8,750件 |
| `lc_performances` | LapCenter巡航速度・ミス率（選手×イベント×クラス） | 18,848件 |

#### 応援機能

| テーブル / ビュー | 説明 |
|---|---|
| `likes` | いいねデータ（session_id + IP hash で重複防止） |
| `athlete_like_counts` | 選手別いいね数集計ビュー |

RLS 有効: SELECT は誰でも可能。INSERT/UPDATE/DELETE は service role のみ（分析データ）、誰でも可能（likes）。

SQL定義: `docs/sql/001_likes.sql`, `docs/sql/002_analysis_tables.sql`

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

### 6.4 トレンドライン（線形回帰）

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

`/analysis` ページは `AnalysisHub` コンポーネントが 4 つのタブを管理:

| タブ | コンポーネント | 機能 |
|---|---|---|
| 選手分析 | `AthleteDetail` | 個人プロフィール・チャート・大会参加状況 |
| クラブ | `ClubAnalysis` | クラブ別統計・メンバー一覧（全クラブ表示、ブラウザ戻る対応） |
| 比較 | `CompareAthletes` | 2 選手の並列比較・分布図上の位置比較 |
| 応援 | `SupportTab` | トレンド選手一覧・グループ応援・(将来) 寄付金プール分配 |

### 7.2 AthleteDetail の構成

`AthleteDetail` は以下のセクションで構成:

1. **ProfileHeader**: 選手名、クラブ、F・S 無差別平均ポイント
2. **TypeBadge**: 特性分類（スプリンター/フォレスター/オールラウンダー）+ Forest vs Sprint バー
3. **StatsCards**: 安定性 / 最近の調子 / ベストスコア の 3 カード
4. **ScoreChart**: JOY ポイント推移チャート（Forest=緑, Sprint=青）。年齢別無差別クラス（`age_forest/無差別`, `age_sprint/S_無差別`、女子は `女子無差別` / `S_女子無差別`）のスコアのみを使用し、エリートランキングとの重複を排除。
5. **LapCenterChart**: 巡航速度・ミス率推移チャート（2 段構成、線形回帰トレンドライン付き）
6. **RecentEvents**: 月別参加頻度ヒートマップ + 直近 10 大会リスト（成績レベル 5 段階色分け: 好成績=水色, やや良い=緑, 平均的=黄, やや低い=橙, 低い=赤）。各大会名の横に Forest(緑F) / Sprint(青S) タグを表示

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
                          │
                          ├─→  LapCenter マッチング
                          └─→  水曜: Vercel再デプロイトリガー
                                       │
                                 build-analysis-index.ts（ビルド時実行）
                                       │
                                       ├─→  JOY から無差別4クラス全ページ取得 → rankings/*.json 更新
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
| デプロイ | `npx vercel --prod` での手動デプロイ、または水曜 Cron による自動再デプロイ |
| GitHub Actions | PAT に `workflow` スコープがないため `.github/workflows/` のプッシュが未完了 |

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

### 10.3 今後の構想（Phase 3: 寄付金プール分配）

個人への直接寄付（PayPay送金リンク型）は廃止。代わりにプール型分配モデルを採用。

**仕組み:**
- 閲覧者からの寄付金は運営の一か所（寄付リンク）に集約
- 半年ごと（4月・10月など）に集計期間のハート数で按分して各選手に分配
- 分配額 = プール総額 × (選手のハート数 / 全選手ハート数合計)
- 分配方法: 管理者が手動で各選手に送金（選手の受取情報は別途収集）
- 透明性: 分配結果をサイト上で公開（総額・各選手のハート数・分配額）

**メリット:**
- 個人間の寄付額格差が表面化しない（本人の気持ちを守る）
- 本人確認・PayPay リンク登録が不要（運営が一括管理）
- シンプルな運用（寄付受付口座1つ + 半年ごとの集計・送金）
