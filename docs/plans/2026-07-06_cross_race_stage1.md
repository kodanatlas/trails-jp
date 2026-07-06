# クロスレース縦断分析 Stage 1（同水準巡航速度帯のミス残差＋頑健トレンド）

- 作成: 2026-07-06 JST
- ステータス: **完了**（PR #31＋修正 #33 マージ・本番確認済み）
- 前段: `2026-06-29_results-analysis-methodology.md` 層A ／ `2026-07-03_critique_loop_site_review.md` 中期戦略（堀）

## Context

「独自の堀」の本命＝クロスレース縦断。方法論プランの層A（①同走力帯への相対ミス残差 ②ミス指紋 ③調子トレンド）のうち、**①③は既存 `lc_performances` スカラー（25,275行・実測）だけで実装可能**なため Stage 1 として先行実装。②ミス指紋は per-leg DB ingestion（未実装）が前提のため Stage 2 に分離。

## 統計設計（確定・docs/analysis-system.md §6.4-6.5 に転載済み）

- 種目独立・n≥5、走力プロキシ＝巡航速度中央値、ミス水準＝ミス率中央値、期待値＝選手横断 Theil–Sen、残差の MAD 標準化 z（**UI 非表示の診断値**）、表示＝百分位の**10%幅帯**
- 高ミス率レース＝種目内 Q3 閾値の該当本数（データ駆動・「期待値25%」とは言わない）
- トレンド線＝サイト全体（スコア/巡航速度/ミス率/比較）を Theil–Sen に統一・5点ゲート・レース順ベース明記・スロープ数値非表示
- |z|<0.25 は「ほぼ期待どおり」の中立表示（微小差を断定しない）

### Codex(gpt-5.5) 辛口レビューの反映（Step 0・全採用）

「同走力帯」の過剰主張→「同水準の巡航速度指標帯」に変更／z の UI 非表示＋百分位帯化／期待値25%主張の削除／レース順ベース明記／**重複行の平均をやめ完全同値のみ除去**（別クラス出走は正当な別レース・relay 忠実）／限界リストに race mix・共有基準アーティファクト・回帰希薄化・パック/フォーク非検出を追加／「大ミス」→「高ミス率レース」

## 実装

- 新規 `src/lib/analysis/cross-race.ts`（純関数: median/mad/quantile/theilSen/theilSenTrend/buildCrossRaceIndex）＋ `cross-race.test.ts`（15件・方向ガード含む）
- `scripts/build-analysis-index.ts`: backfill 後に lc_performances を Range ページングで取得→ `public/data/cross-race.json` 生成。失敗/env欠如は既存保持（縮退確認済み）
- 新規 `src/app/analysis/CrossRaceCard.tsx`（rechartsなし・セッション1回fetch・未掲載選手非表示）→ AthleteDetail の LapCenterChart 直後
- トレンド置換3箇所: AthleteDetail ScoreChart/LapCenterChart・CompareAthletes（重複 linReg 3個を削除し共通化）＋チャート脚注
- docs: analysis-system.md §6.4 書換＋§6.5 新設・公開ページ AnalysisSystemReport セクション06 に TREND 更新＋ CROSS-RACE 追加

## 実データ検証（Management API・2026-07-06）

- 入力 25,275 行 → forest 1,323 / sprint 370 選手掲載・artifact 134KB
- fit: forest slope=0.13（遅いほどミス多＝符号正常）scale=5.54pp / sprint slope=0.09 scale=2.87pp
- z 分布ほぼ対称（forest p25=-0.59/med=0/p75=0.8・右裾は blow-up 由来で想定通り）
- face validity: 平岡丈（JOY F 1位）= z=-0.75「ミスの少なさ上位11〜20%」／児玉健 = forest ほぼ期待どおり（z=0.1）・sprint やや多い（z=1.01）— 納得感あり
- 既知の粗さ: 極端 z が spd 端に寄る＝一次近似の端の適合の粗さ → docs/脚注に明記済み
- 検証済み artifact を `public/data/cross-race.json` にコミット（ローカル/縮退ビルドの初期値）

## 機械検証

- tsc clean・vitest **567件 green**（+15）・build 成功（縮退パス「既存ファイル保持」動作確認）
- ローカル実描画: カード2種目表示・方向安全文言・帯バー・脚注・スコア推移の Theil–Sen 破線 確認済み

## 本番確認

- [x] /docs/analysis-system に CROSS-RACE 記載・/data/cross-race.json 配信（PR #31 デプロイ 2026-07-06 17:41 JST）
- [x] **本番障害と修正（PR #33）**: 初回本番ビルドで artifact が 50選手/5.5KB に縮退。原因＝PostgREST は `Range` を `max-rows`（既定1000）で切り詰めるため「返却<要求」の終了判定が1頁目で打ち切り。ローカル検証は Management API（キャップなし）のため発見不能だった。→ 終了判定を空頁のみ・前進幅を実返却行数に修正＋**取得5,000行未満は既存 artifact を上書きしないガード**を追加
- [x] #33 デプロイ後の最終確認（18:24 JST）: artifact 148KB・**F=1,323 / races=19,567 / slope=0.13 / scale=5.54 ＝ローカル検証と完全一致**・選手ページでカード描画（中立表示「ほぼ期待どおり」含め文言・帯バー・脚注すべて意図通り）

## 関連の潜在問題（別対応・記録のみ）

`sync-lapcenter` cron の既処理イベント読み（supabase-js `.limit(100000)`）も同じ max-rows キャップで先頭1,000行しか読めていない可能性が高い。upsert は冪等なので実害は「既処理イベントの再スクレイプ＝処理予算の浪費と優先度制御のずれ」に留まるが、次回 cron 改修時に要確認。

## Stage 2（持ち越し）

per-leg DB ingestion（新テーブル＋sync-lapcenter 改修＋backfill 戦略）→ ミス指紋（局面×レッグ長×重大度・FDR）・信頼度加重トレンド・決定的レッグ・パック除染
