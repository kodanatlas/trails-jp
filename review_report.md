# trails_jp コードレビュー報告書

**レビュー日**: 2026-03-08
**対象**: trails_jp（日本オリエンテーリング総合プラットフォーム）
**技術スタック**: Next.js 16 / React 19 / TypeScript 5 / Supabase / MapLibre GL / Recharts

---

## サマリー

| 観点 | Critical | High | Medium | Low | 合計 |
|------|----------|------|--------|-----|------|
| コード品質 | 1 | 7 | 7 | 3 | 18 |
| パフォーマンス | 3 | 4 | 5 | 3 | 15 |
| セキュリティ | 3 | 3 | 4 | 3 | 13 |
| 保守性 | 1 | 4 | 6 | 7 | 18 |
| **合計** | **8** | **18** | **22** | **16** | **64** |

---

## 1. コード品質（型安全性・エラーハンドリング・重複コード）

### 1.1 型安全性

#### [High] `any` 型の使用（15箇所以上）

`eslint-disable` で抑制された `any` が多数存在。MapLibre・Recharts 等のライブラリ起因のものもあるが、適切な型付けが可能なものも多い。

| ファイル | 行 | 内容 |
|---------|-----|------|
| `src/app/api/cron/sync-lapcenter/route.ts` | 106 | `Object.entries(athleteIndex.athletes) as [string, any][]` |
| `src/app/analysis/AthleteDetail.tsx` | 379, 701, 712, 729 | Recharts コールバックの `any` |
| `src/app/analysis/CompareAthletes.tsx` | 685 | Tooltip の `any` |
| `src/app/maps/MapBrowser.tsx` | 61 | `useRef<any>(null)` → `maplibregl.Map \| null` が使える |
| `src/app/tracking/[eventId]/TrackingView.tsx` | 71 | 同上 |

#### [High] 重複する型定義: `LCPerformance` vs `LapCenterPerformance`

構造が完全に同一の2つの interface が別ファイルに存在:

- `src/lib/lapcenter-runners-store.ts:6-13` → `LCPerformance`
- `src/lib/analysis/types.ts:65-72` → `LapCenterPerformance`

同様に `LCRunnersData` と `LapCenterIndex` も重複。一方を削除して re-export すべき。

#### [Medium] Supabase クエリに DB スキーマ型がない

```typescript
// src/lib/supabase-admin.ts
export const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, secretKey);
```

`createClient<Database>(...)` とすべき。現状では `.from("likes")` 等のクエリ結果がすべて `any` になる。`supabase gen types typescript` で型を生成して適用すべき。

#### [Medium] `TERRAIN_LABELS` の型が緩い

```typescript
// src/lib/utils.ts:37
export const TERRAIN_LABELS: Record<string, string> = { ... };
// → Record<TerrainType, string> にすべき
```

#### [Medium] JSON パース結果が未型付け

```typescript
// src/app/api/cron/sync-lapcenter/route.ts:102-103
const athleteIndex = JSON.parse(readFileSync(...));
// → as AthleteIndex を付けるべき
```

---

### 1.2 エラーハンドリング

#### [Critical] Error Boundary が一切存在しない

プロジェクト全体に `error.tsx` ファイルがゼロ。Next.js App Router では各ルートセグメントに `error.tsx` を配置できるが、一つも存在しない。コンポーネントがスローした場合、アプリ全体がクラッシュする。

**対策**: 最低限 `src/app/error.tsx`（グローバル）と `src/app/analysis/error.tsx`（データ量が多い分析セクション）を追加。

#### [High] 15箇所以上の `catch {}` でエラーが握りつぶされている

| ファイル | 行 | 影響 |
|---------|-----|------|
| `src/lib/events-store.ts` | 31 | Supabase ダウンロード失敗がサイレント |
| `src/lib/lapcenter-runners-store.ts` | 34 | 同上 |
| `src/lib/analysis/utils.ts` | 71 | ランキングファイル fetch 失敗が無視される |
| `src/app/analysis/LikeButton.tsx` | 57 | API 呼び出し失敗のフィードバックなし |
| `src/app/rankings/RankingView.tsx` | 76-77 | fetch 失敗で空データ表示（エラー表示なし）|
| `src/app/maps/MapBrowser.tsx` | 224 | レイヤー操作のサイレント失敗 |
| `src/components/AuthGuard.tsx` | 305 | `getCurrentUser()` の失敗が無視される |

#### [Medium] 外部 fetch で `res.ok` チェックがない

```typescript
// src/lib/scraper/events.ts:29-34
const res = await fetch(BASE_URL, { ... });
const html = await res.text();  // 500/403 でもそのままパース
return parseEventList(html);
```

`scrapeEventCoordinates`（265行目）では正しくチェックしているが、`scrapeEventList` と `scrapeArchive` では未チェック。

#### [Medium] Likes API で全エラーがサイレントスキップ

```typescript
// src/app/api/likes/route.ts:32-36
const { error } = await supabaseAdmin.from("likes").insert({ ... });
if (!error) inserted++;
// コメント「23505 (unique violation) はスキップ」だが、実際は全エラーがスキップされる
```

---

### 1.3 重複コード

#### [High] `linReg`（線形回帰）関数が3箇所に重複

- `src/app/analysis/AthleteDetail.tsx:270-284` と `559-573`（同一ファイル内でも2回）
- `src/app/analysis/CompareAthletes.tsx:519-533`

→ `src/lib/analysis/utils.ts` に統合すべき。

#### [High] `stripEventNoise` / `eventFuzzyMatch` が3系統存在

- `src/app/analysis/AthleteDetail.tsx:455-487`
- `src/app/analysis/CompareAthletes.tsx:430-462`
- `src/lib/scraper/lapcenter.ts:86-176`（`normalize` / `fuzzyMatch` として類似実装）

#### [High] `getChartCutoff` が3ファイルに重複

- `AthleteDetail.tsx:218-227`
- `CompareAthletes.tsx:508-517`
- `events/EventList.tsx:28-40`（`getDateRangeCutoff` として同一ロジック）

#### [Medium] Cron 認証パターンの重複

`sync-events/route.ts:13-19` と `sync-lapcenter/route.ts:44-51` で同一の認証チェックが繰り返されている。共通ミドルウェアに抽出すべき。

#### [Medium] 全角→半角変換の重複（3箇所）

```typescript
s.replace(/[A-Za-z0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
```

- `src/lib/scraper/lapcenter.ts:88-89`
- `src/app/api/cron/sync-lapcenter/route.ts:26-28`
- `src/app/analysis/AthleteDetail.tsx:457`

---

## 2. パフォーマンス

### 2.1 データサイズ問題

#### [Critical] 13MB の rankings.json がバンドルに埋め込まれている

```typescript
// src/app/page.tsx:6
import rankingsJson from "@/data/rankings.json";
```

13MB のファイルがサーバーバンドルに直接含まれる。ホームページでは選手数カウントにしか使われていない。

**対策**: 選手数をビルドスクリプトで事前計算するか、`fs.readFileSync` で読む。

#### [Critical] 2.7MB の JSON をクライアントで全量 fetch

```typescript
// src/app/analysis/AnalysisHub.tsx:42-51
Promise.all([
  fetch("/data/athlete-index.json").then((r) => r.json()),  // 2.1MB
  fetch("/data/club-stats.json").then((r) => r.json()),     // 578KB
])
```

モバイルではネットワーク遅延とメモリ不足が深刻。Server Component でフィルタリングするか、検索 API を作成すべき。

#### [Critical] 2.8MB の lapcenter-runners.json をフォールバックで全量ダウンロード

```typescript
// src/app/analysis/AthleteDetail.tsx:30-44
// APIが404を返すと全量JSONをダウンロードし、1選手のデータだけ抽出
```

**公開 JSON ファイルの合計サイズ（gzip前）**: 約 **15MB**

| ファイル | サイズ |
|---------|--------|
| `public/data/rankings/` (77ファイル) | 9.0MB |
| `public/data/lapcenter-runners.json` | 2.8MB |
| `public/data/athlete-index.json` | 2.1MB |
| `public/data/club-stats.json` | 578KB |
| `public/data/events.json` | 146KB |

### 2.2 バンドルサイズ

#### [High] Recharts が dynamic import されていない

Recharts（約300-500KB gzipped ~100KB）が `AthleteDetail.tsx`, `CompareAthletes.tsx`, `DistributionCharts.tsx` で直接インポートされている。プロジェクト全体で `next/dynamic` の使用がゼロ。

**対策**: `next/dynamic` で分析ページのチャートコンポーネントを遅延読み込み。

### 2.3 不要な再レンダリング

#### [High] RankingView の `useCallback` 依存配列問題

```typescript
// src/app/rankings/RankingView.tsx:65-81
const fetchData = useCallback(async (...) => {
  if (cache[key]) return;
  setCache((prev) => ({ ...prev, [key]: entries }));
}, [cache]);  // ← cache が変わるたびに fetchData が再生成
```

`cache` を `useRef` にするか、`setCache` 内で条件チェックして依存配列から除去すべき。

#### [High] TrackingView で毎フレーム React state 更新

```typescript
// src/app/tracking/[eventId]/TrackingView.tsx:287-315
// コメントには「15fps」とあるが、実際は requestAnimationFrame(60fps) ごとに setCurrentTime
```

コンポーネント全体が毎フレーム再レンダリングされ、サイドバーの参加者リストも毎回更新される。`useRef` + 手動 DOM 更新か、実際に15fps にスロットリングすべき。

#### [Medium] EventList のカレンダー日別フィルタが毎レンダーで O(31×N)

```typescript
// src/app/events/EventList.tsx:84-88
const getEventsForDay = (day: number) => {
  return filtered.filter((e) => e.date === dateStr);
};
// 31日分 × レンダーごとにfiltered全体をスキャン
```

`useMemo` で日付→イベントのマップを事前構築すべき。

#### [Medium] MapBrowser が baseMap 変更でインスタンス全体を再作成

`useEffect` の依存配列が `[baseMap]` のため、ベースマップ切替のたびに MapLibre インスタンスが破棄→再作成される。`setStyle()` で切り替え可能。

---

## 3. セキュリティ

### 3.1 認証・認可

#### [Critical] CRON_SECRET 未設定時に認証がバイパスされる

```typescript
// src/app/api/cron/sync-events/route.ts:14-18
if (
  process.env.CRON_SECRET &&  // ← 未設定なら条件自体がスキップ
  authHeader !== `Bearer ${process.env.CRON_SECRET}`
) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

`sync-lapcenter/route.ts:45-50` でも同じパターン。未設定時は**誰でもアクセス可能**になり、以下のリスクがある:
- Supabase Storage への不正書き込み
- Vercel 再デプロイのトリガー
- 外部サービスへの過剰スクレイピング

**修正**: 未設定時はリクエストを拒否するようロジックを反転。

#### [High] Likes API に認証もレート制限もない

```
POST /api/likes
```

- 認証不要で1リクエストあたり最大100名分のいいねが可能
- `sessionId` はクライアント生成（localStorage）で容易に偽造可能
- IP ハッシュは日次リセット
- レート制限なし
- `supabaseAdmin`（サービスロールキー）で RLS バイパス

攻撃者が自動化すればランキング操作が可能。

#### [High] 全 API 操作が `supabaseAdmin` を使用し RLS を完全バイパス

`likes/route.ts`, `likes/top/route.ts`, `events-store.ts`, `lapcenter-runners-store.ts` のすべてが `supabaseAdmin` を使用。API ルートにロジック上の脆弱性があった場合、DB 全体にアクセスされるリスク。

### 3.2 秘密情報管理

#### [Critical] Vercel プロジェクト ID と GitHub org/repo がハードコード

```typescript
// src/app/api/cron/sync-events/route.ts:109-117
project: "prj_nNZdqhA6EafJbEKmiQJsWSMp9ejl",
gitSource: { type: "github", org: "kodanatlas", repo: "trails-jp", ref: "main" }
```

環境変数に移すべき。CRON バイパス（上記）と組み合わせると、攻撃者が本番デプロイをトリガーできる。

#### [High] LIKE_SALT にハードコードされたデフォルト値

```typescript
// src/app/api/likes/route.ts:5
const SALT = process.env.LIKE_SALT ?? "trails_jp";
```

未設定時のソルトが予測可能で、IP ハッシュが再現可能。必須環境変数にすべき。

#### [Critical] CLAUDE.md に機密情報

`CLAUDE.md:68,76` に Supabase プロジェクト ref (`mlbyohpbembeoutaakkr`)、個人メール (`kodan1126@gmail.com`)、Formspree ID (`xlgwaknv`) が記載。公開リポジトリの場合は偵察に利用される。

### 3.3 ヘッダー・入力検証

#### [Medium] セキュリティヘッダーが未設定

`next.config.ts` が空。以下のヘッダーがすべて未設定:
- `Content-Security-Policy`
- `X-Frame-Options`（クリックジャッキング対策）
- `X-Content-Type-Options`
- `Strict-Transport-Security`

#### [Medium] エラー詳細が API レスポンスに漏洩

```typescript
// sync-events/route.ts:146, likes/route.ts:63
return NextResponse.json({ error: String(error) });
// → スタックトレースやファイルパスが露出する可能性
```

#### [Medium] イベント詳細ページのオープンリダイレクト（限定的）

```typescript
// src/app/events/[id]/page.tsx:29
redirect(`https://japan-o-entry.com/event/view/${id}`);
// id は parseInt で検索されるがフォールバックでは生の文字列が使われる
```

---

## 4. 保守性

### 4.1 テスト

#### [High] テストファイルがゼロ

プロジェクト全体に `.test.ts`, `.spec.ts`, `__tests__/` が一つも存在しない。`package.json` にもテストスクリプトがない。

ファジーマッチング、座標照合、データ変換パイプライン（`build-analysis-index.ts` 597行）等の複雑なロジックにテストがないのは保守上の大きなリスク。

**優先的にテストすべき箇所**:
- `src/lib/scraper/lapcenter.ts` のファジーマッチング
- `src/lib/scraper/events.ts` の日付パース
- `src/lib/map-event-matcher.ts` の座標マッチング
- `scripts/build-analysis-index.ts` のデータパイプライン

### 4.2 巨大コンポーネント

#### [High] 1000行超の "God Component"

| ファイル | 行数 | 内容 |
|---------|------|------|
| `src/app/analysis/AthleteDetail.tsx` | 1046 | 9コンポーネント + 回帰計算 + ファジーマッチング + ツールチップ |
| `src/app/analysis/CompareAthletes.tsx` | 856 | 7コンポーネント + 重複ユーティリティ |
| `scripts/build-analysis-index.ts` | 597 | データ取得 + HTML パース + 変換 + ファイル I/O + 統計計算 |

**対策**: `ScoreChart`, `LapCenterChart`, `RecentEvents` 等のサブコンポーネントに分割。

### 4.3 フォルダ構成・命名

#### [Medium] CLAUDE.md の規約と実態の乖離

CLAUDE.md では「地図関連は `lib/map/` に集約」と記載されているが、`lib/map/` ディレクトリは存在しない。実際は `lib/map-event-matcher.ts`（lib 直下）と `app/maps/[id]/` に分散。

#### [Medium] `src/data/events.json` と `public/data/events.json` の重複

同じデータが2箇所に存在。片方だけ更新されるとデータ不整合が発生するリスク。

#### [Medium] 技術アーキテクチャドキュメントが陳腐化

`docs/plans/technical_architecture.md` に存在しないコンポーネント名（`MapGrid.tsx`, `MapFilters.tsx`, `Calendar.tsx`）が記載。実際のファイル構成と不一致。

#### [Medium] 143個のハードコードされた色値が18ファイルに散在

`#f97316`, `#00e5ff`, `#1a2332` 等の hex カラーが直書き。CSS カスタムプロパティまたは定数ファイルに集約すべき。

#### [Low] スクリプトの拡張子が `.mjs` と `.ts` で混在

```
scripts/scrape-events.mjs       # 旧スクリプト
scripts/scrape-rankings.mjs     # 旧スクリプト
scripts/build-analysis-index.ts # 新スクリプト
```

#### [Low] ~~`src/lib/sample-data-joe.ts` がデッドコード~~ **（誤り・削除推奨）**

~~どのファイルからもインポートされていない。~~  
**検証**: `src/app/events/[id]/page.tsx` で `sampleJOEEvents` がインポート・使用されているため、デッドコードではない。この指摘は取り下げ推奨。

#### [Low] `UploadWizard` の submit が未実装

```typescript
// src/app/upload/UploadWizard.tsx:106-109
// コメント「In real implementation: POST to API」のまま
// ユーザーに偽の成功メッセージが表示される
```

---

## 優先対応ロードマップ

### Phase 1: 即座に対応すべき（セキュリティ・安定性）

| # | 対応内容 | 重要度 | 工数目安 |
|---|---------|--------|---------|
| 1 | CRON_SECRET 未設定時にリクエスト拒否するようロジック反転 | Critical | 30分 |
| 2 | Vercel プロジェクト ID・GitHub org/repo を環境変数化 | Critical | 30分 |
| 3 | CLAUDE.md から機密情報を削除 | Critical | 15分 |
| 4 | `src/app/error.tsx` グローバル Error Boundary 追加 | Critical | 1時間 |
| 5 | LIKE_SALT のデフォルト値を削除（必須化） | High | 15分 |
| 6 | Likes API にレート制限を追加 | High | 2時間 |

### Phase 2: 早期に対応すべき（パフォーマンス）

| # | 対応内容 | 重要度 | 工数目安 |
|---|---------|--------|---------|
| 7 | `rankings.json` の import を廃止（ビルド時に選手数を事前計算） | Critical | 2時間 |
| 8 | `athlete-index.json` を Server Component で処理 or 検索 API 化 | Critical | 4時間 |
| 9 | `lapcenter-runners.json` のフォールバック全量 fetch を廃止 | Critical | 2時間 |
| 10 | Recharts を `next/dynamic` で遅延読み込み | High | 1時間 |
| 11 | TrackingView のフレーム更新をスロットリング | High | 1時間 |

### Phase 3: 計画的に対応（コード品質・保守性）

| # | 対応内容 | 重要度 | 工数目安 |
|---|---------|--------|---------|
| 12 | 重複ユーティリティの統合（linReg, fuzzyMatch, getChartCutoff 等） | High | 3時間 |
| 13 | AthleteDetail.tsx / CompareAthletes.tsx のコンポーネント分割 | High | 4時間 |
| 14 | Supabase DB スキーマ型の生成と適用 | Medium | 2時間 |
| 15 | `next.config.ts` にセキュリティヘッダー追加 | Medium | 1時間 |
| 16 | 重複型定義の統合（LCPerformance / LapCenterPerformance） | High | 1時間 |
| 17 | サイレント `catch {}` にログ出力を追加 | High | 2時間 |

### Phase 4: 中長期（品質基盤）

| # | 対応内容 | 重要度 | 工数目安 |
|---|---------|--------|---------|
| 18 | コアロジックのユニットテスト追加 | High | 8時間 |
| 19 | ハードコード色値の CSS カスタムプロパティ化 | Medium | 3時間 |
| 20 | 技術アーキテクチャドキュメントの更新 | Medium | 2時間 |
| 21 | スクリプト拡張子の統一（.ts 化） | Low | 1時間 |
| 22 | ~~デッドコードの削除（sample-data-joe.ts 等）~~ → sample-data-joe は使用中のため対象外 | Low | — |

---

## レビュー結果の検証（2026-03-08）

上記レポートの指摘について、ソースコードを再確認した結果をまとめる。

### 指摘内容の妥当性

- **誤り・過剰指摘**
  - **sample-data-joe.ts のデッドコード指摘は誤り**  
    `src/app/events/[id]/page.tsx` で `sampleJOEEvents` をインポートし、イベント詳細の有無判定とリダイレクト先の決定に使用している。上記のとおり指摘を削除・修正推奨。
- その他の主要指摘（CRON_SECRET バイパス、Error Boundary 不在、rankings.json バンドル、Likes API の認証・レート制限、型・重複コード等）は**いずれもコードと一致しており妥当**。

### 優先順位の妥当性

- Phase 1 の CRON_SECRET・機密情報・Error Boundary・LIKE_SALT・Likes レート制限は、セキュリティと安定性の観点から**最優先で妥当**。
- Phase 2 の大容量 JSON（rankings / athlete-index / lapcenter-runners）と Recharts 遅延読み込み・TrackingView のスロットリングは、体感パフォーマンスに直結するため**早期対応として妥当**。
- Phase 3/4 のリファクタ・テスト・ドキュメントは**計画的対応として妥当**。重複型（LCPerformance / LapCenterPerformance）の統合は High のままでも問題ない。

### 見落とし・追加で検討したい点

1. **Likes API の `athleteNames` 長さ制限なし**  
   `names.slice(0, 100)` で件数のみ制限しており、1件あたりの文字数制限がない。極端に長い名前を多数送るとペイロードや DB 負荷になりうる。名前の最大長チェック（例: 100〜200 文字）の追加を推奨（Low〜Medium）。

2. **AnalysisHub の fetch エラーハンドリング**  
   `Promise.all([fetch("/data/athlete-index.json"), fetch("/data/club-stats.json")]).then(...).catch(() => setLoading(false))` で、ネットワークエラー時は loading が false になるだけで、**エラー表示やリトライ UI がない**。ユーザーには「データが空」に見える可能性。エラー状態の state と簡易メッセージ表示を推奨（Medium）。

3. **`rankings.json` の参照元**  
   レポートでは「13MB」「public/data」とあるが、実際の import は `@/data/rankings.json`（`src/data/rankings.json`）である。バンドルに含まれるという指摘は正しく、**ファイルサイズのみ**（ビルド時や別環境で変動しうる）は必要に応じて再計測推奨。

4. **アクセシビリティ**  
   フォーカス管理・ARIA・キーボード操作などの a11y 観点は今回のスコープ外だが、今後の品質目標に含める場合は、地図 UI・分析チャート・モーダルを優先して検討する価値あり（Low）。

---

*本レポートは Claude Code による自動レビュー結果です。各指摘は実際のソースコードの確認に基づいています。*
