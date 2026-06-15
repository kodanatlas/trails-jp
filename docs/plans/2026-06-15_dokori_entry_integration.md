# どこオリ（dokori.net）申込状況の取り込み

作成: 2026-06-15 (JST) / 対象: trails.jp

## 目的
trails.jp は JOY（japan-o-entry.com）からエントリー状況を取得しているが、協働関係にある
どこオリ（dokori.net）からは取得していない。どこオリの大会の申込状況も JOY と同等に取り込み、
イベント一覧の申込状況表示・選手ページのエントリー状況・配車割の参加者自動検出に流す。

## 確定した方針（ユーザー判断）
1. **取得範囲**: ホワイトリスト方式。登録したどこオリ大会だけ取り込む（全自動discoveryはしない）。
   初期登録: `evt_tortoise_50th`（トータス50周年記念大会）。
2. **取得方式**: 公式フィードは待たず、公開イベントページに埋め込まれたデータを解析する。
   （将来、どこオリ運営から公式JSON/CSV/iCalフィードを得られれば堅牢化のため切替を検討。）
3. **連携範囲**: JOYと完全同等（一覧の申込状況表示＋選手ページ＋配車割の参加者検出）。

## データソースの実態
どこオリは Next.js(App Router/RSC)・Vercel ホスティング。**外部から叩けるDB/公開APIは無い**。
申込状況は公開イベントページ（`/event/{publicId}`）の RSC フライトペイロード
（`self.__next_f.push([N,"..."])` の連結）にサーバー側で埋め込まれて配信される。
よって取得は「ページを GET → 埋め込みデータを解析」で、JOY（HTMLテーブル解析）と本質的に同じ。

### evt_tortoise_50th の取得実績（2026-06-15 時点）
- 3日間: 10/10 ミドル予選(富士天神山/鳴沢村) ・ 10/11 ミドル決勝 ・ 10/12 ロング決勝(本栖湖/富士河口湖町)
- 申込締切: 2026-09-05 03:00 JST / 受付: open
- 申込 82名（確定 71 / 振込待ち 11）、14クラス、46クラブ
- 会場座標: lat 35.4193 / lng 138.7414（日本範囲チェック通過）

## trails.jp 側アーキテクチャ（調査結果の要点）
- イベント・エントリー索引は Supabase **Storage の JSONブロブ**（`app-data/events.json`,
  `app-data/entry-index.json`）。リレーショナルな events 表は無い。
- 連結キーは整数 `joe_event_id` 一本（events / AthleteEntryRef / carpool_events.joe_event_id）。
  **source 判別フィールドが存在しない**のが唯一の障壁。
- 下流（/api/events/[id]/entries・build-index・配車割 detect-entries）は `EntryListResult` 型しか
  見ないので、**同じ型を返すどこオリ・パーサを用意すれば無改修で動く**。

## 実装（合成ID + ソース振り分け方式）
JOYの整数IDと衝突しない**合成ID予約レンジ** `DOKORI_ID_BASE = 90_000_000` を導入し、
どこオリ大会に `90_000_000+n` を割当て。`source` 判別子で URL/パーサを切替える。
これにより carpool_events.joe_event_id（FK）も既存スキーマのまま流用でき、DBマイグレーション不要。

### 新規ファイル
- `src/lib/scraper/dokori.ts` — RSCフライト復元・エントリー解析・イベント解析・スクレイパ・
  ホワイトリスト `DOKORI_EVENTS` / `isDokoriEventId` / `getDokoriPublicId`。
- `src/lib/scraper/entry-source.ts` — `scrapeEntryListByEventId(id)`：IDレンジで JOY/どこオリ振り分け。
- `src/lib/scraper/__tests__/fixtures/dokori_tortoise_50th.html` — 実ページ固定具（解析テスト用）。
- `src/lib/scraper/__tests__/dokori.test.ts` — 82件・クラス内訳・イベントメタの回帰テスト。

### 変更ファイル
- `src/lib/scraper/events.ts` — `JOEEvent` に `source?: "joy"|"dokori"`・`dokori_public_id?` を追加。
- `src/lib/entries/build-index.ts` — `scrapeEntryList` → `scrapeEntryListByEventId` に差替（索引化は共通）。
- `src/app/api/events/[id]/entries/route.ts` — 同上（オンデマンド取得をソース振り分けに）。
- `src/app/api/carpool/.../detect-entries/route.ts` — ライブ取得フォールバックの注入関数を振り分けに。
- `src/app/api/cron/sync-events/route.ts` — `scrapeDokoriEvents()` を完全隔離で取得し eventMap へマージ。
  どこオリは座標を自前で持つため store 由来座標で上書きしない（会場変更に追従）。
- `EventList.tsx` は無改修（`tags` チップ・`entry_status` バッジ・`/api/events/[id]/entries`・`joe_url`
  をそのまま使うため、`tags:["どこオリ"]` で自動的に表示・フィルタ対応）。

## 堅牢性・規約
- politeness: UA `trails.jp/1.0 (dokori ...)`、上流1時間キャッシュ、非2xxは throwOnError で空上書き回避。
- 全失敗時に良い索引を空で潰さない既存ガード（sync-entries の scrapedEventCount===0）に乗る。
- RSC埋め込み解析は どこオリ再デプロイ・構造変更に弱い → 固定具テストで回帰検知。将来は公式フィード化で堅牢化。

## デプロイ前ゲート（必須）
1. `npm test`（vitest）全green。
2. `npm run build` 通過。
3. `npx tsx scripts/geocode-smoke.ts`（どこオリ会場座標が実GSIと整合するか・配車割座標ゲート）。
4. 導線ウォークスルー（ユーザー実機確認の前にペルソナ別レビュー）。
5. デプロイは Vercel CLI（Git Bash・Windows node・ユーザーPATの `VERCEL_TOKEN`）。
6. デプロイ後 sync-events / sync-entries を手動実行 → events.json / entry-index.json に反映確認。

## 将来
- どこオリ大会の追加は `DOKORI_EVENTS` に1行追加するだけ。
- 公式フィード（JSON/CSV/iCal）が得られたら `scrapeDokori*` の取得部だけ差し替え、解析の脆弱性を解消。
