# 再訪トリガー PR3a: 今月の急上昇（movers）＋個人「最近の動き」

- 作成: 2026-07-08 JST / ステータス: 実装完了（本番確認は PR マージ後）
- 発端: 専門読者レビュー第2弾「週次ダイジェスト＝再訪理由が無い・エントリー空だと下半分が静的」

## 前提診断（解決済み）

当初「月次デルタが本番未反映」と観測したが、**再確認で本番ランキング JSON に `rank_delta` は反映済み**だった（過渡期の一時状態）。`ranking_snapshot` は 2026-03〜07 蓄積・RLS に `public_read`・6月7月で名前1072名共通。**パイプラインは正常**＝movers/個人ブロックの素材が今日ある。

## 実装

- **movers.json 生成**（`build-analysis-index.ts`）: デルタ算出ループで前月比の順位上昇（現役）を収集 → 選手ごと最大上昇に集約 → 上位8を書き出し。**無差別/Open の包括カテゴリは除外**（母集団巨大で順位ジャンプが大きく「急上昇」として意味が薄い＝H2H候補と同じ理由）。0件時は既存 seed 保持。
- **MonthlyMovers 復活**: 死んでいたコンポーネントを `page.tsx` に import（WeekendHighlights の直後）。**イベント非依存**（ランキング週次更新）でオフシーズンも表示＝下半分の静的化を緩和。
- **個人「最近の動き」ブロック**（`AthleteDetail.tsx` の `RecentMovement`）: `loadAthleteDetail` が per-class rankings JSON から `rankDelta`/`pointsDelta` を露出（`types.ts` に `RankDelta` 追加）。主戦＝デルタを持つ最上位クラスの前月比 順位・得点を1行表示。前月スナップショット無し（新規・久々）は非表示。

## 検証

- tsc clean・vitest 628件 green（純関数変更なし・既存維持）
- 実データ描画（本番デルタをローカルに一時展開）: トップ「今月の急上昇」= 佐藤健人 M21 ↑493 / 大久保颯良 S_M21 ↑486 …（専門クラスのみ・包括除外OK）。児玉ページ「最近の動き」= スプリント S_M40 46位 ±0 前月比（安定＝honest）
- src/data/movers.json は実データ seed をコミット（次ビルドで再生成）
- [ ] PR → CI → マージ → 本番確認（movers 再生成・個人ブロック site-wide）

## 次段（PR3b・別PR）
週次 ISO 週スナップショット（`ranking_snapshot_weekly`）→ **先週比（wow）** の順位変動。蓄積1〜2週で有用に。movers/個人を wow 優先（蓄積前は mom フォールバック）。

## スコープ外
週次基盤（PR3b）・movers の class-size 正規化・elite 優先重み付け
