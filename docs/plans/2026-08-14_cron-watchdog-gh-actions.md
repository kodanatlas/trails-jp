# cron 死活監視を GitHub Actions へ移設する

- 日付: 2026-08-14 JST
- ステータス: **完了**（2026-08-14）
  - Phase 1 = GH Actions watchdog（`fd0af0f`）: GH 上で success・失敗通知メール到達を実証
  - Phase 2 = 相互監視（`8336f13`）: heartbeat 記録・`watchdog_silent` の Resend 配送を実証
  - 残り: 翌日 12:41 UTC の定時 `sync-lapcenter` が静かなことの確認のみ
- 発端: 2026-08-14 13:07 JST に「[trails.jp監視] cron異常検知 / 異常区分 D」メールが届いた

## 1. 何が起きていたか（調査結果・実値）

### cron 本体は正常
Supabase Management API で `cron_log` を直接確認。3ジョブとも直近4日すべて `status=success`。

| job | 最終実行（JST） | duration |
|---|---|---|
| sync-events | 8/13 19:48 | 9.1s |
| sync-entries | 8/13 20:39 / 23:35 | 12.6s / 12.8s |
| sync-lapcenter | 8/13 21:58 | 35.7s |

`db_health_samples` も 8/14 13:50 JST まで記録あり。**cron 側に対処すべき障害はない。**

### 壊れていたのは監視の方（61日間の盲目）
クラウドルーティン `trails.jp cron 稼働確認 (3ジョブ)`（`trig_017n7Jko3feKQLNMrFwQsTWp` / 毎日 04:00 UTC）は、
2026-06-15 以降**毎日**同じ失敗をしていた。

- サンドボックスの egress proxy が `mlbyohpbembeoutaakkr.supabase.co:443` への CONNECT を 403 で拒否
  （curl exit 56 / HTTP 000、WebFetch も 403）。ドメイン単位のポリシー拒否。
- にもかかわらず 8/13 までは Gmail の**送信ツールを発見できず「下書き」を作って終了**していた。
  6/15〜8/13 の約60通が下書きに滞留。8/14 の実行だけ `select:` 指定でツール探索に成功し、初めて実送信された。

**故障モードが fail-silent だったのが最大の欠陥**。監視の通報経路が、監視自身と同じ壊れやすい基盤
（サンドボックスのツール発見＋外部到達性）に相乗りしていた。

### 盲目期間に実際に見逃していたもの
直近60日の `cron_log` 実行日を集計:

| job | 実行日数 | 欠測日 |
|---|---|---|
| sync-entries | 57/60 | 7/10, 7/11, 7/12 |
| sync-events | 54/60 | 6/30, 7/10, 7/11, 7/12, 7/15, 7/16 |
| sync-lapcenter | 54/60 | 6/15, 6/17, 6/22, 6/23, 7/7, 8/3 |

**7/10〜7/12 は3ジョブ同時に丸3日停止**（既知の DB 飽和インシデントの窓）。本来なら初日に通報されるはずだった。

## 2. 方針

GitHub Actions へ移設し、クラウドルーティンは停止する。

| 案 | egress 制限 | cron 全停止(沈黙)を検知 | 通報経路の独立性 | 判定 |
|---|---|---|---|---|
| **A. GH Actions watchdog** | なし | ○ | GitHub のジョブ失敗通知（実績あり） | **採用** |
| B. Vercel に watchdog cron | なし | ×（Vercel が死ぬと watchdog も死ぬ） | Resend | 単独では不採用（Phase 2 で相互監視の片側として使う） |
| C. サンドボックスにドメイン許可を追加 | 可否不明 | ○ | 今回と同じ経路＝再発時また沈黙 | 不採用 |

### 実測で確認済みの前提（推測ではない）
- `cron_log` / `lc_performances` とも RLS 有効・public read ポリシーあり・anon に SELECT 付与
- 制限のないネットワークから anon REST で `cron_log` を **HTTP 200 で取得できることを実測**
- 返る時刻形式は `2026-08-13T10:48:09.807947+00:00`（**小数秒＋オフセット付き**）
- Vercel cron の実ジッタ: sync-events は 8/13 が +41分、8/12 が +57分（スケジュール 10:07 UTC に対して）

## 3. 仕様（v2）

### 3-0. 実装言語 — bash/jq ではなく TypeScript
判定ロジックは `scripts/cron-watchdog.ts` に置き、workflow からは `npx --yes tsx` で叩く
（`sync-oringen.yml` と同じ流儀。`npm ci` は使わない）。

理由: bash + jq だと ①`code=$(curl ...)` の直後の `$?` が GitHub 既定シェル `bash -e -o pipefail` で
到達しない ②jq の `fromdateiso8601` が上記の小数秒＋オフセット付き時刻を受理しない ③`set -e` と
`jq -e` の false が衝突する、という罠を全部踏む。TS なら native fetch と `Date.parse` で済み、
**純関数として vitest で検証できる**（既存 `test.yml` が PR/push で自動実行する）。

### 3-1. ファイルと配線
- 新規 `scripts/cron-watchdog.ts` — 純関数 `judge(input, nowMs)` ＋ `main()`
  - `judge` は **I/O を一切しない**（引数で受け取った取得済みデータと現在時刻だけで判定）
  - リポジトリ内の他モジュールを import しない（アプリ依存を持ち込まない）
- 新規 `scripts/cron-watchdog.test.ts` — vitest。既定 include に載るので `npm test` で走る
- 新規 `.github/workflows/cron-watchdog.yml`
- 新規 Secret `SUPABASE_ANON_KEY`（公開 anon キー。既存は `CRON_SECRET` / `ORINGEN_INGEST_SECRET` のみ）
- Supabase URL は公開値なので workflow に直書き
- 既存 workflow の流儀に合わせる: 日本語コメントヘッダで「なぜ」／secret 未設定ガード（`::error::`＋exit 1）／
  `concurrency` グループ／`workflow_dispatch` を残す／`timeout-minutes` を付ける

### 3-2. スケジュールと判定しきい値
- schedule: **`17 16 * * *`**（16:17 UTC = 01:17 JST）
  - 3ジョブ（10:07 / 11:23 / 12:41 UTC）と `entry-index-backstop`（13:30 UTC）がすべて終わった後
  - **正時を避ける**: GitHub は毎時0分に負荷が集中し遅延・drop しやすいと公式に明記している
- **`MAX_AGE_H = 26`**: 各 job の最新実行が 26 時間より古ければ異常
  - 健全時の age は最大でも 24h + ジッタ（実測最大 57分）＝ 約25h なので、**任意の時刻に手動実行しても誤発報しない**
  - 1日欠測すると定時実行時点で約30h となり確実に捕まる
- **`MAX_GAP_H = 26`**: 直近7日の連続する実行間隔が 26 時間を超えていたら異常
  - 「watchdog 自身が drop され、翌日の正常実行で最新 age が若返って欠測が隠れる」穴を塞ぐ
  - 最新 age だけを見る設計では、GH Actions が1回落ちると欠測を素通りする（v1 の誤り）
- **期待時刻はハードコードしない**（v1 のルーティンが実際の cron 時刻とズレて腐った再発防止）

### 3-3. 取得
job ごとに個別リクエスト（3本）＋ lc_performances 1本。

```
GET {BASE}/rest/v1/cron_log?job_name=eq.{job}&select=job_name,created_at,status,result&order=created_at.desc&limit=20
GET {BASE}/rest/v1/lc_performances?select=event_date&order=event_date.desc&limit=1
ヘッダ: apikey / Authorization: Bearer（ともに anon キー）
```

- **共通クエリ＋`limit=60` にしない**: 1ジョブが再試行等で行を占有すると他ジョブの行が消え、
  正常なのに A 誤発報 or B 判定不能になる（件数の保証がない）
- `sync-oringen` は監視対象外（大会終了で停止済み）
- URL は必ずクォートする（`&` のバックグラウンド化・`in.()` の shell 衝突を避ける）
- 1試行あたり 30 秒でタイムアウト。**最大3試行**（初回＋再試行2回。試行間 20 秒）
- 2xx 以外・ネットワーク失敗・JSON パース不能・配列でない → 区分 D

### 3-4. 異常判定（1つでも該当したら exit 1）
| 区分 | 条件 |
|---|---|
| A | いずれかの job の最新 `created_at` が `MAX_AGE_H` より古い／**行が0件** |
| A2 | いずれかの job の直近7日で、連続する実行間隔が `MAX_GAP_H` を超える箇所がある |
| B | いずれかの job の**直近2件が連続で失敗**（行が1件しかない場合は B 判定不能として扱い、A/A2 に委ねる） |
| B2 | いずれかの job の**直近7日で失敗が3件以上**（連続でなくても多発なら異常。回復済みの連続失敗も捕まる） |
| D | 取得が 2xx でない／JSON でない／配列でない |

「失敗」の定義（**status だけを見ないこと**）:
- 共通: `status !== 'success'`、または `result` が null / オブジェクトでない
- `sync-lapcenter` は追加で: `result.runners` が無い、`result.runners.error` あり、`result.matching.error` あり
  （このジョブはハードニング済で、取得失敗時も `status=success` を返し失敗が result にネストされる）

**区分 C（lc_performances の鮮度）は v2 で廃止**。`max(event_date)` は「最近大会があったか」であって
「最近正常に取り込めたか」ではない。閑散期に誤発報し、部分取得が `status=success` なら発火もしない。
→ **失敗条件から外し、ログに情報行として出すだけにする**。

### 3-5. 出力と通知
- **正常時**: job ごとに1行サマリ（最新実行 JST / status / 直近7日の実行数 / 最大間隔）と
  `lc_performances` 最新日を出して exit 0。メールは飛ばない。
- **異常時**: 区分・job 名・根拠の実値を `::error::` で出力し **exit 1**
  → GitHub の workflow 失敗通知メールが届く（新しい通知基盤を足さない）

### 3-6. 撤収作業（メインセッションの Claude が実施。Codex にはやらせない）
- ✅ クラウドルーティン `trig_017n7Jko3feKQLNMrFwQsTWp` を `enabled: false` にした（2026-08-14）
- ✅ `SUPABASE_ANON_KEY` を repo secret に登録（BOM 混入で1度やり直し。下記「投入時に起きた実障害」）
- ✅ 滞留していた Gmail 下書き 60 通（6/15〜8/13）を削除（2026-08-14・ユーザー承認）。
  実際に届いた 8/14 のアラートメールは保持

## 4. 受入条件
1. `npx --yes actionlint`（version 固定）で `.github/workflows/cron-watchdog.yml` が通ること
   （PyYAML の `safe_load` は YAML 文法しか見ず、`on:`・式・secret 参照・jobs 構造の誤りを検出しないため使わない）
2. `npm test`（vitest）が緑。`scripts/cron-watchdog.test.ts` に最低限これらのケースを含む:
   - 正常（3ジョブとも新しく success）→ ok
   - A: 1ジョブだけ 30時間前 → 区分 A・job 名がメッセージに出る
   - A 境界: age が 25:59:59 → ok / 26:00:01 → 異常
   - A: 行が0件 → 異常
   - A2: 最新は新しいが、履歴の途中に 30 時間の間隔がある → 異常（**v1 が見逃していた形**）
   - B: sync-lapcenter の直近2件が `status=success` かつ `result.runners.error` あり → 異常
   - B: 単発失敗（直近2件のうち1件だけ失敗）→ ok
   - B2: 直近7日に失敗3件（非連続・最新は成功）→ 異常
   - 失敗定義: `result` が null / 文字列 / `runners` 欠落 → それぞれ失敗として扱う
   - D: HTTP 401 / 500 / 非 JSON / オブジェクト（配列でない）→ 異常
   - 時刻: `2026-08-13T10:48:09.807947+00:00` 形式を正しくパースできる
   - `nowMs` は引数注入。実時刻に依存させない（フィクスチャが時間経過で腐らないこと）
3. `workflow_dispatch` で実行して**本番データに対し exit 0**（8/14 時点で3ジョブは正常なので緑になるはず）
4. secret 未設定時に `::error::` を出して exit 1
5. **通知経路の実証**: 一度だけ意図的に失敗させ（`workflow_dispatch` の入力 `force_fail=true`）、
   実際に kodan1126@gmail.com へ GitHub の失敗通知メールが届くことを確認する。
   ※ 61日間の沈黙は「検知」ではなく「通報」で失敗した。通報経路を実証しない受入は同じ穴を残す

## 5. Codex 壁打ちの取捨（2026-08-14・No-go 判定を受けての判断）

| 指摘 | 採否 | 理由 |
|---|---|---|
| watchdog 自身が fail-silent（Critical） | **採用・Phase 2 へ明記** | 本質的に正しい。ただし解決には app 側変更が要る（下記） |
| 「GH 遅延でも 20h 判定は崩れない」は誤り | **採用** | drop 時に翌日の実行で欠測が隠れる。A2（履歴の間隔検査）を追加 |
| 正時 `0 16` は遅延しやすい | **採用** | `17 16` へ |
| `workflow_dispatch` の任意時刻実行で誤発報 | **採用** | しきい値を 26h にして「実行時刻に依存しない」性質へ変更 |
| sync-entries の片系停止を見逃す | **部分採用** | 事実。ただし watchdog の SLO は「索引が日次更新されたか」であり、片系生存は劣化であって停止ではない。**source 記録は Phase 2**、残存リスクとして明記 |
| 部分成功・result スキーマ変更を fail-open | **部分採用** | `result` が null / 非オブジェクト / `runners` 欠落を失敗扱いにするところまで採用。`schema_version` 契約の新設は過剰（部分成功の検知は既に app 側 `notifyCronWarning` の責務で、Resend で通報済み） |
| 区分 C は指標がずれている | **採用（削除）** | 失敗条件から外し情報表示のみに |
| `limit=60` は各 job 2件を保証しない | **採用** | job ごとに個別クエリ＋`limit=20` |
| `code=$(curl)` → `$?` が `bash -e` で到達しない | **採用** | TS 実装に変更したので構造的に回避 |
| URL/timestamp/jq の実装契約が未定義 | **採用** | 同上。時刻は `Date.parse`、URL はクォート |
| 受入条件が主要故障モードを検証していない | **採用** | `nowMs` 注入・境界値・HTTP 層・通知配送の実証を追加 |
| YAML `safe_load` では不十分 | **採用** | `actionlint` へ |

## 6. 残るリスク・Phase 2

- **watchdog 自身の沈黙**（最大の残存リスク）。GitHub の schedule は遅延・drop し、リポジトリが60日無活動だと
  自動停止する。run が作られなければ失敗メールも存在しない。
  **kodanatlas/trails-jp は public・最終 push 2026-08-02（実測）** なので、この自動無効化は理論上の話ではない。
  同じリスクは既存の `entry-index-backstop.yml` にも今この瞬間かかっている。
  → **Phase 2（相互監視）で対応する**（下記 8 章。2026-08-14 にユーザー承認・着手）。
- **sync-entries の片系停止**: Vercel cron と backstop が同じ `job_name` を書くため区別できない。
  Phase 2 で `source` を記録するまでは「索引が日次更新されている」ことのみを保証する。
- **既存 `entry-index-backstop.yml` の潜在バグ**（本件スコープ外・未修正）: `code=$(curl ...)` の直後の
  `rc=$?` は GitHub 既定シェル `bash -e` 下では到達せず、ネットワーク障害時にリトライが働かないまま
  ステップが即死する。修正は別途ユーザー判断。

## 7. 二段レビューの記録（2026-08-14）

### 一次レビュー（Claude・メインセッション）
- **A2 の窓境界の穴**を検出: `recentRows`（7日以内）だけで gap を計算するため、7日を超える欠測が
  今日復旧すると窓内が1行になり gap が計算されず、age も小さいので **A も A2 も発火しない**。
  → 修正1として反映。

### 二次レビュー（Codex read-only）
| 指摘 | 採否 | 対応 |
|---|---|---|
| 通知経路が未実証（Critical） | 採用 | 受入条件5のとおり `force_fail=true` を1回実行して実証する（投入後） |
| A2 窓境界の穴は正しい（Major） | 採用 | `gapRows` を別配列にする（`recentRows` に混ぜると `runs_7d` と B2 件数を汚染する）。gap は「新しい側が7日以内」のときだけ評価＝復旧7日後に自然に鳴り止む |
| public repo の60日自動無効化（Major・条件付き） | 採用（事実確認済み） | repo は public・最終 push 2026-08-02。Phase 2 の相互監視が対策 |
| 「3回まで再試行」と実装（計3試行）の不一致（Minor） | **文言側を訂正** | 3試行で十分。コードは変えず 3-3 を「最大3試行」に修正 |
| `process.exit()` で出力が flush されない（Minor） | 採用 | `process.exitCode` にして自然終了へ（`::error::` の根拠行が消えるのを防ぐ） |
| actionlint 未実証（Minor） | 解消済み | actionlint 1.7.7 で**指摘ゼロ**（リポジトリ全 workflow でもゼロ） |
| MAX_GAP_H=26 の余裕 | 問題なしと判定 | 実測 24.001h に対し約2h、公称ジッタ最大59分から導く健全時最大 24h59m に対しても約61分の余裕。1日欠測時の gap は最短でも約47h で識別余裕も十分 |
| workflow の終了コード制御 | 問題なし | `set +e` は `npx` 直前のみ・`$?` 保存・`set -e` 復帰・`force_fail` も確実に1 |

### 検証実績（すべて実行して出力を確認した）
| 検証 | 結果 |
|---|---|
| `actionlint 1.7.7`（cron-watchdog.yml / 全 workflow） | 指摘ゼロ |
| `npx vitest run scripts/cron-watchdog.test.ts` | 17 tests passed（修正後に再実行して件数増を確認する） |
| `npx vitest run`（全体） | 64 files / 789 tests passed |
| 本番データに対する実行 | **exit 0**。sync-events 8/13 19:48 JST・sync-entries 8/13 23:35 JST・sync-lapcenter 8/13 21:58 JST、`max_gap_h` は 24.001 / 22.050 / 24.004、lc_performances 最新 2026-08-09 |
| `npx tsc --noEmit` | exit 0（`tsconfig` の include は `**/*.ts` なので新規ファイルも本番ビルドの型検査対象） |
| 新テストが**修正前コードで落ちる**ことの確認 | 旧ロジックへ一時的に戻して実行 → 該当テストが fail（`result.ok` が true になる＝8日欠測の復旧を正常と誤報）。復元後は 19 tests passed |
| secret 未設定ガード | `::error::` を出力して exit 1（`process.exitCode` 化後も出力が欠落しないことを確認） |
| GH Actions 上での実行 | run 31774938067 **success**。出力はローカル実行と一致 |
| 通知メール到達 | **実証済み**。下記 BOM 障害の run 31774829700 が失敗し、06:01:46Z に GitHub から「Run failed: cron-watchdog - main (fd0af0f)」が kodan1126@gmail.com へ着信 |

### 投入時に起きた実障害（記録）
初回の GH 実行が全ジョブ区分 D で失敗した。原因は**コードではなく secret の値**で、
`SUPABASE_ANON_KEY` の先頭に **BOM (U+FEFF)** が混入していた
（Windows 側でキーをファイル経由で扱った際、`Get-Content -Raw` が BOM を読み、
.NET の `Trim()` は U+FEFF を空白とみなさないため除去されない）。
Node の `fetch` はヘッダ値に変換できず
`Cannot convert argument to a ByteString because the character at index 0 has a value of 65279` を投げていた。

- 教訓1: **PowerShell からシークレットを設定するときは `.TrimStart([char]0xFEFF)` を必ず入れる**
  （`gh secret set` はパイプでなく `--body` で渡す。パイプは末尾に改行が付く）
- 教訓2: watchdog 自体は設計どおり **fail-closed** で落ち、原因を1発で特定できるエラーを出した。
  「静かに OK を返さない」という設計目標が実地で機能した

## 8. Phase 2 — 相互監視（GH ⇄ Vercel）

Phase 1 は「GitHub が Vercel を見る」だけなので、**GitHub 側が沈黙すると誰も気づかない**。
Vercel 側からも GitHub を見る経路を足し、片方が沈黙してももう片方が鳴るようにする。

### 仕組み
1. `cron-watchdog` は判定成功時のみ `/api/cron/watchdog-ping`（`CRON_SECRET` 認証）を叩く。
   判定が異常なら GitHub Actions の既定 `if: success()` により ping は走らない
   （**不健全なのに heartbeat を更新しない**ため。意図的挙動）
2. エンドポイントは `logCron("gh-watchdog", "success", …)` で `cron_log` に記録する
3. Vercel の `sync-lapcenter`（12:41 UTC）が、`gh-watchdog` の最新記録が
   **36時間**より古ければ `notifyCronWarning("gh-watchdog", "watchdog_silent", …)` で Resend 通報する

### なぜ 36 時間か
watchdog は 16:17 UTC、`sync-lapcenter` は 12:41 UTC。正常なら ping は約 **20.4時間前**。
watchdog が1日飛ぶと約 **44.4時間前**になり 36h を超える。つまり watchdog 停止を約1.5日以内に検知できる。

### 既存の前例に揃える
「entry-index が古ければ `notifyCronWarning`」（`STALE_INDEX_WARN_HOURS = 24`／`src/lib/entries/freshness.ts`）が
ほぼ同型の前例。判定は**純粋・依存なし・`now` 注入**のモジュールに切り出し、
鮮度不明（ping 行なし・パース不能）は **fail-closed で「沈黙」扱い**にする（freshness.ts と同じ思想）。

### 投入順序（重要）
鮮度不明を fail-closed にしているため、**ping 行が1件も無い状態で検査が動くと `watchdog_silent` が飛ぶ**。
これを事故ではなく**通報経路の実地試験として使う**（`cron-notifier` は Resend 失敗を握りつぶすため、
Vercel→Resend の配送が生きていることは実際に送ってみないと確認できない）。

1. コードをデプロイ（ping エンドポイント＋検査＋workflow のステップ）
2. デプロイ完了を確認
3. **まだ ping 行が無い状態で `sync-lapcenter` を手動実行する**
   → `watchdog_silent` の警告メールが届くことを確認（＝**Vercel→Resend 経路の実証**）
4. `cron-watchdog` を手動実行して ping を1件作る
5. `cron_log` に `gh-watchdog` 行ができたことを確認
6. 翌日 12:41 UTC の `sync-lapcenter` が静かなら完了

※ `cron-notifier` の24hデダブにより、3 の後に同じ `watchdog_silent` は24時間送られない。
デプロイは 12:41 UTC より十分前に行い、3〜5 を連続して実施すること（間に定時実行を挟まない）。

### 投入結果（2026-08-14・実施済み）
| 手順 | 結果 |
|---|---|
| 1〜2. デプロイ | `8336f13` を push、Vercel ビルド success（約9分） |
| 事前確認 | `cron_log` の `gh-watchdog` 行が **0件**であることを確認（fail-closed 経路に入る前提） |
| 3. ping 無しで `sync-lapcenter` 手動実行 | HTTP 200・本体は正常完走。**`[trails.jp] Cron warning: gh-watchdog` が 07:13:19Z に着信**（`detail` に `"watchdog_silent"`, `"latestPingAt": null`）。`cron_notification_log` にも記録 ＝ **Vercel→Resend 配送経路を実証** |
| 4. `cron-watchdog` 手動実行 | run 31779162851 **success**。3ジョブとも OK 判定のうえ heartbeat ステップまで到達 |
| 5. heartbeat 行の確認 | `gh-watchdog` / status=success / 08-14 16:14:32 JST / `result={"repo":"kodanatlas/trails-jp","run_id":"31779162851","source":"github-actions"}` |
| 6. 翌日 12:41 UTC の定時 `sync-lapcenter` が静かなこと | **未確認**（翌日確認） |

3 は「ping 行が無い」という一過性の状態を利用した実地試験である。`cron-notifier` は Resend の
配送失敗を握りつぶすため、**実際に送ってみる以外に経路の生存を確認する方法がない**。
今後この経路を再検証したい場合は、同じ手（heartbeat を意図的に古くする）が使える。

### Phase 2 の二段レビュー（2026-08-14）

一次（Claude）が「`logCron` が失敗を握りつぶすので ping が嘘の成功を返す」を検出し、
二次（Codex）がそれを**より広い欠陥として確定**させた。

| 指摘 | 採否 | 対応 |
|---|---|---|
| `logCron` は `try/catch` だけで、**supabase の insert が例外でなく `{ error }` を返すケースを一切見ていない**（Major） | 採用 | `logCron` を `Promise<boolean>` にし、`{ error }`・throw の両方で false。ping route は false のとき 500。既存呼び出し元は戻り値を無視＝挙動不変 |
| heartbeat 取得の `{ error }` 未確認で、DB 一時障害が `watchdog_silent` に化ける（Minor） | 採用 | `watchdog_check_failed` の別シグネチャで通知し、原因を取り違えないようにする |
| heartbeat 検査が重いスクレイプの**後**にあり 60 秒予算を使い切ると走らない（Minor） | 採用 | 認証直後（重い処理の前）へ移動 |
| 投入順序だけでは競合を防げない（Minor） | 部分採用 | 二段階デプロイはせず、デプロイ〜seed を連続実施。**代わりに「ping 行が無い状態」を通報経路の実地試験に転用**（上記 投入順序 3） |
| `cron-notifier` が Resend 失敗を握りつぶす（Minor） | **今回は不採用** | 全ジョブ共通経路のため変更しない。代わりに投入時に実配送を試験する（同上） |
| 36h ちょうどの境界テストが無い（Minor） | 採用 | `isWatchdogSilent(hAgo(36), …) === false` を追加 |
| workflow ヘッダの「必要な Secret」に `CRON_SECRET` が無い（Minor） | 採用 | コメント追記 |
| 36h の運用計算・通常時の DB 負荷・workflow の制御フローと安全性・規約追従 | 問題なしと判定 | `(job_name, created_at DESC)` の既存インデックスあり・1日1回 `limit(1)`。`github.run_id` は数値、`github.repository` は GitHub 管理値で注入リスクなし |

### 残る穴（Phase 2 でも消えないもの）
GitHub と Vercel が**同時に**沈黙した場合は誰も鳴らない。相関障害の確率は低く、
その状況ではサイト自体が落ちて利用者が気づくため、ここは許容する。
また `cron-notifier` の配送失敗は握りつぶされたままなので、Resend 側の障害は検知できない
（投入時に実配送を確認するのはこのため）。
