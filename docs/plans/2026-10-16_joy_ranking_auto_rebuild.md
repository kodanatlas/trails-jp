# JOY ランキング更新の自動検知→再ビルド

ステータス: 実装済（Codex 設計・コード両レビュー反映）・本番反映待ち

> 実装時の変更: manifest は `public/data/rankings/` ではなく **`public/data/ranking-headers.json`**（rankings/ 配下は build 後段で全 .json がランキングとして読まれるため）。比較先は `SITE_URL`（本番ドメイン）。

## 背景
ランキングはビルド時に JOY から取得し、毎週水曜の Deploy Hook でしか自動更新されない。
2026-10-15 12:19 のビルド後に JOY がトータス50周年(10/10-12)を反映し、手動 redeploy まで本番が古いままだった。

## 決定事項（ユーザー合意 2026-10-16・不変）
- 日次 `sync-events` cron（19:07 JST）に相乗り。反映遅れは最大1日で可
- 検知は「大会列の追加」のみ（点数訂正は見ない）
- 通知は cron_log の記録のみ（メールなし）
- 水曜の定期再ビルドは保険として維持

## 実データ確認（2026-10-16 JOY 実測）
- ランキングページの `<table>` は1つ。1ページ目と4ページ目のヘッダは全カテゴリで完全一致 → 1ページ目だけ見ればよい
- 同一種別内（M21E/W21E、無差別/女子無差別/M40）はヘッダ共通。**種別間では異なる**（年齢別にのみ「野呂山大会」、同一大会の表記揺れ「上尾50周年Day2」⇔「第130回上尾Day2」）→ 種別ごとに代表1クラスを監視
- 年齢別には大会でない列「補完1」がある → 日付（YYYY-MM-DD）で始まる列だけを大会列とする

## 仕様（改訂版）
1. **ビルド側 manifest**: `build-analysis-index.ts` が各カテゴリの1ページ目で観測した大会列を `public/data/rankings/_headers.json` に書く（`{ generatedAt, categories: { "<file>": { status: "fetched"|"kept", headers: string[] } } }`）。抽出・正規化は共通関数 `src/lib/rankings/event-headers.ts`（cheerio・空白圧縮・日付始まりのみ・重複排除・ソート）を build と cron で共用
2. **監視対象**: 種別ごとの代表 4 クラス = elite_forest_M21E(5/39)・elite_sprint_S_Open(17/85)・age_forest_無差別(1/1)・age_sprint_S_無差別(15/47)
3. **判定**: JOY 1ページ目の大会列のうち manifest に無いものがあれば stale。取得失敗・大会列0件・manifest 欠落は「不明」＝ stale にせず `check.errors` に記録
4. **発火上限（ループ防止）**: `joy_updated` 発火は「直近 20 時間に無し」かつ「直近 7 日で 2 回未満」のときのみ。履歴は cron_log の sync-events の `result.deploy` から読む。**履歴が読めなければ発火しない**（DB 障害でビルドを増やさない）
5. **水曜**: 検知結果によらず `weekly` を1回だけ送る（発火箇所は1か所）
6. **Hook 結果**: `res.ok` を確認し `accepted / failed` を区別。送信は 10 秒タイムアウト、失敗しても当日は再送しない
7. **cron 本体の保護**: 追加検査は try/catch で隔離し、全 fetch に AbortSignal.timeout（JOY/manifest 8 秒・並列）。関数の実 maxDuration を確認し、不足なら明示指定
8. cron_log の `result.deploy`（実装の確定形）:
   - `reason`: `"weekly"` | `"joy_updated"` | `null`
   - `hook`: `{ status: "accepted", job }` | `{ status: "failed", error }`（送信した日のみ）
   - `checks[]`: `{ file, status: "ok" }` | `{ file, status: "stale", missing[] }` | `{ file, status: "unknown", error }`（水曜以外）
   - `skipped`: `history_unavailable` | `min_interval` | `window_cap` | `time_budget` | `hook_not_configured`
   - 監視クエリ例: `select created_at, result->'deploy' from cron_log where job_name='sync-events' order by created_at desc limit 14`
9. `maxDuration = 60`（実測: 同期本体 8〜16秒 + 判定 最大約23秒）。本体が 30 秒を超えた日は判定を `time_budget` でスキップ
10. manifest は SKIP_FETCH・取得全体失敗でも全件 `kept` で書き直す（古いヘッダを持ち越さない）。大会列0件のカテゴリは `kept`。書き込みは tmp→rename

## 採否（Codex 指摘）
- #1 抑止定義の穴 → 採用（回数上限方式に変更。欠落集合の一致判定は廃止）
- #2 部分集合・取得失敗のすり抜け → 採用（失敗は不明扱い＋集合に依存しない回数上限）
- #3 ヘッダと得点集合の意味の違い → 採用（manifest のヘッダ同士比較）
- #4 部分取得と「最新」判定の混同 → 一部採用。manifest に status を持たせ観測可能にする。得点の取得完全性は本機能の対象外（列追加検知のみの合意）で、既存の中間ページスキップ挙動は変えない
- #5 DB ログを安全装置として信用 → 一部採用。履歴読取失敗時は発火しない。**事前予約レコードは不採用**: 日1回の cron でビルドは最大1回/日、DB が落ちていれば読取も失敗して止まるため、残る穴（Hook 受理後のログ書込のみ失敗）は最悪でも翌日1回の余分なビルドに留まる
- #6 タイムアウト → 採用
- #7 監視カテゴリ不足 → 採用（4種別×代表1クラス。種別内共通は実測済）
- #8 ヘッダ完全性 → 実測で確認済。0件・不正 HTML はエラー扱いを採用
- #9 水曜優先・res.ok → 採用

## Codex コードレビュー（2026-10-16）採否
- must-fix 1 manifest 側0件で誤 stale → 採用（build 側 kept 化＋比較側 unknown＋回帰テスト）
- must-fix 2 実行時間上限 → 採用（maxDuration=60 明示＋30秒予算）
- should 3 SKIP_FETCH/全体失敗で古い manifest → 採用（全件 kept で書き直し・atomic）
- should 4 接続状態のテスト → 採用（deploy-trigger.test.ts 11件: JST 曜日境界・履歴 DB 失敗・failed も計数・旧形式ログ除外・全取得失敗）。build スクリプトの終了経路はテスト基盤が無く未テスト（コード読みで確認）
- nit 5 ログ契約 → 採用（上記 8 を実装に合わせ確定）

## 実装
- `src/lib/rankings/event-headers.ts`（純関数）＋ `__tests__/event-headers.test.ts`
- `src/lib/rankings/staleness.ts`（判定・上限の純関数＋取得）＋ `__tests__/staleness.test.ts`
- `src/lib/rankings/deploy-trigger.ts`（履歴読取・水曜判定・送信）＋ `__tests__/deploy-trigger.test.ts`
- `scripts/build-analysis-index.ts`: manifest 書き出し
- `src/app/api/cron/sync-events/route.ts`: 水曜ブロックを置換

## 検証
- vitest・tsc
- 実データ: ローカルで build の manifest 生成部分と判定を JOY 実物に当て、現本番相当で欠落0件
- デプロイ後: 初回ビルドで `_headers.json` が配信されること、翌日 19:07 の cron_log の deploy フィールド
- 注意: manifest が本番に載るまでの初回 cron は「manifest 欠落＝不明」で発火しない（意図どおり）
