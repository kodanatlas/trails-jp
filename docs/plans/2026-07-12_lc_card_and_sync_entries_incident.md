# インシデント診断＋恒久対策プラン：LCカード朝消失 ＋ sync-entries 停止

- 日付: 2026-07-12 JST
- ステータス: **診断完了・対策未着手（承認待ち）**
- 報告トリガー:
  1. ユーザー報告「巡航速度／スピードのカードとレッグリンクが毎日 午前〜昼だけ消える／夕方〜夜は表示」
  2. 警告メール `stale_entry_index`（entry-index が78h stale）
  3. GitHub Actions `entry-index-backstop` が Attempt #4 まで全失敗

結論を先に：**別々の2つの問題**だが、根は共通で「**脆弱な小型 Supabase インスタンス（max_connections=60）＋タイトな時間予算**」。

---

## 問題① 巡航速度／スピードのカード＋レッグリンクが朝だけ消える（ユーザー報告の本体）

### 切り分け（実データで潰した仮説）
- ❌ 朝にデータがワイプ → **否**。`lc_performances` = **60,302行 / 2,475選手 / 最新 2026-07-12**、`pg_cron` 未インストール、repo 内に delete/truncate 無し。
- ❌ 朝の cron が events.json を壊す → **否**。events は保持書き込み、かつ昼の sync-lapcenter は `new_matches=0` の日は書き戻さないのに毎日復活する＝events.json は無関係。

### 真因（描画依存＋インフラ）
カードもレッグリンクも**唯一 `/api/lc/<選手名>` が2件以上返すか**だけに依存（`AthleteDetail.tsx` の `lcData && lcData.length >= 2` ゲート＋各行のレッグリンク。クライアント `fetchJson` は**12秒でタイムアウト→null**→カードもリンクも同時消滅）。

実測レイテンシ（本番 `/api/lc`、夕方時点）:
| キャッシュ状態 | レイテンシ |
|---|---|
| `x-vercel-cache: STALE`（温） | **120ms**（DBに触れず配信） |
| `x-vercel-cache: MISS`（cold） | **600〜2,000ms**（脆弱DB直撃） |

- クエリ自体は **11ms**（`athlete_name` に unique index あり＝インデックス不足ではない）。遅延の主因は **serverless cold start ＋ 小型DB(max_connections=60)への接続**。
- **朝の消失メカニズム**: 夜間の低トラフィックでエッジキャッシュ失効 → 朝は cold MISS 連発 → 各リクエストが遅い脆弱DBを直撃。そこに**朝の cron 群**（sync-events 03:xx JST／504リトライ中の sync-entries・backstop／**12:56 JST の重量 sync-lapcenter=33秒 upsert**）が重なり接続飽和 → 12秒タイムアウト → `lcData=null` → 消滅。
- **正午の回復**＝最後の重量DBジョブ(sync-lapcenter 12:56)完了＋午後アクセスでキャッシュが温まるタイミング。「昼くらいまで」と一致。
- RPC コメントが明示する **2026-07-08 の DB飽和 regression** の再来。カード問題の発生時期も 07-08 頃と整合。

### 恒久対策（安い順・要選択）
1. **クライアント耐性**（`AthleteDetail.tsx` fetchJson）: 12秒タイムアウトを延長＋失敗時1回リトライ。cold で 1〜2秒かかっても切らない。※対症療法。
2. **エッジで cold を作らない**: `/api/lc` に `stale-if-error` 追加、s-maxage 引き上げ。加えて **朝の cache 温めジョブ**（例: 早朝 or 前夜に top-N 選手の `/api/lc` を事前フェッチしエッジを温める）で朝の hard MISS を消す。
3. **朝のDB競合を下げる**: **sync-lapcenter を昼(12:56)→深夜へ移動**（最後の重量ジョブを人のアクセス帯から外す）。sync-entries 504 の解消（問題②）も競合軽減に直結。
4. **構造対策（本命）**:
   - a) **Supabase インスタンス増強** or **Supavisor(pooler) transaction mode** で接続飽和を根絶。
   - b) **カードデータの静的化**: lc_performances は1日1回(昼)しか変わらないので、rankings/*.json や entry-index と同様に **選手別 LC JSON を日次で Storage に生成 → クライアントは静的取得**。ライブDB依存を排除しカードを負荷から完全独立にする（既存アーキと同型・最も堅牢）。

**推奨**: 確定(下記)→ 1+2で即時止血 → 4bで恒久化。

### 確定方法（実装前に朝の再現で裏取り）
朝8〜11時 JST に:
- `https://trailsjp.vercel.app/api/lc/本田典幸` を開き **status と所要時間**を見る。500 / 12秒超 pending なら飽和確定。
- Vercel > Logs で `/api/lc` の timeout/500 有無。
- 参考プローブ（PowerShell、cold MISS を強制計測）はプラン末尾。

---

## 問題② sync-entries が3.5日停止（警告メール＋backstop失敗の正体・カードとは別件）

### 事実
- 最後の成功 = **2026-07-08 21:36 UTC**。Storage `entry-index.json` も同時刻で凍結。以降 cron_log に行なし。
- backstop 実ログ: **HTTP 504「An error occurred with your deployment」を3回**（各 ~60〜80秒）＝**Vercel 関数タイムアウト**。best-effort な Vercel cron も発火せず、保険の GH backstop も 504 → 一次・二次ともダウン。
- JOY 本体は生存（HTTP 200・0.8〜1.5秒）＝全断ではない。

### 真因
`sync-entries/route.ts` は `maxDuration=60`（Hobby 上限）に対し内部予算 **scrape 45s ＋ startlist 8s ＋ Storage/DB 直列化オーバーヘッド**でギリギリ。以下が 60秒を突破:
- `buildEntryIndex` の**予算超過後 in-flight の cheerio 同期パース**は中断不可（800人級エントリー表=数MB HTML の parse が末尾で伸びる）。
- **startlist ステップ**（配車割Phase4、書き込み後に per-event で追加の `scrapeDocuments(joeUrl)`＝更なる JOY フェッチ）。deadline 判定がループ先頭のみで、1件の遅延が予算を超えて伸び得る。
- 脆弱インスタンスの Storage 読(events.json/entry-index) ＋ 書(entry-index) ＋ 相乗りDBクエリのレイテンシ増。

→ どれか1つでも想定超で **合計 >60秒 → 504 → logCron 未到達 → 索引凍結**。**単純な再実行では直らない**（叩くたび 504）。

### 影響
最近の申込者がエントリー索引／選手ページの「今後のエントリー」に出ない（カード消失とは無関係）。

### 対策（要選択）
- **即時復旧（凍結解除）**: エンドポイントが 504 のため素の再トリガー不可。実行可能な最短は下記いずれか:
  - a) **予算を締めて 55秒以内に確実に返す軽微修正 → WSL ビルド → 本番デプロイ → backstop を workflow_dispatch**。
  - b) ローカル backfill（`buildEntryIndex`+`writeEntryIndex` を prod 相手に実行）だが、**`.env.local` の Supabase 書込キーは失効**（reference: trails_supabase_local_key）→ 新しい service key の発行が要る。
- **恒久修正**（route/build-index）:
  1. `overallBudgetMs` を 45s→ **38〜40s**、`STARTLIST_STEP_BUDGET_MS` を 8s→ 4s（or startlist を独立 cron へ分離）。総予算に **>5秒の安全余白**を残す。
  2. startlist の `scrapeDocuments` に**明示タイムアウト**、deadline 判定をフェッチ前後両方に。
  3. cheerio parse 前に**巨大HTMLのサイズ上限**（超過はスキップ or ストリーム打切り）。
  4. Pro 化で maxDuration 300s に上げられるなら予算問題は大幅緩和（要コスト判断）。

---

## 共通根 / 優先アクション

| 優先 | アクション | 対象 | 種別 |
|---|---|---|---|
| P0 | 朝の再現で `/api/lc` 飽和を確定（プローブ/Logs） | ① | 確認 |
| P0 | sync-entries を 55秒内に収める軽微修正＋デプロイ＋backstop再実行で**索引凍結解除** | ② | 実装+デプロイ |
| P1 | `/api/lc` クライアント耐性（timeout延長+retry）＋ stale-if-error | ① | 実装 |
| P1 | sync-lapcenter を深夜へ移動（朝のDB競合を外す） | ①② | 設定 |
| P2 | Supabase pooler / インスタンス増強、または選手別LC JSONの静的化 | ①② | 構造 |

## 付録：cold MISS 強制プローブ（朝に実行）
```powershell
$idx = Get-Content "C:\Users\user\Downloads\trails_jp\public\data\athlete-index.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$idx.athletes.PSObject.Properties.Name | Get-Random -Count 8 | ForEach-Object {
  $enc=[uri]::EscapeDataString($_); $sw=[Diagnostics.Stopwatch]::StartNew()
  try { $r=Invoke-WebRequest "https://trailsjp.vercel.app/api/lc/$enc" -TimeoutSec 30 -UseBasicParsing; $sw.Stop()
        "OK  {0}ms rows={1} cache={2}" -f $sw.ElapsedMilliseconds,($r.Content|ConvertFrom-Json).Count,$r.Headers['x-vercel-cache'] }
  catch { $sw.Stop(); $c=$null; try{$c=[int]$_.Exception.Response.StatusCode}catch{}; "ERR status=$c {0}ms" -f $sw.ElapsedMilliseconds }
}
```
朝の窓で `ERR status=500/504` や `>12000ms` が出れば問題①のインフラ飽和が確定。
