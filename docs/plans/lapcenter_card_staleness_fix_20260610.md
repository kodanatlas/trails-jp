# 巡航速度・ミス率カードに最新大会（千葉大大会）が反映されない：診断と修正方針

- 日付: 2026-06-10 JST
- 報告: 選手ページで実際は「千葉大大会」が最新だが、巡航速度・ミス率カードが最新化されていない
- 対象UI: `/analysis`（`src/app/analysis/AthleteDetail.tsx` の `LapCenterChart`, L674-1060）

## 1. 結論

カードのロジックは正常。**`lc_performances` テーブルに千葉大大会の行が1件も無い**のが原因。
順位推移・大会参加状況カード（JOYランキング由来＝ビルド時データ）には千葉大大会が出るが、
巡航速度・ミス率カードは `lc_performances`（LapCenterスクレイプ由来）だけを描画するため欠落する。

## 2. 該当する大会

| 大会 | LCイベント | 日付 | 種目 | データ | 状態 |
|------|-----------|------|------|--------|------|
| 第30回千葉大大会（本命・最新） | 9827 | 2026-06-06 | Forest | 32クラス/342名マッチ | prodでmatch済・**未スクレイプ** |
| 第29回千葉大大会 午前 | 9596 | 2026-02-21 | Sprint | 4クラス/148名マッチ | match済・**未スクレイプ（飢餓）** |
| 第29回千葉大大会 午後 | 9598 | 2026-02-21 | Sprint | 33クラス/0名（成績未掲載） | 取得不可・対象外 |

## 3. 根本原因（複合）

### 原因1: スクレイプのスループット不足（本命）
`src/app/api/cron/sync-lapcenter/route.ts`
- `MAX_RUNNER_EVENTS = 3`（L43）かつ `if (jstDay === 3)`（L72）＝**水曜のみ・週3イベント**
- prod実績: マッチ済 959件 / 取得済 432件 ＝ **約527件が未取得**。週3では数年規模
- 6月のイベントは現状 `lc_performances` に**1件も無い**（テーブル最新日 2026-05-31）

### 原因2: 新しい順ソートによる古いイベントの飢餓
`scrapeRunners()` L130-133: `.sort((a,b)=>b.date.localeCompare(a.date)).slice(0, MAX_RUNNER_EVENTS)`
- 後から登録された古い大会（第29回千葉大大会＝2026-02-21, joe_event_id 2455 は第30回 joe 2315 より後に採番＝後発登録）は
  永遠に上位3件に届かず未取得のまま

### 原因3: 大イベントの時間切れ
- 千葉大大会(9827)は **32クラス**。`DELAY_MS=800`（L44）×32 ≈ **26秒**
- `sync-lapcenter` route に `maxDuration` 未設定（既定〜10s, cf. `vercel.json` L7-10）
  → 上位3件に入っても処理が完了できない可能性

### 原因（非バグ・前提）: カード描画はビルド時JOYランキング日付に依存
`AthleteDetail.tsx` L705-711: `joyByDate.get(p.d)` が無いLC点はスキップ（種目判定のため）
- 今回は2026-06-06 Forestがライブランキング（2026-06-09再ビルド）に既に含まれるため**ここは問題なし**
- ただし「スクレイプ完了」と「週次再ビルドでJOYランキングに点が乗る」の両方が揃って初めて表示される、という恒常的ラグ要因

## 4. 検証ログ（実機・本セッションで確認済み）
- `lc_performances`: 千葉 0件 / max=2026-05-31 / 22,223行 / 432イベント
- `cron_log`(sync-lapcenter): 直近2週 `new_matches=0` 継続、水曜のみ `events_processed=3`、6月取得ゼロ
- マッチ実機（ローカルtsx）: joe2315「第30回千葉大大会」→ LC9827 に正常マッチ、`fuzzyMatch` true
- ライブJOYランキング: `age_forest_無差別`/`女子無差別`/`elite_forest_M21E` に `2026-06-06 千葉大` あり
- LC9827=32クラス/342名、LC9596=4クラス/148名、LC9598=0名（掲載なし）
- `new_matches=0` は「prodで既にmatch済」が理由（`total_matched=959`）。欠落は取得工程のみ

## 5. 修正方針

### A. 即時バックフィル（本番DB書き込み）
- LC9827・LC9596 を `scripts/scrape-lapcenter-runners.ts` 相当でスクレイプし `lc_performances` に upsert
- upsert キー `athlete_name,event_date,event_name,class_name`（L197）＝冪等
- event_name は events.json の名称、event_date は events.json の日付に合わせる（カードの日付JOINが効くように）
- 結果: 342+148名分の千葉大大会データが即表示

### B. 恒久修正（`src/app/api/cron/sync-lapcenter/route.ts`）
1. `export const maxDuration = 60`（sync-entries と同様）
2. 水曜限定を解除し毎日実行 or `MAX_RUNNER_EVENTS` 引き上げ＋**壁時計予算ループ**
   （sync-entries 方式: 連続供給プール＋予算秒数で時間内最大処理）
3. キュー優先度を「新しい順」から「**JOYランキング対象の最近イベント優先**」へ
   （カードはJOYランキング日付しか描画しないため、見える範囲を先に埋める）
4. `DELAY_MS` 見直し / 巨大イベントのクラス上限 or 部分保存（途中保存）

## 5.5 独立レビュー反映（2026-06-10 改訂）

Codex CLIはアカウントのモデル制限で headless 実行不可だったため、別コンテキストの
批判的レビュアー2体で診断・方針を検証。実機確認で取捨選択した結果：

### 診断の訂正・追加（確定）
- **【訂正】9827 は本番では既にマッチ済み。** `sync-events`(03:00 JST) が
  `matchLapCenterEvents`→`writeEvents` を**毎回無条件実行**（sync-events/route.ts:90,102）。
  joe2315→9827 はストレージ events.json に反映済み。`sync-lapcenter` の `new_matches=0` は
  「sync-events が先にマッチ済みだから」。**マッチ永続化の追加対応は不要**
  （ローカル committed events.json が古いだけ）。ストレージ app-data/events.json は
  2026-06-09 18:12 更新の現役（749KB, 2427件）。
- **【追加・重要】巨大イベントの全損リスク。** `scrapeRunners` は全レコードをメモリに貯め
  ループ後に一括 upsert（route.ts:191-203）。`maxDuration` 未設定（既定〜10s)で、
  32クラスの9827がループ内に来ると関数が時間切れ→**その回の全イベント分が0件保存**。
  6月データがゼロな一因はこれ（大イベントが回ごと巻き添えにする）。
- **【追加・重要】processedKeys のロード上限。** route.ts:117-120 が
  `select(...).limit(10000)`（order無し）。lc_performances は22,223行で、
  処理済キーの約半分が欠落→取得済イベントを未処理扱いで再取得し3枠を浪費。
  スループット劣化のもう一つの原因。
- **【確認】カードは `race_type t` を使わず JOYランキングから種目を再導出**
  （AthleteDetail.tsx LapCenterChart）。バックフィルの race_type 誤りは表示に無害。
- **【確認】表示には「JOY一致するLC日付が2件以上」必要**（AthleteDetail.tsx:82 と :791 の二重 `>=2`）。
  最新が千葉大大会の選手でも、過去LC実績が1件しか無いと描画されない（多くは該当せず）。

### 方針Aの訂正（バックフィル手法）
- **`scripts/scrape-lapcenter-runners.ts` は使わない。** これは `public/data/lapcenter-runners.json`
  に書くだけで（:14,:242）、DBに入れるには別途 `import-to-db.ts` が必要・LCイベントID指定不可。
- **正：専用ワンオフで `lc_performances` に直接 upsert。** 9827/9596 をIDハードコードし、
  `fetchEventClasses`/`fetchSplitList` ＋ cron の照合/正規化/除外ロジック（route.ts:147-189）を流用。
  `event_name`/`event_date` は **events.json の値をそのまま使う**（9596 は "千葉大大会"/"2026-02-21"）。
  upsertキー `athlete_name,event_date,event_name,class_name` と一致させ、将来の cron 書込と冪等にする
  （表示用の人間可読名「第29回千葉大大会 午前」等は**使わない**＝重複行防止）。

### 方針Bの訂正（最小十分セット・ゴールドプレーティング除去）
1. `export const maxDuration = 60`（sync-entries と同様・本番で許容実績あり）
2. `if (jstDay === 3)` を撤廃して毎日実行（cron自体は毎日発火・水曜ゲートだけ外す）
3. **upsert をイベントループ内へ移動（イベント単位で逐次保存）＋壁時計予算ループ。**
   → 巨大イベントの全損を防ぎ、クラス上限は不要（途中まで保存・次回再開）
4. processedKeys の `.limit(10000)` を是正（distinct クエリ化 or 上限撤廃）
5. **不要（やらない）**: 「JOYランキング優先ソート」（newest-first で十分・I/O増）、
   「クラス上限」（逐次保存で代替・データ欠落回避）
6. **礼儀**: DELAY_MS 短縮と毎日化を同時にやらない（mulka2への負荷急増回避・1変数ずつ）

## 6. リスク・未決事項
- Vercel Hobby の cron 1日1回・Function実行時間制限（毎日化・maxDuration引き上げの可否）
- `DELAY_MS` 短縮時の LapCenter への負荷・礼儀
- バックフィルの本番DB書き込み実行タイミングの承認
- 恒久修正後も「スクレイプ×週次再ビルド」両依存のラグは残る（許容範囲か）
- 飢餓解消の優先度ロジックが、過去の大量未取得バックログ（527件）をどう扱うか（全部は追えない）
