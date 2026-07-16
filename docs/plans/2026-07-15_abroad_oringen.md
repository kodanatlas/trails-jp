# 海外遠征セクション — O-Ringen Göteborg 2026

作成: 2026-07-15 JST / ステータス: **完了・本番稼働中**（https://trailsjp.vercel.app/abroad/oringen-2026）

> **実施結果（2026-07-15）**: PR #60/#62/#63/#64/#65/#66/#67/#68 をマージし本番稼働。
> GitHub Actions が1日2回（13:00 / 23:00 JST）自動更新。**残リスクだった2点は両方解消**:
> ①GH runner から `resultat.oringen.se` へ到達できた（地理ブロックは杞憂）②Storage 書き込みも本番で成功。
>
> 計画から増えたもの: 大会別の階層化（`/abroad` 一覧 → `/abroad/oringen-2026`）/ プログラム（会場・
> スタート窓・開会式・難易度の色）/ 次回更新の予定表示 / 選手ページへのリンク / クラブ名の日本語併記。
>
> **2026-07-16 追記**: O-Ringen 公式選手ページへのリンクを追加（`official-link.ts`）。公式の URL は
> `/{slug}/competitors/{entryId}` で**エントリー単位**（5日間クラス=1人1ID・Etappstart=日別ID・
> 複数クラス=クラス別ID）。ID が1つなら直接、複数なら公式の氏名検索 `?q=` へ送る（1件なら公式側が
> redirect）。`OringenEntry.competitorId`（API の `e`）を追加し ingest スキーマでは必須 nullable。
> **旧 Storage データにはこの ID が無いため、デプロイ後に sync-oringen を workflow_dispatch で回すこと。**
>
> **計画時に見落としていた重大な誤り3件**（すべてユーザーの目視で発覚。詳細は各 PR）:
> - **API の `st` は UTC**。現地時間と誤認し全ステータが2時間ズレていた（`toHhmm()` が唯一の変換点）
> - **空欄は「未抽選」ではなくフリースタート**。待っても永久に埋まらないものを「埋まります」と案内していた
> - **`sh` は `splitTimesHiddenUntil`** でレース日ではない。日付と誤読しかけた（危うく正しい日付を壊すところ）

## Context

trails.jp オーナー（児玉）が 2026-07-20〜25 の O-Ringen Göteborg 2026 に出場する。日本勢50名分の
スタートリストは別プロジェクト `~/projects/oringen_jp_startlist/` で取得・検証済みだが、非公開 Artifact
での共有に留まっている。これを trails.jp 上で、日本勢と関係者が最新状態で見られるようにする。

**計画時点で開催まで5日**。スタート時刻は 93/245 しか確定しておらず（O-Ringen 側が未抽選）、開催直前に埋まる。
開催中は結果が動く。**作って終わりではなく更新が要る**のがこの機能の本質。

期待する結果: `/abroad` を開けば、日本勢50名の日別スタート時刻と（開催中は）結果が、いつ時点のデータかと
共に見える。大会が終わったら PR 1本で消せる。

## 決定事項（2026-07-15 ユーザー）

| 論点 | 決定 |
|---|---|
| 配置 | ナビメニューに「海外遠征」を通常追加（PC 横並び・モバイルのハンバーガー両方）。**トップページ本体には出さない** |
| 内容 | 日本人スタートリスト / 大会期間中の結果 / 日程（**LapCenter 的レッグ分析はやらない**） |
| 掲載終了 | 手動（日付での自動非表示はしない） |
| 更新 | GitHub Actions |
| **生年** | **公開ページにも JSON にも入れない**。O-Ringen 自身が画面に出していない値（SPA バンドル内の `birthYear` は2箇所ともパーサで描画コンポーネントが無い）を、検索に載るサイトが再掲する理由がない。非公開 Artifact への同意は公開サイトへの同意ではない |

## O-Ringen API（未文書・SPA バンドルから発見）

- 出走データ: `GET resultat.oringen.se/api/races/{raceId}/classes/results/json?classIds=a,b,c`
- eventId=25 / slug=`2026` / raceId 124〜128（1〜5日目。7/20, 7/21, **7/23**, 7/24, 7/25。7/22 は休養日）
- 短縮キー: `p.f`=名 / `p.l`=姓 / `p.b`=生年 / `p.s`=性別 / `o.n`=クラブ名 / `o.c`=**クラブ国コード** /
  `st`=**スタート時刻**（現地時間・未抽選なら欠落）/ `e`=entryId / `d`=削除フラグ / `ot`=累計タイム
- 実測: 全189クラスを1リクエストに詰められる（1日 8.9秒 / 5.46MB / 11,668件）→ 5日で**約45秒 / 27MB**
- **日本勢が居るのは30クラスのみ**（1日 3.7秒 / 1.34MB）→ 5日で**約18.5秒 / 6.7MB**
- `organisationKey` によるクラブ単位取得は**全パターン0件で使用不能**（実測確認済み）
- 個人国籍 `p.n` は全58,621件が `"other"` で**使えない**。日本人判定はクラブ国コードのみ

## 設計

```
.github/workflows/sync-oringen.yml   (schedule + workflow_dispatch)
   └─ scripts/fetch-oringen.ts       GH runner で実行（時間制限が緩い）
        ├─ 30クラス × 5日 を取得（約18.5秒 / 6.7MB）
        ├─ o.c=='JPN' で抽出 → 既知50名ロスターと突合 → 生年を捨てて圧縮（~40KB）
        └─ POST /api/oringen/ingest   (Authorization: Bearer $ORINGEN_INGEST_SECRET)
                └─ 品質ガード → Supabase Storage `app-data/oringen-2026.json`（<5秒）
                        └─ src/app/abroad/page.tsx (revalidate=600) が readOringen() で描画
```

**なぜ取得を Vercel でやらないか**: Hobby の関数は 60秒上限。既存 `sync-entries` が同じ形で 504 を起こし
エントリー索引を凍結させた実績がある（`docs/plans/2026-07-12_lc_card_and_sync_entries_incident.md`）。
根本原因の脆弱な DB（max_connections=60）は変わっていない。**重い取得は GH runner に逃がし、Vercel には
薄い書き込みゲートウェイだけ持たせる。**

Vercel Hobby の cron は**本数ではなく「1日1回・±59分精度」が制約**。開催中に1日2回動かしたい時点で要件を満たさない。

**シークレット**: `CRON_SECRET` を流用せず **`ORINGEN_INGEST_SECRET` を新設**（既存 cron と権限を分離）。

### 品質ガード（最重要）

**最大リスクは、壊れた/欠けた/古い取得結果で正常な `oringen-2026.json` を上書きすること。**
zod の形式検証だけでは「50人が10人になった」「startTime が全部消えた」を防げない。
`index-quality.ts` と `readEventsStrict()` の fail-closed 思想を踏襲し ingest 側で拒否する:

- 人数下限（既知ロスターに対し下回ったら拒否）
- 前回比の劣化拒否（people 数・startTime 確定数が有意に減ったら拒否）
- `generatedAt` 鮮度（既存より古いペイロードは拒否＝順序逆転の防止）
- `eventId` の固定値一致 / payload サイズ上限
- 拒否・成功とも `logCron()`、拒否時は `notifyCronWarning()`

**拒否＝前回の正常データを保持**（last-good 保護）。壊れた更新より古い正確なデータを出す。
ブロックは **HTTP 200 + `{success:false, blocked:...}`** で返す（`entry-index-backstop.yml` と同じ規約。
200 だけ見て緑と誤認する事故を防ぐため、workflow 側は本文の `success` を見る）。

### 日本人の同定

`o.c == 'JPN'` は「日本人」ではなく**「日本クラブ所属」**判定。エントリーは締切済みで名簿は確定しているので、
**検証済み50名ロスターを正とし、`o.c=='JPN'` は補助**にする。これが人数下限ガードの根拠にもなる。

**30クラス固定**の割り切り: 全189クラス取得（45秒/27MB）はやめ30クラスに絞る。31番目のクラスに日本人が
現れたら漏れるが、エントリー締切済みのため許容する（`scripts/fetch-oringen.ts` 冒頭に明記）。

## 意図的に切ったもの（Codex レビュー＋5日という制約）

- **生年**（公開しない・JSON にも持たない）
- 公式プログラムのスクレイプ・会場名・アリーナ情報（API に無く、oringen.se は構造未調査）
- スプリット詳細・レッグ分析・`s[]` の UI
- 189クラス全取得
- 「海外遠征」の汎用化（`/abroad` = O-Ringen 2026 固定）
- trails.jp `athletes` テーブルとの突合（カナ・ローマ字が無く機械照合不能。人手確定済みの静的マップで足りる）
- binary プロトコル（GH runner なら JSON 27MB でも問題なし）

## 掲載終了の手順

1. `src/components/Header.tsx` の `navItems` から `/abroad` の1行を削除
2. `src/app/abroad` → `src/app/_abroad` にリネーム（`_` prefix でルーティング除外・CLAUDE.md:136）
3. `.github/workflows/sync-oringen.yml` の `schedule` をコメントアウト

## 残るリスク

1. **GH runner（US）から `resultat.oringen.se` への到達性は unknown**。`geocode-smoke` が GH-hosted で
   GSI の地理ブロックに当たった前例がある。**最初に `workflow_dispatch` で確認する**。到達不能なら
   取得を手元で回して ingest に POST する運用に落とす（ページと ingest はそのまま使える＝手戻りは workflow だけ）
2. **GH Actions の `schedule` は高負荷時に遅延・drop されうる**（GitHub 公式）。default branch でしか動かない。
   → **「速報」と名乗らない**。`generatedAt` を出し `workflow_dispatch` で手動更新できるようにする
3. O-Ringen の API は未文書。仕様が変われば壊れる。品質ガードは「壊れたまま出す」ことは防げるが
   「更新が止まる」ことは防げない → `generatedAt` の表示がユーザー側の検知手段
