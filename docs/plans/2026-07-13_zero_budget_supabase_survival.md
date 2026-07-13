# $0 で Supabase Free枠のDB飽和を凌ぐ 恒久プラン（Claude設計＋Codex壁打ち反映）

- 日付: 2026-07-13 JST
- ステータス: **設計確定・実装未着手**
- 前提インシデント: `docs/plans/2026-07-12_lc_card_and_sync_entries_incident.md`（毎朝〜昼 DBデータ面が8h+不達→カード消失/sync-entries凍結/ビルド失敗。再起動＋コード耐性化＋pg_cron監視まで実施済）

## 正直な見通し（Codex査定・忖度なし）
- 公開読み取りUX（LCカード/レッグリンク）は積極的 staticize で **$0 で 60〜70% 維持可能**。
- アーキ全体（cron 書き込み含む）は、DBが毎日8h暗いままなら **$0 は 30〜40%**。
- **監視が「飽和時に接続数が低い」を示す＝共有コンピュート飢餓＝コードでは直らない → いずれ課金不可避**。逆に「接続が60に張り付く＝枯渇」なら $0 で対処可能。**まず監視の証拠で分岐する。**

## 即効の安価策（$0・すぐやれる）
1. **`/api/lc` の CDN TTL 延長**（現 `s-maxage=600` → 大幅増＋`stale-if-error` 延長）。日次データなのに10分は短すぎ。※単体では不十分（cold athlete はDB直撃・キャッシュ失効あり）。
2. **cron を minute 0 から分散＋暗い窓(03-12 JST)を避ける**（`vercel.json` は全部 minute 0＝herd）。LC取込は「正午固定」でなく**回復後**に寄せる。
3. **複合インデックス確認/追加**: RPC(`get_lc_perf_with_rank`)は `lc_leg_splits(runner_key,event_date,class_name)` で lateral join。複合indexが無ければ追加（1クエリのDB負荷減）。`lc_performances(athlete_name,event_date)` も確認。
4. **ビルド中のDB書き込みを止める**: `scripts/build-analysis-index.ts` が build-time に Supabase REST を **PATCH**（race_type backfill 等）。ビルド時に prod DB を変更しない＋失敗時は既存 artifact 保持に。

## 本命の $0 構造対策: LCカード読み取り経路の静的化（Codex反映版）
**A. 静的成果物は `public/data`（Vercel CDN／リポ同梱）に置く。Supabase Storage は不可。**
- 理由: Storage も同じ Supabase＝障害時に同時に落ちる。**"DB-decoupled ≠ Supabase-decoupled"**（`events-store.ts` が既に Storage を可謬扱いしているのが証拠）。

**B. hash shard 64〜128個 ＋ tiny manifest。**
- 頭文字shardは日本語名で偏る／1本JSONは重い(モバイル)／per-athlete 2475ファイルは cron アップロード地獄。→ 名前hashで均等分割。

**C. 各LC行に link 情報を持たせ、直リンクを生成。**
- 行に `d,e,c,s,m,t,r, lc_event_id, lc_class_id`。**`/results/{eventId}/{classId}` の直リンクを生成**し、`/results/go?e=..&d=..&c=..`（click時にDBで eventId/classId 解決）を廃止→legacy fallback へ。
- 現状 `AthleteDetail.tsx`→`/results/go`→`results/go/page.tsx` が runtime 解決＝静的化しても click 時にDB依存が残るため。

**D. atomic publish＋versioned shards。**
- 全shard書き＋検証まで **manifest を差し替えない**（失敗生成でカード全消しを防ぐ＝freshnessの真のリスクは"生成失敗"）。manifestに `generatedAt`・件数・athlete数・ledger watermark。

**E. 生成は独立ジョブで。**
- 60s の `sync-lapcenter`（scrape＋upsert lc_performances/lc_leg_splits＋ledger）に相乗りさせない。**post-sync の export 専用ジョブ**を分ける。

**F. 2次依存も潰す。**
- `LegAnalysisClient.tsx`（レッグ分析ページ）も `/api/lc/{athlete}` を再取得→DB障害で劣化。ここも静的化 or 明示的に許容。

## 監視ドリブンの真因判定（既設 `db_health_samples`）
- **接続枯渇（$0で対処可）**: total≈60張り付き / `idle`・`idle in transaction` 多 / 同一 app_name・role・client_addr 偏り / "too many clients"。
- **共有コンピュート/IO飢餓（$0で不可＝課金へ）**: total 低いまま / active クエリ齢が分単位 / IO・WAL・LWLock 待ち / active なのに wait_event=null で無進捗 / **pg_cron サンプルの欠測・遅延**。
- **ロック（対処可）**: `Lock` 待ち集中・古いブロッカPID・`sync-lapcenter` upsert表に集中。
- 注意: `pg_stat_activity` は noisy-neighbor CPU steal を**証明できない**（枯渇の除外と症状提示まで）。

## Supavisor pooler について（ドラフトC の訂正）
- **/api/lc の解ではない**。主経路は supabase-js＝PostgREST/REST 経由で直接pg接続ではないため、pooler は効かない。直接pg を使う箇所があればそこだけ（要監査だが該当は限定的）。

## 実行順
即効1〜4（今日でも可） → **監視で次回飽和の真因確認** → 本命(静的化 A〜F) → それでも cron 書き込み経路が毎日死ぬなら課金判断（監視が"飢餓"を示したら前倒しで課金検討）。

---
（Codex gpt-5.5 read-only 壁打ち 2026-07-13 反映。ドラフトからの主変更: 静的先=Storage→public/data、リンク=go解決→直リンク、shard=頭文字→hash、build-time DB write 停止、cron再配置、複合index、pooler は無効と判明。）
