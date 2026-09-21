# cron-watchdog のアラート設計を直す（1回の欠測が13日ノイズになる問題）

- 日付: 2026-09-21 JST
- ステータス: **完了**（2026-09-21）
- 関連: `docs/plans/2026-08-14_cron-watchdog-gh-actions.md`（本監視の初期設計・Phase 2 = 相互監視）

## 1. 何が起きていたか

2026-09-08 以降、毎日2通ずつアラートが届いていた。

- GitHub「Run failed: cron-watchdog」× 13日連続（09-08〜09-20、全て schedule 実行）
- Resend「Cron warning: gh-watchdog / `watchdog_silent`」× ほぼ毎日

### 監視対象は健全だった

Supabase `cron_log` を anon REST で直接確認（2026-09-21）。3ジョブとも 09-06〜09-20 の全実行が `status=success`。欠測は次の2回だけ。

| job | 欠測日 | gap |
|---|---|---|
| sync-lapcenter | 2026-09-08 | 09-07 13:15 → 09-09 13:16（48.023h） |
| sync-events | 2026-09-14 | 09-13 10:19 → 09-15 10:19（48.000h） |

いずれも Vercel cron の1日 drop で、翌日には自力で復旧している。

失敗した13回の workflow ログの `::error::` を全て回収した結果も同じ内容の繰り返しだった:

- 09-08: 区分 A（sync-lapcenter age_h=30.185）
- 09-09〜09-14: 区分 A2（sync-lapcenter gap_h=48.023、**同一の gap を6日連続**）
- 09-14: 区分 A（sync-events age_h=33.991）が追加
- 09-15〜09-20: 区分 A2（sync-events gap_h=48.000、**同一の gap を6日連続**）

### なぜ 1回の欠測が1週間続くのか（原因①）

`scripts/cron-watchdog.ts` の区分 A2 は、7日窓（`HISTORY_DAYS = 7`）の中にある gap を**毎日再報告する**設計だった。欠測1回につき 検知日（区分 A）＋7日（区分 A2）が赤。今回は2件の欠測が時間差で重なり13日連続になった。

放置しても sync-events の gap（newer = 09-15T10:19）は 09-22 の実行で窓から外れ、自然に緑へ戻る。つまり**データ側に直すものは無く、直すべきはアラート設計だった**。

### なぜ Resend の警告まで出るのか（原因②・こちらが本質的に危険）

`.github/workflows/cron-watchdog.yml` の `Record watchdog heartbeat` は既定の `if: success()` で動くため、判定が赤の間 heartbeat ping が飛ばない。Vercel 側 `src/app/api/cron/sync-lapcenter/route.ts` は heartbeat が36hより古いと `watchdog_silent` を鳴らす。

つまり heartbeat の鮮度が「**watchdog が生きているか**」と「**監視対象が健全か**」の2つを兼ねていた。結果:

1. 同じ事象について GitHub と Resend から二重に通知される。しかも Resend 側の hint（「GH Actions が未実行・自動無効化・workflow 失敗」）は原因の説明として誤り
2. その間、**watchdog 自身の死を検知できない**。これは 2026-08-14 plan の Phase 2 が塞いだはずの最大の残存リスクであり、09-08〜09-20 の13日間、相互監視は実質無効だった

## 2. 修正

### 修正1: heartbeat を「watchdog が動いた記録」に戻す

- `.github/workflows/cron-watchdog.yml`
  - `Check cron health` に `id: check` を付け、`$GITHUB_OUTPUT` に `healthy=true|false` を書く。書き込みは `force_fail` の判定より**前**（force_fail は通知経路の検証用であり健全性の判定ではない）
  - `Record watchdog heartbeat` を `if: ${{ !cancelled() }}` にする（`always()` ではない。手動キャンセル時に「動いた」と記録しないため）
  - ping URL に `&healthy=${HEALTHY:-unknown}` を追加。secret 未設定などで判定に着手する前に落ちた場合は `unknown`
- `src/app/api/cron/watchdog-ping/route.ts` — 既存の `truncateQueryParam` で `healthy` も result に記録。`logCron` の `status` は従来どおり `success`（= ping 自体の成否であり判定結果ではない）
- `src/app/api/cron/sync-lapcenter/route.ts` — `watchdog_silent` の hint を実態に合わせて差し替え。判定ロジック（`isWatchdogSilent` / `SILENT_WATCHDOG_WARN_HOURS = 36`）は不変

**トレードオフ（意図的）**: 「監視対象が不健全」の第二通知チャネル（Resend）を失う。GitHub の失敗通知は 2026-08-14 に `force_fail` で実証済みであり、二重化こそが今回のノイズ源かつ相互監視の無効化要因だった。判定結果は `cron_log.result.healthy` に残るので `/admin/cron-status` から追える。

### 修正2: 区分 A2 の再報告を48時間で打ち切る

- `scripts/cron-watchdog.ts` に `MAX_GAP_REPORT_AGE_H = 48` を追加し、gap の**新しい側**が48時間以内のときだけ A2 を出す
- 7日窓の直前を1行参照する `rowBeforeHistory` の扱いは維持（長期欠測からの復旧を1回は必ず拾う）
- `summaries` の `max_gap_h` は情報表示なので従来どおり7日窓で集計

**なぜ48時間か**: 欠測日 D は区分 A（age>26h）が拾う。復旧後の D+1 / D+2 に A2 が出て収束するので赤は計3日。watchdog 自身が1日 drop しても D+2 で拾える。3日以上 watchdog が落ちた場合は、修正1で正しく機能するようになった `watchdog_silent`（36h）が拾う。

**`MAX_GAP_H = 26` は変更しない**。Vercel cron の1日欠測は知りたい情報であり、閾値を緩めると欠測そのものが見えなくなる。直したのは「何回言うか」だけ。

## 3. 検証（実行済み）

| 検証 | 結果 |
|---|---|
| `npm test`（vitest 全件） | 73 files / **924 tests 全緑** |
| `actionlint .github/workflows/cron-watchdog.yml` | exit 0 |
| `tsc --noEmit` | exit 0 |

追加したテスト:

- `scripts/cron-watchdog.test.ts` — gap の新しい側が48hより古ければ7日窓内でも報告しない／境界は48時間ちょうど（47.9h は検知・48.1h は非検知）
- `src/app/api/cron/watchdog-ping/route.test.ts` — 判定が異常でも heartbeat を記録し `healthy=false` を残す／`healthy` 無しの ping も記録する

既存の A2 テスト3件は newer 側が 1h / 25h なのでいずれも48h以内。変更なしで通ることを実行して確認した。

## 4. マージ後の確認（残タスク）

1. `gh workflow run cron-watchdog -R kodanatlas/trails-jp` で手動実行
   - 09-22 以降なら exit 0（sync-events の gap が窓から外れる）
2. Supabase `cron_log` に `job_name=gh-watchdog` の新しい行が入り、`result.healthy` が記録されていることを anon REST で**実データ確認**
3. 翌朝の sync-lapcenter（12:41 UTC）以降、`watchdog_silent` メールが止まっていること

## 5. やらなかったこと

- **Vercel cron の欠測そのものへの対策**: Hobby プランの実勢（2026-08-14 plan の実測でも60日で各ジョブ3〜6回欠測）。検知できていれば運用可能と判断
- **LapCenter 突合の追加 override**: 09-12・09-13 に警告が出た岡山県民パークO大会（joe_event_id=2605）は 09-14 以降 `match_gaps` から消えており解消済み。2026-09-20 時点の残りは tier=`possible`・affinity=0 の明らかな非マッチ1件（CC7振り返り練習会 vs 第48回北大大会エクストラレース）のみで、`likely` ではないため警告も出ていない
