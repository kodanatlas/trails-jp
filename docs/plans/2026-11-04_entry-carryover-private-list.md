# エントリーリスト非公開化で選手のエントリーが消える問題（持ち越し）

ステータス: 完了（2026-11-04 実装・本番反映）
作成: 2026-11-04 JST

## 背景
- 伊豆大島大会2026（JOE 2415・11/29）は 9/16 からエントリーリストが公開されていたが、主催者が 10/28 に JOE 側のリストを非公開にした（主催者サイトに五十音順リストあり）
- 非公開になると `show_detail` に「チーム名」列のテーブルが無くなる → `parseEntryList` は `teams: []`（total は「N 人が申込済」の公称値）を返す
- `buildEntryIndex` はこれを「フェッチ成功・0件」として扱うので、日次の作り直しで**その大会のエントリーが全選手の索引から消える**
- 影響: 選手ページの「今後のエントリー」から消える。Mac mini の JDOA 大会チャンネル自動作成も、会員6名のエントリーを拾えなかった
- 品質ガード（`assessRegression`）は、共通大会が多いと1大会の0件化ではブロックしない（今回もブロックされず上書きされた）

## 方針（A: 非公開化前のエントリーを残す）
`sync-entries` が新しい索引を作るとき、次の条件を満たす大会は、前回の索引にあったその大会のエントリーをそのまま引き継ぐ。
- 今回フェッチには成功したが、エントリー行が0件
- 前回の索引には、その大会のエントリーが1件以上ある

引き継いだエントリーには `carriedOver: true` を付ける（型に optional で追加）。次回以降も同じ条件なら引き継ぎ続け、大会日が対象期間（today〜+120日）から外れた時点で自然に消える。

## 変更点（見込み）
- `src/lib/entries/index-types.ts`: `AthleteEntryRef.carriedOver?: boolean`
- `src/lib/entries/build-index.ts`: `buildEntryIndex(targets, opts, prevIndex?)` に前回索引を渡し、0件大会の持ち越しを行う。`carriedEventIds` を返す（ログ用）
- `src/app/api/cron/sync-entries/route.ts`: `prevIndex` を渡す（読み込み済み）。cron_log に持ち越し件数を記録
- テスト: `build-index` の単体テスト（0件化で持ち越す／前回も0件なら何もしない／エントリーがある大会は上書き／別名キーの重複が増えない／期間外の大会は持ち越さない）

## 受入条件
- 単体テスト追加分と既存テストが全部通る（`npm test`）・型チェック（`npx tsc --noEmit`）
- 実データ: JOE 2415 の `show_detail` を `parseEntryList` に通すと 0 行になること（＝持ち越し条件に入る）を確認
- 本番反映後、次回 sync-entries の cron_log に持ち越し件数が出る

## 未確認・決めること（ユーザー確認）
- Q1 持ち越しの条件を「0件化なら理由を問わず」にするか、「非公開の文言があるときだけ」にするか
- Q2 選手ページに「非公開化前の情報」と表示を出すか
- Q3 既に消えてしまった伊豆大島大会の分をどうするか（前回の索引はもう上書き済みで、JOE からは取り直せない）

## 決定（2026-11-04 ユーザー確認）
- Q1 → 0件化なら理由を問わず持ち越す
- Q2 → **選手ページに注記を出す**（「JOY のリスト非公開前の情報」）。今後も非公開化された大会は選手ページに出し続ける
- Q3 → **伊豆大島大会2026 を選手ページに出す**: 主催者の五十音順リスト（eskantoc.com/izuoshima2026/entrylist/）から氏名・所属・クラスだけを `src/data/entry-seeds.json` に取り込み（597名。JOY の公称「597 人が申込済」と一致）。前回索引に分が無い0件大会は seed で補う（前回索引があればそちらを優先）

## 実装
- `build-index.ts`: `buildEntryIndex(targets, opts, prevIndex)`。0行の大会を記録し、前回索引→seed の順で `carriedOver: true` の参照を補う。`carriedEventIds` を返す
- `sync-entries/route.ts`: prevIndex を渡し、cron_log に `carried_events`
- `UpcomingEntries.tsx`: carriedOver の行に注記
- テスト: `__tests__/build-index-carryover.test.ts`（10件）。全体 1084 passed・tsc OK
- 実データ: JOE 2415 の show_detail に「チーム名」表が無いこと（＝持ち越し条件に入る）と、対照の 2607 には表があることを確認
