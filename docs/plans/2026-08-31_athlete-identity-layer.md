# 選手 identity layer の導入（同姓同名の分離・C）

- 作成: 2026-08-31 JST
- ステータス: **完了（代替案 S を採用・2026-08-31 本番反映済み）**。案 I（identity layer）は §9 のレビューで却下。以降は §10 が正
- 本番反映: コード `4ca0b9f`（改名シム＋レビュー指摘対応）／移行SQL `dd51ce9` を 2026-08-31 22:2x JST に実行・再ビルド完了
- 実測結果: `lc_performances` 筑波41/金沢12/旧名0、`lc_leg_splits` 筑波45/金沢19/据え置き4。ビルドログ `Athlete aliases: 12 renamed, 0 passthrough` / `leg-fingerprint: 同姓同名除外 0 名`（従来1名）
- 残課題: §11
- **問い合わせ対応は完了（2026-08-31）**: 児玉さんが 23:03 に返信 → 本人から 23:13 に「金沢大学と筑波大学の鈴木健太がそれぞれ別の選手として正しく表示されていることを確認」と返答を受領。なお送信文面ではリレー3件の出場確認の質問が省かれたため、§11-4 の据え置き4行は未解決のまま据え置く（誤帰属の害はなく、両者のページに当該4レースが出ないだけ）
- 前段: `2026-08-31_homonym-club-key.md`（Codex レビューで致命的4件・方針を本 plan へ差し替え）
- 前提として完了済: `97c9bac` 同姓同名除外の回帰修正（A）／`3b4095e` 選手ページの混在警告（B）

## 0. なぜ作り直すのか

前 plan は「氏名が衝突したときだけ所属をキーに足す」だった。判定ロジック（行をまたぐ club 生値の相違＝誤検出ゼロ）は妥当だが、**キーの持たせ方が破綻していた**。

`AthleteSummary.name` は URL・API・表示・**JOY 生データの照合キー**を兼ねている。`name` を `鈴木健太（筑波大学）` にすると `loadAthleteDetail()`（`src/lib/analysis/utils.ts:34`）が生データ側の `鈴木健太` を引けず、ランキング履歴・H2H・チャートが空のページができる。逆に生氏名のままでは分離できない。

→ **1つの文字列に3つの役割を負わせているのが根本原因**。ここを分離する。

## 1. 中核となる3つの概念

| 概念 | 役割 | 例 | 可変性 |
|---|---|---|---|
| `athleteKey` | 永続 ID。URL・artifact のキー・DB の外部キー・React key | `鈴木健太` / `鈴木健太-2` | **不変**（一度決めたら変えない） |
| `displayName` | 画面に出す名前 | `鈴木健太（筑波大学）` | 可変（所属変更で更新してよい） |
| `sourceName` | JOY / LapCenter / エントリーの生データ照合用 | `鈴木健太` | 不変（外部データの実値） |

### 1-1. `athleteKey` の形式（要判断・§7-1）

**推奨: 氏名（空白除去）＋ 衝突時のみ安定した序数サフィックス。**

- 衝突しない選手（1,628名）: `鈴木健太` と同形式のまま＝**既存 URL・artifact キーが一切変わらない**
- 衝突する選手のみ: `鈴木健太-1`, `鈴木健太-2`

**所属をキーに埋め込まない理由**: 卒業・移籍で所属が変わる。埋め込むと (a) 再計算すれば URL が壊れ、(b) 凍結すれば永久に古い所属が URL に残る。序数なら意味を持たない代わりに**決して間違いにならない**。所属は `displayName` が担う。

序数の割り当ては初回検出時に確定し、レジストリに永続化する。以後、片方がランキングから消えても番号は再利用しない。

## 2. 分割レジストリ

`src/data/athlete-splits.json`（新規・Git 管理・**人手で確定**）

```jsonc
{
  "version": 1,
  "splits": [
    {
      "sourceName": "鈴木健太",
      "status": "confirmed",          // pending | confirmed | rejected
      "firstSeen": "2026-08-31",
      "evidence": "同一ランキング(M21E)に2行・M20とM21に分離・全日本ミドルで2クラス出走",
      "identities": [
        {
          "athleteKey": "鈴木健太-1",
          "displayName": "鈴木健太（筑波大学）",
          "matchers": [{ "source": "any", "clubs": ["筑波大学"] }]
        },
        {
          "athleteKey": "鈴木健太-2",
          "displayName": "鈴木健太（金沢大学）",
          "matchers": [{ "source": "any", "clubs": ["金沢大学"] }]
        }
      ]
    }
  ]
}
```

### 2-1. 状態遷移と運用（Codex 指摘 8 への対応）

ビルド時の warning だけでは運用されない（見逃したまま片方がランキングから消えると warning 自体が消え、汚染だけ残る）。

- 検出器が新しい候補を見つけたら `status: "pending"` として**レジストリへ自動追記**する（人手を待たない）
- `pending` が存在する状態でのビルドは **CI を失敗させる**（Vercel 本番ビルドは失敗させない＝fail-open のまま。GitHub Actions 側で落とす）
- `pending` の間は**分割しない**（統合のまま＋B で入れた警告表示）。誤分割で成績を壊すより安全側
- 人間が `confirmed` か `rejected` に変えて初めて分割が有効になる
- `rejected` は再検出しても pending に戻さない（`井戸康` のような同一クラブ同姓同名や、単なる表記ゆれを恒久的に黙らせる）

## 3. 解決（resolution）の仕組み

すべての取込経路が、生データ行から `athleteKey` を引く**単一の関数**を通る。

```ts
// src/lib/identity/resolve.ts（新規）
resolveAthleteKey(input: { sourceName: string; club: string | null; source: "joy" | "lc" | "entry" })
  => { status: "resolved"; athleteKey: string }
   | { status: "ambiguous"; candidates: string[] }   // 複数 matcher に該当
   | { status: "unsplit_pending" ; athleteKey: string } // pending のため統合キーを返す
   | { status: "missing_club" }                       // 所属欠落で判定不能
```

- 分割対象でない氏名は、そのまま `athleteKey = sourceName`（正規化済み）を返す
- **`ambiguous` と `missing_club` を握りつぶさない**（Codex 指摘 5）。`tracked` の真偽で捨てず、`resolution_status` として保存し件数を監視する

### 3-1. クラブ照合の正規化

`normalizeClubName()`（`src/lib/club-normalize.ts:23`）に統一する。現在 `leg-ingest.ts:25` と `scrape-lapcenter-runners.ts:42` に別実装のコピーが存在し、LC 突合と選手ページで基準がずれている。**identity layer 導入と同時に1本化する。**

matcher の `clubs` は正規化後の集合として比較し、**同一 sourceName 内で matcher が重複しない**ことを機械検証する。

## 4. 段階的な実装（3ステージ・各ステージで独立にレビュー可能）

分量が大きいため一括では出さない。

### C1: identity layer の土台（DB 変更なし・artifact のみ）

- `src/lib/identity/` 新規: 型・レジストリ読込・`resolveAthleteKey()`・検出器
- `AthleteSummary` に `athleteKey` / `displayName` / `sourceName` を追加（**既存の `name` は残す**＝後方互換。C2 で除去）
- `build-analysis-index.ts` のキー生成（`:485`）を `resolveAthleteKey()` 経由に
- 検出器がレジストリへ `pending` を自動追記
- **この時点では分割は起きない**（レジストリが空 or pending のみ）。挙動は現状と同一であることを検証する

### C2: 下流の全参照を `athleteKey` へ

Codex 指摘 10 の棚卸し結果。`name` を使っている箇所を機械的に洗い出して移行する。

- `src/app/rankings/RankingView.tsx:221`（生氏名から URL 生成・行の club を使っていない）
- `src/app/results/[eventId]/[classId]/LegAnalysisClient.tsx:72`（LC 生氏名と比較）
- `src/app/analysis/HeadToHead.tsx` / `head-to-head.ts`
- `src/lib/site-stats.ts:31`（生氏名 distinct → 表示選手数）
- `src/components/WeekendHighlights.tsx` / `MonthlyMovers.tsx` / `WeeklyCheerPodium.tsx`
- `src/lib/oringen/athlete-link.ts:19`（漢字氏名キーが index に無いとリンクしない → 分割後に消える）
- `src/app/a/[name]/opengraph-image.tsx` / `src/app/sitemap.ts:27`
- `src/lib/entries/build-index.ts:128`（`(氏名, className)` 重複排除 → `athleteKey` で排除へ）
- `src/lib/carpool/entry-detect.ts:142`（`carpool_members.athlete_key` との突合）

`rg` で `\.name\b` / `athlete_name` / `runner_key` を全数棚卸しし、移行漏れゼロを確認する。

**C2 完了時点で初めて `confirmed` の分割を有効化する。**

### C3: DB スキーマと一回限りのデータ移行

- `athletes`: `UNIQUE (name)` → `UNIQUE (athlete_key)`。`display_name` 列を追加
- `lc_performances`: `lc_event_id` / `lc_class_id` / `runner_index` / `athlete_key` を追加し、UNIQUE を `(athlete_key, lc_event_id, lc_class_id)` へ。**取込時点で確定させる**（後から join で振り分けない＝Codex 指摘 2）
- `lc_leg_splits`: `athlete_key` と `resolution_status` を追加
- 移行スクリプト: 事前スナップショット → dry-run 件数出力 → 決定的な UPDATE/INSERT → 整合性照合 → ロールバック手順

#### C3-1. `likes` の扱い（Codex 指摘 12）

既存 like は**どちらの人物へのものか判定不能**。片方への移送は誤帰属、両方への複製は水増し。
→ **legacy 曖昧票として別管理し、分割された選手のページでは表示しない**。勝手に片方へ帰属させない。

#### C3-2. 過去 snapshot / movers（Codex 指摘 13）

過去の ranking snapshot は生氏名キーしか持たず、どちらか復元できない。
→ **identity schema の cutover 日を設け、旧 snapshot からの delta は明示的に打ち切る**。snapshot に schema version を持たせ、新旧を比較しない。

## 5. データ欠損の現況（実測・2026-08-31）

Codex 指摘 4「`lc_performances` の UNIQUE `(athlete_name, event_date, event_name, class_name)` により、同姓同名2人が同一大会・同一クラスを走ると取込時点で片方が上書きされる」の実測結果。

`tracked = true` かつ `rank` 付きで、同一 `(runner_key, event_date, event_name, class_name)` に所属違いの複数行がある組は **3件のみ**:

| event | class | clubs | 判定 |
|---|---|---|---|
| インカレリレー2025 | MAR/ORL-a/MAS/OSL | ヤグラ会 / 横浜OLクラブ | リレー（別人が同じ枠） |
| 筑場ナイトミドル練習会 | E | 松塾 / 松塾2回目 | 同一人物の再走 |
| 機動戦リレー | MA(個人)1走 | 表記ゆれ2種 | リレー・クラブ名表記ゆれ |

**同姓同名によるものは1件もなく、鈴木健太も含まれない＝現時点でデータ欠損は発生していない。**（2人は全日本ミドルで M21A2 と M20E の別クラス）

→ C3 は緊急ではない。ただし**2人が同一クラスに出た瞬間に片方が消える潜在ハザード**として残るため、C3 までは必ず到達させる。

## 6. 受入条件（Codex 指摘 15 を受けた差し替え）

数値の増減ではなく**不変条件**で検証する。

- [ ] 固定入力に対する**生成 athleteKey 集合の完全一致**（期待値をフィクスチャで固定）
- [ ] 全入力行が**ちょうど1つ**の athleteKey へ割り当たる（0件・複数件が存在しない）
- [ ] 分割された2人の**行集合が互いに素**
- [ ] **分割後の行の和集合が分割前と一致**（成績の消失・重複がない）
- [ ] `ambiguous` / `missing_club` の件数が 0、または既知として明示的に許容した件数と一致
- [ ] 旧統合キー（`鈴木健太`）を持つ行が DB・artifact とも 0 件
- [ ] 多所属217名（`田中創` = `大阪/レオ/練馬/羅針盤` 等）が**分割されていない**
- [ ] `井戸康`（同一クラブ同姓同名）が**分割されていない**（`rejected` 扱い）
- [ ] 統合テスト: `/a/<key>`・`/api/lc/<name>`・entries・H2H・results・likes・OGP・sitemap
- [ ] `npx tsc --noEmit` / `npx vitest run` が clean

## 7. 未確定（実装前に決める）

1. **`athleteKey` の形式**: 序数サフィックス（`鈴木健太-2`・推奨）か、凍結した所属（`鈴木健太（筑波大学）`・URL は読みやすいが永久に古くなりうる）か
2. **`pending` で CI を落とす**運用を受け入れるか（落とさないと放置される／落とすと週次で作業が発生しうる）
3. **C1 → C2 → C3 を続けて実施**するか、C1 完了時点でいったん止めて挙動を確認するか
4. `likes` の legacy 曖昧票を**非表示**にしてよいか（票数が減って見える）

## 8. 分業

設計＝Claude（本 plan）。実装＝Codex CLI（WSL 側 `codex exec -s workspace-write`）へステージ単位で委譲。各ステージで二段レビュー（一次=Claude / 二次=Codex read-only）。git 操作はメインセッション。

## 9. Codex レビュー結果（2026-08-31・致命的6件・再差し戻し）

| 前 plan の致命的指摘 | 本 plan での判定 |
|---|---|
| key / display / source 分離 | 部分解消（型は分けたが**生行の選択ロジックが未設計**） |
| LC 行の一意識別 | **未解消**（提案 UNIQUE から `runner_index` が抜けている） |
| 本番移行・切替順 | **未解消**（C2 と C3 の順序が逆） |
| 取込時 UNIQUE 衝突 | **未解消**（C3 案でも再走を上書きする） |

### 9-1. 特に効いた指摘

1. **C2 → C3 の順序が成立しない（致命的）**: C2 で分割を有効化した時点で artifact は分割済み・DB/Storage は統合済みという混在になる。画面は `summary.name` で `/api/lc` を呼び（`AthleteDetail.tsx:133`）、RPC は `athlete_name = p_name` で引く（`api/lc/[name]/route.ts:28`）。`athleteKey` に変えれば 404、`sourceName` に変えれば再統合。→ expand / migrate / dual-write / backfill / dual-read / cutover / contract の順が必要。

2. **序数キーは「既存キー不変」と「永続ID不変」を両立できない（致命的）**: 1人しか観測されていない間の `鈴木健太` も `athleteKey`。2人目が現れた瞬間、最初の人を `鈴木健太-1` に変えざるを得ず不変性に反する。3人目以降は tombstone を残せば破綻しないが、**1→2の遷移が構造的に壊れる**。

3. **`loadAthleteDetail()` の `.find()` が先頭行を返す（致命的）**: 3フィールドに分離しても、同一ランキングファイルに2行ある限り**2ページが同じ履歴を表示する**。さらに取得段階で `rank:name` による重複排除（`build-analysis-index.ts:371`）があり、同順位なら片方が消える。過去スコアのマージも `name + club`（`:336`）なので移籍で引き継げない。→ 修正は consumer ではなく **producer 側**。

4. **`pending` の自動追記は構造的に永続化できない（致命的）**: 最新ランキングを取得するのは Vercel のビルドで、Git 管理ファイルへ追記しても一時 FS に残るだけで Git に戻らない。GitHub Actions は `npm test` しか実行せず検出器を走らせない。→ 「Vercel は検出するが fail-open、CI には pending が存在しない」となり、元の「警告が消えて汚染だけ残る」が再発する。

5. **`lc_performances` の新 UNIQUE も再走を上書きする（致命的）**: `(athlete_key, lc_event_id, lc_class_id)` に `runner_index` が無い。同一選手の同一クラス再走は同じ `athleteKey` なので依然衝突。なお LC パーサには未保存の `runnerId` が存在する（`lapcenter-detail.ts:17`）。

6. **`resolveAthleteKey()` の返り値が網羅的でない（致命的）**: 「club はあるがどの matcher にも該当しない（移籍・3人目・未知表記）」「registry 自体が不正」を表現できない。また `ambiguous` に `athleteKey` が無いのに §6 が「全入力行がちょうど1つの athleteKey」を要求しており**受入条件が自己矛盾**。

7. **§5 の「データ欠損なし」は証明範囲を超えている（中）**: 調査条件は `tracked=true` かつ `rank` 付きのみ。untracked・rank null・leg 未取込の大会は対象外。「鈴木健太の同姓同名による欠損を観測していない」までしか言えない。→ 本 plan §5 の表現は調査範囲に限定して読むこと。

## 10. 代替案 S: 生成元での改名シム（推奨・要判断）

上記の指摘群は「identity layer を導入する」という前提から生じている。**同姓同名2人に最初から別々の名前を与えれば、identity という概念自体が不要になる。**

### 10-1. 方針

`(氏名, 所属) → 別名` の小さな対応表を持ち、**最も上流の producer で名前そのものを書き換える**。

```
鈴木健太 + 筑波大学 → 鈴木健太（筑波大学）
鈴木健太 + 金沢大学 → 鈴木健太（金沢大学）
```

以後、パイプライン全体が「別名の2人」として扱うため、既存ロジックが**そのまま正しく動く**。

### 10-2. Codex 指摘との対応

| 指摘 | 案 S での状態 |
|---|---|
| 9-1-3 `.find()` が先頭行を返す | **解消**（生行の name 自体が別なので正しく引ける） |
| 9-1-1 C2/C3 の順序 | **ほぼ消滅**（改名シム＋既存行の一回 UPDATE を同時に入れる cutover 1回） |
| 9-1-4 pending の永続化 | **消滅**（自動追記をやめ、検出は報告のみ。表への追記は人手） |
| 9-1-6 resolver の網羅性 | **大幅縮小**（対応表の lookup。未該当は素通しで元の名前のまま） |
| 9-1-2 キーの不変性 | **トレードオフとして受容**（改名コスト＝小さな UPDATE。URL 互換は不要とユーザー判断済み） |
| 9-1-5 再走の上書き | **未解決だが本件と無関係**（`松塾`/`松塾2回目` の既存問題。実測で欠損は発生していない） |

### 10-3. 適用箇所

- ランキング取得直後（`build-analysis-index.ts` が `public/data/rankings/` を読む地点、または取得スクリプトの書き出し地点）
- `leg-ingest.ts:167` の `runner_key` 生成（LC 側 club で判定）
- `sync-lapcenter` の `lc_performances.athlete_name`
- `entries/build-index.ts` の氏名キー（affiliation で判定）
- 既存 DB 行の一回限り UPDATE（対象は当該氏名の行のみ＝小規模・可逆）

### 10-4. 案 S の残課題

- ~~**所属が欠落した行**はどちらにも割り当てられず、元の `鈴木健太` のまま残って「3人目の幽霊選手」になる~~ → **解決（下記 10-6）**
- `likes` の既存票は旧名を指したまま孤立する（実質非表示）。意図どおりか確認が要る
- 表示名が `鈴木健太（筑波大学）` になり、卒業後は古くなる（改名で対応可）

### 10-6. リレーの所属欠落は relay-result-list から解決できる（2026-08-31 実測）

所属が空の8行はほぼ全てクラブカップ7人リレー（CC7）だった。LapCenter の split-list は**リレーだと `clubName` を空で返す**が、大会トップからリンクされる別ビューに**チーム名が載っている**。

```
https://mulka2.com/lapcenter/lapcombat2/relay-result-list.jsp?event=<id>&file=1&relayClass=<n>
```

`<tr>` = 1チームで、先頭 `<td>` がチーム名＋総合タイム、以降の `<td>` が「走者名 / クラス」。実測結果:

| 大会 | クラス | チーム名 | 判定 |
|---|---|---|---|
| CC7 2025 (event=9435) | 7F | 筑波大学51期 A（7:29:56・229位） | 筑波 |
| CC7 2025 (event=9435) | 4G | 筑波大学51期 B（DISQ） | 筑波 |
| CC7 2026 (event=9983) | 3G | 金大チームベテラン（3:25:29・326位） | 金沢 |

**CC7 2025 の2件は両方とも筑波側**だった（同一人物が A の7走と B の4走を走行。11:14–12:23 と 14:15–14:55 で時間帯は重ならない。チーム B は松本修汰も2レッグ走っており、人数繰りで複数レッグを走る運用があったと見られる）。**金沢大学の鈴木健太は CC7 2025 に出場していない。**

これにより `lc_performances` 53件は **100% 振り分け可能**（筑波 41 / 金沢 12 / 不能 0）。

**副次的に重要**: 現在のスクレイパはこのビューを見ていないため、**リレー成績の所属が全選手で欠落している**（鈴木健太に限らない）。取り込めば全選手のリレー所属が埋まる。

なお `runnerId`（split-list の `runnerData['runnerId']`）は**大会ごとの連番で識別子に使えない**（同一の筑波・鈴木健太が 163 → 66 → 342 → 1812 と変動）。Codex 指摘3の「外部の安定した結果行ID」は LapCenter には存在しない。

## 11. 残課題（本番反映後・2026-08-31 時点）

分離自体は完了したが、レビューで挙がった以下は未対応。

1. **`athletes` テーブルの旧統合行**: 選手検索 `/api/athletes/search` が旧名 `鈴木健太` を返し続け、遷移すると `/a/鈴木健太` → 検索へリダイレクト（実質デッドリンク）。配車のメンバー紐付けサジェストも同じ API を使う。
   → `import-to-db.ts` を**丸ごと実行してはいけない**（`public/data/lapcenter-runners.json` が2026-03-01の古いスナップショットで、`lc_performances` に半年前の行を再投入し `race_type` の訂正を巻き戻す）。athlete のみを投入する経路を用意し、旧統合行を削除する。

2. **`likes` の旧名票**: どちらの人物への票か判定不能のため未変更。累計の応援表彰台に旧名が出てデッドリンクになりうる。新名2人の票は0から。

3. **リレーの所属欠落（恒久対策）**: LapCenter の split-list はリレーで `clubName` を空で返すため、`lcOverrides` に載せていない将来のリレーは `unresolved` になる。現状は `鈴木健太#unresolved` へ隔離して検出可能にしてあるが、恒久解決には §10-6 の `relay-result-list.jsp` からのチーム名取込が必要。**これは全選手のリレー所属欠落も同時に直す。**

4. **据え置きの `lc_leg_splits` 4件**: id 38930（名椙大会・所属空欄）、140312（CC7 2024）、143029・145414（CC7 2026 の 9:00 発走）。所属が判別できず旧名のまま。

5. **同一レースの重複登録**: 2025-10-04 と 2025-12-07 で、同じレースが JOY 正式名と LapCenter 短縮名の2レコードとして `lc_performances` に入っている。分離により大会数が減ったため選手ページで目立つようになった（金沢側は 2025/10/4 が3行に見える）。本件とは独立した既存のデータ品質問題。

### 10-5. 判断

**案 S を推奨する。** 影響を受ける選手は現在1名、増えても年に数名の規模であり、DB・Storage・artifact・約20の参照箇所を巻き込む architecture migration（案 I）は割に合わない。同姓同名が恒常的に増えて対応表が破綻したときに案 I へ移行すればよい。
