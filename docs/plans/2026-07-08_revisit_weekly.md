# 再訪トリガー PR3b: 週次スナップショット → 先週比（wow）

- 作成: 2026-07-08 JST / ステータス: 実装完了（wow は蓄積約1〜2週後に可視化）
- 前段: `2026-07-08_revisit_movers.md`（PR3a・月次 movers＋個人ブロック）

## 目的
レビュアー要望「今週の順位変動（先週比）」。月次(mom)より粒度の細かい先週比(wow)を導入し、急上昇/個人ブロックを wow 優先に。

## 実装
- **新テーブル** `ranking_snapshot_weekly (week, file_key, stats)`（migration・既存月次 `ranking_snapshot` と同型・RLS public_read・**ユーザー承認の上 Management API で本番適用済み**）。week = その週の月曜日 YYYY-MM-DD。
- **build**: 前週スナップショットを取得し wow デルタ算出、`rank_delta.wow`/`points_delta.wow` を付与、当週スナップショットを upsert。
- **movers.json**: `basis: "wow" | "mom"` を追加。前週スナップショットが在れば wow、無ければ mom にフォールバック。schema を `delta`/`pointsDelta` に統一（basis 非依存）。
- **UI**: `MonthlyMovers` は basis で「今週の急上昇/先週比」⇄「今月の急上昇/前月比」を切替。個人「最近の動き」も wow 優先（無ければ mom）・ラベル追従。

## 蓄積タイムライン
週次テーブルは新規で空 → **初回ビルドで当週分を書き込み・前週が無いため wow は付かず mom 表示**。翌週以降のビルドで前週が揃い wow 表示に自動切替（約1〜2週）。

## 検証
- tsc clean・vitest 628件 green・migration 適用確認（table + RLS）
- ローカル実描画（週次空＝basis=mom）: トップ「今月の急上昇/前月比」佐藤健人 M21 ↑493、児玉「最近の動き S_M40 46位±0 前月比」。wow 経路はコード・型で担保、蓄積後に本番で確認
- [ ] PR → CI → マージ → 本番（当週 weekly 書込確認）→ 翌週 wow 切替確認

## スコープ外
movers の class-size 正規化・週次の個人履歴グラフ
