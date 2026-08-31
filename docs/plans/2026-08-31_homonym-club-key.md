# 同姓同名の所属キー化（氏名が衝突したときだけ所属を複合キーにする）

- 作成: 2026-08-31 15:12 JST
- ステータス: **要改訂（Codex レビューで致命的4件・§7 参照。この方針のままでは実装不可）**
- 発端: trails.jp お問い合わせフォーム（2026-08-31 05:38）— 金沢大学の鈴木健太さんから「筑波大学の同姓同名と成績が統合されている」との報告
- 関連: `2026-07-07_stage2c_cohort_homonym.md`（同姓同名の**除外**を実装済み・本 plan は**分離**へ進める）

## 1. 確定している事実（実データで検証済み）

### 1-1. 別人であることの確証

推測ではなく、1人では成立しない事実が複数ある。

- `public/data/rankings/elite_forest_M21E.json` 他、同一ランキングに2行（717位=金沢大学3 / 734位=筑波大学）
- 年齢クラスが **M20（筑波）と M21（金沢）** に分離。同一人物では両立しない
- 2025-10-04 全日本ミドルに `M21A2` と `M20E` の2クラスで出走（選手権で1人が2クラスは不可能）
- 本番 `/a/鈴木健太` が所属を「筑波大学 / 金沢大学」と併記し、41大会を1人分として表示

### 1-2. 判定式の実測（これが本 plan の核心）

実データ源 `public/data/rankings/`（77ファイル・1,684名）で3つの判定式を比較した。

| 判定式 | 該当者数 | 採否 |
|---|---|---|
| 行をまたいで `club` 生値が2種類以上 | **1名**（鈴木健太のみ） | ✅ 採用 |
| 同一ランキング内に2行以上（物理矛盾） | 2名（鈴木健太・井戸康） | ✅ AND 条件で補強 |
| `clubs` 配列の要素数が2以上 | **204名**（本番1,630名中） | ❌ 使ってはいけない |

**3つ目が罠。** 多所属は「行ごとに別の所属」ではなく **1つの文字列にスラッシュ区切りで入る**形で表現される（例: 田中創 = `'大阪/レオ/練馬/羅針盤'` という単一値）。この形の選手が **217名**おり、`clubs` 配列（`splitAffiliations()` 適用後）で判定すると全員を誤って引き裂く。

逆に、**行をまたいで club 生値が食い違うのは別人のほぼ確実なサイン**で、実測の誤検出はゼロだった。

### 1-3. この方式で拾えないケース

`井戸康` は同一ランキング内に2行あるが**両方とも所属が `立命OLC` で同じ**。所属をキーに足しても分離できない。既知の同姓同名例として記録済み（`docs/plans/brushup_batch1_progress_20260611.md:54`）。
→ **本 plan のスコープ外**とし、統合のまま `hasMergedNamesakes()` の警告表示で対応する。

### 1-4. URL 後方互換は不要（ユーザー判断・2026-08-31）

既存挙動で自動的に成立するため追加実装なし:
- `src/app/a/[name]/page.tsx:79` 未収録キーは404でなく `redirect('/analysis?q=<key>')`
- `src/app/analysis/AnalysisHub.tsx:164` 検索は部分一致（`a.name.includes(q)`）

→ 分割後 `/a/鈴木健太` は検索へ流れ、`鈴木健太（筑波大学）`・`鈴木健太（金沢大学）` が**両方**並ぶ。曖昧回避ページは作らない。

## 2. 前提となる別障害（先に直す必要がある）

**`leg-fingerprint` の companion 取得が本番で失敗し続けている。**

本番ビルドログ（`dpl_2wPG6jC1Y9u7fzVEwzqVJCZRr7mA` / 2026-08-26）:

```
⚠ leg-fingerprint: companion 行の取得失敗（既存ファイル保持）
✓ cross-race.json: F=1660 / S=650 選手・入力 64886 行 (183 KB)
```

因果連鎖:
1. `build-analysis-index.ts:1337-1340` が `null` を返す
2. `:1367` `homonymKeys = null`
3. `:1274` `homonymKeys ? rows.filter(...) : rows` が**無処理**になる
4. → cross-race.json から同姓同名の除外が消える

証拠（本番 artifact の生成時刻）:
- `leg-fingerprint.json` = 2026-07-08 で凍結（コミット済みファイルがそのまま配信）
- `cross-race.json` = 2026-08-26 と新しいのに鈴木健太を含む

副作用: **「ミスの傾向」機能が7週間ぶん更新停止**。

原因は未確定。DB 側は健全（tracked 75,970行・companion 68,965行・deep offset の `EXPLAIN ANALYZE` が 1.8秒）。tracked は成功して companion だけ落ちるため、tracked の約76リクエスト消費後の累積負荷（`max_connections=60`）が有力。**確定には本番 env でのビルドログ深掘りが要る。**

## 3. 実装方針

### 3-1. 検出は自動・確定は永続（推奨・要承認）

所属は卒業・移籍で変わる。毎ビルド `club` から再計算すると、`鈴木健太（金沢大学）` の卒業時にキーが変わり URL が壊れ成績が再分裂する。

→ **検出は自動、分割の確定は永続テーブルに固定**する。`MANUAL_LC_OVERRIDES`（`src/lib/scraper/lapcenter.ts:271`）と同じ運用形。

```
src/data/athlete-splits.json   （新規・Git 管理）
{
  "鈴木健太": [
    { "key": "鈴木健太（筑波大学）", "clubs": ["筑波大学"] },
    { "key": "鈴木健太（金沢大学）", "clubs": ["金沢大学"] }
  ]
}
```

ビルド時に「検出されたが表に無い名前」を warning で出し、人間が表に追記して確定させる。**未確定の間は現状どおり統合＋警告表示**（誤分割で成績を壊すより安全側）。

### 3-2. 影響範囲（キーが波及する全経路）

| 対象 | 場所 | 所属の有無 | 対応 |
|---|---|---|---|
| athlete-index.json | `build-analysis-index.ts:485` | 行ごとに有 | キー生成を分割表参照に |
| club-stats.json | `:668-712` | 有 | 分割後は各クラブに正しく1人ずつ |
| ランキング snapshot / movers | `:891-917` | 有 | 既存 dupNames ガードを分割後は解除可 |
| entry-index（Storage） | `src/lib/entries/build-index.ts:128` | `affiliation` 有 | `normalizeNameKey` + 所属で分割 |
| leg-fingerprint.json | `lc_leg_splits.club` | **有** | `runner_key` を分割キーへ |
| **cross-race.json** | `lc_performances` | **無（athlete_name のみ）** | **要 join・下記 3-3** |
| lapcenter-runners.json | `scrape-lapcenter-runners.ts:92` | 有 | 同上 |
| LC 突合 | `leg-ingest.ts:87-103` `matchTracked` | 有 | **下記 3-4** |
| DB `athletes` | `20260301_baseline_schema.sql:43` | — | `UNIQUE (name)` の変更要 |
| DB `lc_performances` | `docs/sql/002_analysis_tables.sql:50` | — | UNIQUE に所属を含めるか要検討 |
| `likes.athlete_name` | `docs/sql/001_likes.sql:7` | — | 既存いいねの移送方針を決める |

### 3-3. `lc_performances` に club 列が無い（実装の主要工数）

選手ページの巡航速度・ミス率・クロスレース分析はこのテーブル由来で `athlete_name` しか持たない。所属で振り分けられない。

→ club を持つ `lc_leg_splits` と `(runner_key, event_date, class_name)` で join して振り分ける。既存 RPC `supabase/migrations/20260708000100_lc_perf_with_rank_rpc.sql:24` が同じ join をしているので流用可能。

**未解決**: `lc_leg_splits` に対応行が無い成績（レッグ取込前の古い大会）は振り分け不能。除外するか片方に寄せるか要判断。

### 3-4. LC 突合の一対多化

`matchTracked`（`leg-ingest.ts:87-103`）は `athleteLookup: Map<string, AthleteLookupEntry>` を**氏名キーで1件**引く。現状 `鈴木健太` のエントリは `clubs=['筑波大学','金沢大学']`（統合された和集合）なので、**両者の LC 行が club 照合を通過して同じ `runner_key` に入る**。

→ `Map<string, AthleteLookupEntry[]>` に変え、club で候補を絞る。club 情報が無い LC 行（`lcClubs.length === 0` で素通りする現行分岐）は**分割対象の名前に限り tracked にしない**のが安全。

## 4. 受入条件

- [ ] `/a/鈴木健太（筑波大学）` と `/a/鈴木健太（金沢大学）` が別ページとして存在し、所属・成績・エントリーが混ざらない
- [ ] `/a/鈴木健太` が検索へリダイレクトし、両者が並ぶ
- [ ] 多所属217名（田中創・西野航平 等）が**分割されていない**ことを機械検証
- [ ] `club-stats.json` で筑波大学・金沢大学それぞれに1人ずつ計上（重複計上の解消）
- [ ] `athlete-index.json` の総数が 1,630 → 1,631（+1 のみ）
- [ ] vitest 追加: 多所属の非分割 / 分割表に従う分割 / 同一クラブ同姓同名の非分割（井戸康）
- [ ] `npx tsc --noEmit` clean
- [ ] leg-fingerprint.json が再生成される（generatedAt が当日・`homonymExcluded` が期待値）

## 5. 未確定（ユーザー確認待ち）

1. **3-1 の永続化方式**を採るか（推奨）／毎ビルド再計算にするか
2. **§2 の leg-fingerprint 回帰**を本件と切り離して先に直すか
3. **3-3 の振り分け不能な古い成績**の扱い（除外 / 片方に寄せる）
4. `likes` の既存いいねをどちらへ移すか
5. 鈴木さんへの返信の可否とトーン（送信は要承認）

## 6. 分業

model-policy.md に従い、実装は Codex CLI（WSL 側 `codex exec -s workspace-write`）へ委譲。二段レビュー（一次=Claude / 二次=Codex read-only）。git 操作はメインセッション。

## 7. Codex レビュー結果（2026-08-31・致命的4件）

`codex exec -s read-only` による plan 批評。**§3 の方針は「所属をキーに足す」パッチでは成立せず、identity layer の導入が必要**という結論。

### 7-1. 致命的（設計をやり直す必要がある）

1. **key / displayName / sourceName を分離していない**
   `AthleteSummary.name` は URL・API・表示・JOY 生データ照合を兼ねている。`name` を `鈴木健太（筑波大学）` にすると `loadAthleteDetail()`（`src/lib/analysis/utils.ts:34`）が生データの `鈴木健太` を引けず、**ランキング履歴・H2H・チャートが空になる**。逆に生氏名のままにすると分離できない。
   → 安定 ID `athleteKey` / 表示用 `displayName` / 突合用 `sourceName` を分離し、**所属名を永続 ID に埋め込まない**。

2. **`(runner_key, event_date, class_name)` は一意キーではない**
   同日別大会の同クラス・練習会の再走・重複掲載・`class_name` NULL で 0件/複数件になる。流用元の RPC（`20260708000100_lc_perf_with_rank_rpc.sql:22`）自体が無指定 `LIMIT 1` で不定な1行を選んでいるだけで、一意性を保証していない。
   → `lc_performances` に `lc_event_id` / `lc_class_id` / `runner_index` と `athlete_key` を持たせ、**取込時点で確定**する。

3. **本番データの移行手順が無い**
   `athletes` は upsert のみ（`scripts/import-to-db.ts:80`）なので複合キー行を足しても旧 `鈴木健太` 行が残り、`athlete_appearances`・`lc_performances`・`lc_leg_splits`・likes・Storage の entry-index・snapshot・生成済み artifact も同様。**「旧統合1人＋新2人」の三重状態**になる。
   → 冪等な一回限りマイグレーション（事前スナップショット / dry-run 件数 / 整合性照合 / ロールバック）と切替順を定義する。

4. **`lc_performances` の UNIQUE が取込時点で衝突する**
   制約は `(athlete_name, event_date, event_name, class_name)`。同姓同名2人が同一大会・同一クラスを走ると格納時に片方が上書きされ、**後から join しても復元できない**。

   **実測（2026-08-31）**: 衝突組は全体で 1,417 件あるが、`tracked = true` かつ `rank` 付きに絞ると **3件のみ**で、内訳は インカレリレー2025（リレー）／筑場ナイトミドル練習会の再走（`松塾` と `松塾2回目`＝同一人物）／機動戦リレー（クラブ名の表記ゆれ）。**いずれも同姓同名ではなく、鈴木健太は含まれない＝現時点でデータ欠損は発生していない。**
   → 緊急性は無いが**潜在ハザードとして設計に織り込む**（2人が同一クラスに出た瞬間に片方が消える）。

### 7-2. 重大（見落としていた影響範囲）

- **URL 生成が生氏名依存**: ランキング一覧（`RankingView.tsx:221`）は行の club を使わず生氏名から URL を作る。レッグ画面（`LegAnalysisClient.tsx:72`）は括弧付きキーと LC 生氏名を比較するため本人を見つけられない。週末ハイライト・site stats（`src/lib/site-stats.ts:31`）も生氏名 distinct。
- **entry-index と配車の突合が壊れる**: entry 取込は振り分け前に `(氏名, className)` で重複排除する（`build-index.ts:65`）ため同姓同名2人が同一クラスに出ると1人消える。キーを複合化すると `carpool_members.athlete_key`（`entry-detect.ts:142`）と突合不能になる。
- **club 欠落 LC 行を tracked にしない副作用**: そのクラス唯一の追跡候補が分割対象者だと `anyTracked=false` でクラス全体の leg 行が保存されず（`leg-ingest.ts:156`）、しかもイベント台帳には処理済みと記録される（`sync-lapcenter/route.ts:405`）ため**後日ルールを直しても自動再取込されない**。→ `tracked` の真偽で捨てず `resolution_status`（resolved / ambiguous / missing_club）を保存する。
- **warning 運用は回らない**: 候補を見逃したまま片方がランキングから消えると warning 自体が消え汚染だけ残る。`pending/confirmed/rejected` を永続管理し CI 失敗か通知に接続する。なお現行の警告表示は H2H で相手に選んだ場合だけ（`HeadToHead.tsx:308`）で**本人ページには出ない**。
- **likes の帰属**: 既存 like はどちらへのものか判定不能。片方への移送は誤帰属、複製は水増し。legacy 曖昧票として別管理か非表示にする。
- **§2 の回帰をリリース前提条件にすべき**: artifact に `identitySchemaVersion` を持たせ、不一致・生成失敗時はデプロイを失敗させる（現行の warning 継続は禁止）。

### 7-3. 受入条件（§4）の不備

- ローカル `athlete-index.json` は 1,684名・本番は 1,630名で、`1,630 → 1,631` は plan 内で数字が矛盾している。
- `+1` は無関係な増減が相殺してもグリーンになる。
- 「両クラブに1人ずつ」は統合済み1プロフィールが両 club 配列を持つ**現状でも既に成立**する（`build-analysis-index.ts:674`）＝検証になっていない。
- `tsc` は振り分け誤り・データ消失・旧DB行残存を検出しない。

→ 差し替え案: 固定入力に対する**生成キー集合の完全一致**、全入力行がちょうど1人へ割当、2人の行集合が互いに素、**分割後の和集合が分割前と一致**、未解決・複数一致0件、旧基底キー0件。加えて `/a`・`/api/lc`・entries・H2H・results・likes・OGP・sitemap の統合テスト。
