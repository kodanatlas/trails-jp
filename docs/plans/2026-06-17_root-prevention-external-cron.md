# 根本予防: entry-index 鮮度の実行保証（外部 cron 案）— 2026-06-17

## 解決したい問題
`sync-entries`(Vercel Hobby cron, 19:00 UTC) が **無音でスキップ**されると `entry-index.json` が古いまま固定され、スキップ後に申込した選手が選手ページに出ない（児玉健の件＝6/16 のスキップで再現）。`vercel.json` 設定は不変。Hobby cron は**ベストエフォート**で遅延/スキップしうる。
②で入れたウォッチドッグ（sync-lapcenter が 26h 超で警告）と鮮度表示は「**気づける**」だけで「**防げない**」。本書は実行を保証する根本予防の方針。

## 方針（候補A: GitHub Actions 外部 cron・冗長化バックストップ）
`kodanatlas/trails-jp`（既存リポ）に schedule ワークフローを追加し、本番 cron エンドポイントを `CRON_SECRET` で叩く。Vercel cron は**残したまま**、独立した2系統のスケジューラで相互バックアップする。

- `.github/workflows/cron-backstop.yml`
- schedule（UTC, Vercel の試行後にバックストップ）:
  - `10 19 * * *` … Vercel sync-entries(19:00) の10分後に sync-entries を叩く（スキップ時の保険）
  - 任意で `10 18 * * *` … sync-events も同様にバックストップ
  - 任意で `0 7 * * *`（=16:00 JST）に2回目の sync-entries（昼の新規申込も拾う・二重化）
- 手順: `curl -fsS --retry 3 --retry-delay 20 -H "authorization: Bearer ${{ secrets.CRON_SECRET }}" https://trailsjp.vercel.app/api/cron/sync-entries`
  - 順序が要るなら sync-events → 60s sleep → sync-entries。
  - `-f` で非2xxは step 失敗 → GitHub が失敗通知（=第2のアラート経路）。
- 冪等性: sync-entries / sync-events は毎回作り直すので**多重起動は安全**（追加はJOY/どこオリの軽い再スクレイプのみ、1日1〜2回）。
- シークレット: リポジトリ Secret `CRON_SECRET`（**ユーザー手動登録** or `gh secret set`）。値は Vercel 本番の `CRON_SECRET` と一致させる。

## 既知のリスク / 反論ポイント（レビュー対象）
1. **GitHub Actions schedule もベストエフォート**（最大15〜30分遅延・高負荷時スキップあり）。Hobby よりマシだが“保証”ではない。→ だから**冗長化**（Vercel と GH の2系統）で「両方同時にスキップ」する確率を下げる設計。
2. **GH schedule の60日自動無効化**: 公開リポで60日 push が無いと schedule が自動停止。trails-jp は活動的だが、停止リスクの監視が要る。
3. **二重実行のコスト/礼儀**: JOY/どこオリへのスクレイプ回数が増える。1日1〜2回なら許容範囲か（要判断）。
4. **シークレット露出面**: エンドポイントは元から公開＋`CRON_SECRET`保護。外部から叩くのは Vercel と同じ。リポ Secret は安全に保持される。リポ可視性（public/private）の確認は要る。
5. **ウォッチドッグとの整合**: GH バックストップが毎日成功すれば索引は常に新鮮 → sync-lapcenter のウォッチドッグはほぼ鳴らない（=多重防御として機能）。

## 代替案（比較）
- **B 自己修復（Vercel 内）**: 信頼できる cron（sync-events）が索引の古さを検知したらインラインで再生成。外部依存ゼロだが、既に重い cron に index build を足す→ **60s タイムアウト risk**＋ロジック二重化。
- **C Vercel Pro 化**: cron 信頼性↑・頻度↑・timeout 300s。確実だが**有料**。
- **D 外部 cron SaaS**（cron-job.org / Upstash QStash 等）: GH Actions より時刻が正確な場合あり。アカウント増・管理点増。

## 推奨
**A（GH Actions 冗長バックストップ）を主軸**に、②のウォッチドッグ（無音検知）と鮮度表示を多層防御として併用。B/C は将来オプション。
最小実装は「`10 19 * * *` に sync-entries を1回叩く workflow ＋ repo secret」。

## 受入条件 / 検証
- 手動 `workflow_dispatch` でも実行可能にし、merge 後にまず手動実行 → `/api/athletes/児玉健/entries` が3日分を返すことを確認。
- Secret 未登録時に分かりやすく失敗（401）すること。
- Vercel cron は無効化しない（冗長性維持）。

## ユーザー手動アクション（台帳行き）
- GitHub `kodanatlas/trails-jp` の Secrets に `CRON_SECRET`（Vercel 本番と同値）を登録。

---

## Codex レビュー反映（2026-06-17, gpt-5.5・辛口）— 判定: 条件付きGO

**核心の指摘（コードで検証済み・妥当）**:
1. **案A単体は「根本予防」ではなく暫定策**。GH Actions schedule もベストエフォート＋公開リポ60日無活動で自動無効化。「実行保証」と呼ぶのは過大。
2. **last-writer-wins の上書き事故リスク（P1）**: 現 `sync-entries` は全滅時のみ既存 index を保持し、**部分成功は成功扱いで上書き**。Vercel と外部 cron が競合すると、後から終わった低品質 index が良い index を潰す。→ **品質ガード必須**（新 index の `athletes`/`scraped` が既存より大幅減なら上書き拒否）。
3. **events.json 側の fail-open footgun（P2・検証済み）**: `readEvents()` は Supabase Storage 読込失敗時に**静的バンドル `src/data/events.json`（古い・どこオリ無し）へフォールバック**。cron がこの古いイベント集合で新 index を生成・上書きしうる。→ cron 経路は **fail-closed**（フォールバック検知時は index 再生成をスキップ）。
4. **`curl -f` では品質劣化を拾えない**: HTTP 200 でも `scraped<targets`・`athletes` 急減・特定ソース全滅はあり得る。→ レスポンス JSON を検査して失敗判定。
5. **時刻ずれ**: Vercel Hobby cron は「分」ではなく「時」内のどこか（`0 19` が 19:59 もあり）。**外部バックストップは 19:10 では早すぎ → 20:30 UTC 以降**に。
6. 専用 `BACKSTOP_SECRET`（endpoint 別 secret）、`cron_log` に `trigger_source` ＋品質指標、carpool 自動検出も古い index の影響を受ける点に留意。

**Codex 推奨の改良設計**: 直接 `sync-entries` を叩かず、**stale-gated な `/api/cron/ensure-entry-index`** を外部から叩く。①ロック取得 ②今日の成功 index が新鮮＆品質OKなら no-op ③古い時だけ再生成 ④新 index が既存より明確に劣るなら上書き禁止。スケジューラは GH Actions か QStash（QStash は schedule/retry が公式機能で cron 特化）。

**こちらの統合判断（実装スコープ別）**:
- **最小**: GH Actions を 20:30 UTC に `sync-entries` 1回（+`workflow_dispatch`・retry）。手早いが last-writer-wins リスクは残る。
- **推奨（中庸）**: ②の watchdog/鮮度表示 ＋ **(a) sync-entries に品質ガード**（athletes 大幅減なら上書き拒否）＋ **(b) events.json フォールバック時は再生成スキップ（fail-closed）**＋ **(c) GH Actions バックストップ(20:30 UTC, retry)**。ロックは品質ガードがあれば必須でない（低品質上書きを別経路で防げる）。新エンドポイント不要で Codex 指摘の8割を回収。
- **堅牢（フル）**: 上記＋専用 `ensure-entry-index` エンドポイント（ロック＋no-op ゲート）＋ QStash。運用点は増えるが最も正しい。
