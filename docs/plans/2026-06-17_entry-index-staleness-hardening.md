# 選手エントリー索引の鮮度ハードニング（2026-06-17 JST）

## 背景 / 根本原因（実データで確定）

- 児玉健の唯一の出場予定「トータス50周年」は **どこオリ(dokori.net)** イベント（JOY id 2306 にエントリーリスト無し、合成ID 90000001/2/3）。
- どこオリ連携(6/15)・スクレイパ・索引化ロジックは**正常**（他のトータス参加者は選手ページに表示される。`build-index` を現データに当てると `児玉健` も3日分キーされる＝確認済み）。
- 児玉が出ない直接原因＝**選手別エントリー索引 `entry-index.json` が古い**。最終生成は `2026-06-15T19:45Z`（cron id 190 = 6/16 04:46 JST）。以降 `sync-entries` が走っておらず（6/17 朝の定期実行が cron_log に**記録なし**＝スキップ or ログ前タイムアウト）、児玉は**最近の申込者(94人中88番目)**のため古い索引に含まれない。
- `vercel.json` の cron 設定は 6/8 から不変＝設定変更が原因ではない。Vercel Hobby cron のスキップ/遅延、または `maxDuration=60`(Hobby上限)＋どこオリ重パースの一時タイムアウトが疑わしいが、**“無音で止まった”ことが最大の問題**（誰も気づけない）。

## 即時復旧（①・運用）

`sync-entries` を手動実行 → 索引再生成 → 児玉即表示。Vercel ダッシュボードの Cron「Run」or `curl -H "authorization: Bearer $CRON_SECRET" .../api/cron/sync-entries`。

## 恒久対策（②・本書のスコープ）

### Fix 1: 索引鮮度ウォッチドッグ（無音停止の検知）
- 場所: `src/app/api/cron/sync-lapcenter/route.ts`（03:00 UTC＝ sync-entries の8h後に走る。最速で前夜の停止を検知できる別ジョブ）。
- 内容: 本処理の後に隔離 try/catch で `readEntryIndex()` を読み、`generatedAt` の経過時間を計算。`null` もしくは `> STALE_INDEX_WARN_HOURS`(=26h) なら `notifyCronWarning("sync-entries","stale_entry_index",{generatedAt, ageHours, hint},0)` を呼ぶ。
- 効果: 既存通知（notifyCronError / high_scrape_shortfall）は「実行された上での異常」しか拾わない。**実行自体のスキップ**はこのウォッチドッグで初めて可視化される。24h デダブ済みなのでスパムしない。
- 制約: lapcenter 本処理を絶対に失敗させない（例外は握りつぶしログのみ）。`readEntryIndex` は `@/lib/entry-index-store` から import。

### Fix 2: 選手カードに索引鮮度を表示
- 場所: `src/app/analysis/UpcomingEntries.tsx`（既に props で `data.generatedAt` を受領済・現在未使用）。
- 内容: `data !== null && generatedAt` のとき、カード下部に極小ミュート文言「エントリー情報: M/D HH:mm 時点」を表示。経過 > STALE_HINT_HOURS(=36h) なら淡色で「(更新が遅れています)」を付す。`generatedAt` を JST 表記に。空配列時(現在エントリー予定なし)も鮮度は出してよい。
- 制約: 既存のスタイル系統（text-[10px]/text-muted 等）に合わせる。`generatedAt=null`(APIエラー)時は鮮度行を出さない。レイアウト崩れ・はみ出し無し。

## 非スコープ（別途・提案）
- **外部の信頼できる cron**（GitHub Actions などから `sync-entries` を叩く）または **自己修復**（信頼できる cron から索引が古ければ再生成）。Hobby cron のベストエフォート性を根本回避する策。リポジトリ/シークレット設定（ユーザー手動）を伴うため、本書では実装せず提案に留める。
- どこオリ同一ページの3日分パース集約: 効果軽微（id 190 は12秒で完走＝タイムアウトは今回の主因ではない）＆メモ化のリスクに見合わないため**見送り**。
- 別件: 上尾OLC50周年が JOY で3日大会(2587/1839/2588)に再構成され `events.json` に 2587/2588 欠落（児玉とは無関係の取りこぼし）。

## 受入条件
- `npx vitest run` 全 green、`tsc`/`next build` clean。
- Fix1: lapcenter 本処理は鮮度チェックの失敗に影響されない。閾値・シグネチャが仕様どおり。
- Fix2: 児玉のような空状態でも「◯◯時点」が出る。36h 超で遅延ヒント。レイアウト健全。
