# イベント エントリーリスト表示機能 計画書

作成: 2026-05-27 (JST)
対象: `/events` ページ（`trailsjp.vercel.app/events`）

## 目的

各イベントに JOY のエントリー者一覧を「付随する」形で表示する。
エントリー者を **所属（クラブ）** 単位でグループ化し、**人数の多いクラブから降順** に並べる。
UI は3段ネストの開閉式（アコーディオン）:

```
イベント行
  └─ [エントリーリスト N人] をクリック   ← 1段目: チーム(所属)一覧を開く
       ├─ 東大OLK (39人)  ▸             ← 2段目: クリックでエントリー者一覧を開く
       │     ├─ M21A  山田 太郎
       │     └─ ...
       ├─ 所属なし (30人) ▸
       └─ 入間市OLC (29人) ▸
```

## 確定した仕様（ユーザー回答 2026-05-27）

| 論点 | 決定 |
|------|------|
| “チーム”の定義 | **所属（クラブ）列** でグループ化。空欄は「所属なし」。 |
| 名寄せ（正規化） | **選手ページと同一ロジック**（`normalizeClubName` + 区切り分割）を共有モジュール化して使用 |
| 複数所属の扱い | **分割して各クラブにカウント**（例「桐朋IK/入間市OLC」→両方に1人ずつ）。**二重計上を許容** |
| トータル人数 | **実エントリー行数（ユニーク人数）** を表示。チーム人数の合計とは一致しないことがある |
| 対象イベント | **受付中(open) + 締切済の最近のもの**（過去2000件超は対象外） |
| データ取得方法 | **展開時にオンデマンド取得 + 短時間キャッシュ（1時間）** |

### 名寄せ（選手ページとの共通化）
`scripts/build-analysis-index.ts` 内の `normalizeClubName` と区切り分割ロジック
（`/`・全角空白`　`・`、` で分割 + `CLUB_SPLIT` 特例マップ）を
**`src/lib/club-normalize.ts`** に切り出し、選手ページ（build スクリプト）と新スクレイパーで共有する。
- `normalizeClubName(raw)`: 全角→半角、olc/olk→OLC/OLK、大学略称マップ、大学院・末尾数字・N期除去等
- `splitAffiliations(raw)`: 区切り分割 → 各要素を `normalizeClubName` → 空要素除外（重複除去はしない）
- build-analysis-index.ts は自前定義を削除し共有モジュールを import（挙動は完全同一）

### 「最近の締切済」の定義（実装定数）
`ENTRY_LIST_RECENT_DAYS = 30`。
表示条件 `canShowEntries(event)`:
- `entry_status === "open"` … 受付中は常に表示
- または `event.date >= (今日 - 30日)` … 開催予定（未来日）＋直近30日に開催済を表示

→ 締切済でも開催前/直近の大会は「誰が出るか」確認に有用。30日より前の過去大会は対象外（スクレイピング対象を絞り、JOY 負荷を抑える）。定数は後から調整可能。

## JOY 側の構造（調査済み）

- URL: `https://japan-o-entry.com/event/view/{id}/show_detail`（"エントリーリストを確認する"の遷移先）
- エントリー表はサーバーレンダリング済み HTML（AJAX ではない）→ そのまま取得可
- `<a name="entrylist">` → `<h2>申込状況</h2>` → `<p>N 人が申込済です</p>` → `<table>`
- テーブル列: **クラス / チーム名(氏名) / 所属 / メンバー / 入金**
  - 個人戦: 「チーム名(氏名)」= 個人名、「所属」= クラブ、「メンバー」= `-`
  - リレー/チーム戦: 「チーム名(氏名)」= チーム名、「メンバー」= 構成員
- 締切済イベントでも全リストが表示される（例: 2456 は締切済だが505人表示）
- ページネーションなし（505人が1ページに収まる）
- 検証: cheerio で `th` に「チーム名」を含むテーブルを特定 → 505行/170チーム抽出成功。
  top5 = 東大OLK(39)/所属なし(30)/入間市OLC(29)/名椙OLC(24)/筑波大学(21)

## 実装

### 1. スクレイパー（新規）`src/lib/scraper/entries.ts`

```ts
export interface EntryRow {
  className: string;     // クラス (M21A 等)
  name: string;          // チーム名(氏名)
  affiliation: string;   // 所属（生文字列、空欄は ""）
  members?: string;      // メンバー（"-" 以外のときのみ）
}
export interface TeamGroup {
  affiliation: string;   // 表示名（空欄は "所属なし"）
  count: number;
  entries: EntryRow[];
}
export interface EntryListResult {
  eventId: number;
  total: number;         // 実エントリー行数（=ユニーク人数）。「N 人が申込済」を優先、無ければ行数
  teams: TeamGroup[];    // count 降順、同数は所属名で安定ソート
  fetchedAt: string;     // ISO
}

export async function scrapeEntryList(eventId: number): Promise<EntryListResult>
export function parseEntryList(html: string, eventId: number): EntryListResult
```

- `th` に「チーム名」を含むテーブルを特定（堅牢）。見つからなければ空結果。
- 行パース: `td[0]=クラス, td[1]=名前(空白正規化), td[2]=所属, td[3]=メンバー`。
- **total**: 「N 人が申込済です」の数値を優先採用。無ければエントリー行数。＝実態のユニーク人数。
- **グループ化**: 各エントリーの所属を `splitAffiliations()` で分割・正規化し、得られた各クラブへ計上
  （複数所属は二重計上）。分割結果が空（所属なし/`-`）→ `所属なし` グループへ1件。
- ソート: チームは `count` 降順、同数は `affiliation.localeCompare`。チーム内は元順（=クラス順）維持。
- fetch は `next: { revalidate: 3600 }` で上流HTMLを1時間キャッシュ。

#### 取り扱い（確定）
- 複数所属「桐朋IK/入間市OLC」: **分割して両クラブにカウント（二重計上）**。選手ページと同一。
- 大文字小文字・略称・大学院表記等: `normalizeClubName` で名寄せ（選手ページと同一）。
- チーム人数の合計 ≥ total（複数所属者がいる場合）。ヘッダの total は実人数を表示。
- リレー: `members` があれば表示。所属でグループ化する方針は個人/リレー共通。

### 2. API ルート（新規）`src/app/api/events/[id]/entries/route.ts`

- `GET`。`id` を数値検証。
- `scrapeEntryList(id)` を呼び結果を JSON 返却。
- レスポンスヘッダ `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`（CDN/ブラウザ短期キャッシュ）。
- 失敗時は `{ eventId, total: 0, teams: [], error }` を 200 で返し UI 側で「取得失敗」表示。
- Hobby 10秒制限: 1ページ取得+パースは余裕（パース<100ms）。

### 3. フロント `src/app/events/EventList.tsx`（編集）

- `canShowEntries(event)` ヘルパー追加（上記条件）。
- 状態追加:
  - `openEntryEvent: number | null`（1段目: どのイベントのエントリー欄を開いているか）
  - `entryCache: Record<number, EntryListResult | "loading" | "error">`
  - `openTeams: Set<string>`（2段目: `${eventId}:${affiliation}` で展開管理）
- list 表示の各イベントカードの下に、対象イベントのみトグルボタン
  「エントリーリスト ▸ / ▾（N人）」を表示。N はロード後に表示。
- クリックで開閉、未ロードなら `/api/events/{id}/entries` を fetch。
- 1段目展開時: チーム一覧（降順）。各チームは「所属名 … N人」ボタン + chevron。
- チームクリックで2段目: エントリー者（クラス + 氏名、リレーは members も）。
- ローディング/空/失敗の各状態を用意。
- カレンダー表示は変更なし（list 表示のみ対象）。

### 触るファイル

| 種別 | パス |
|------|------|
| 新規 | `src/lib/scraper/entries.ts` |
| 新規 | `src/app/api/events/[id]/entries/route.ts` |
| 編集 | `src/app/events/EventList.tsx` |

DB・Cron・events.json への変更なし（オンデマンド + fetch キャッシュで完結）。

## 動作確認

1. `npm run dev` → `/events` で受付中イベントに「エントリーリスト」トグルが出る
2. クリックで所属降順のチーム一覧が開く
3. チームクリックでエントリー者が開く
4. 締切済（30日以内）でも表示、古い過去大会では非表示
5. `npm run build` 型エラーなし
