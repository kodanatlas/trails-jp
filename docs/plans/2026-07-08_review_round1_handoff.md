# 引継ぎ: 専門読者レビュー反映（第1弾 実装中・第2弾 未着手）

- 作成: 2026-07-08 JST（Fable 利用上限に備えた Opus 向け引継ぎ。ユーザー承認「全部やりましょう」済み）
- ブランチ: `feat/review-round1`（main = PR#41 マージ済み時点から分岐）
- タスク: #7=第1弾（項目1-5）実装中 / #8=第2弾（項目6）未着手・要プラン設計

## 背景

インカレ経験者ペルソナの fresh-eyes レビュー（会話ログ 2026-07-08 昼）で6項目の改善指摘。ユーザーが全部実施を承認。第1弾=軽量な1-5を1 PR、第2弾=機能群6を設計から。

## 第1弾の実装仕様（このブランチで・1 PR）

1. **規約定数の明記**（`src/app/docs/analysis-system/AnalysisSystemReport.tsx` 06章）
   - CONSISTENCY の why 末尾に追記: 「0.3 は『CV 30% で 0 点』とする規約スケール（検定に基づく値ではない）。」
   - TYPE の why の「閾値 0.3」を「閾値 0.3（±0.3σ・規約値）」に
   - でっち上げの根拠（「上位選手の分布から決めた」等）は書かない。規約と明示する方針（0.30ミス閾値と同じ流儀）

2. **高ミス率レースの1行解釈**（`src/app/analysis/CrossRaceCard.tsx` DisciplineRow・「高ミス率レース: x/n」の直後 line~72）
   - blowRate = entry.blow / entry.n。基準=構成上の期待 0.25。ゲート: entry.n ≥ 8 のときのみ表示
   - neutral(|z|<0.25)×blowRate≥0.40 →「読み方: ミスの中央値は同水準帯なみですが、大きく崩れるレースの割合が高め＝平均型というより『ムラ型』の出方です（参考）」
   - better×≥0.40 →「読み方: ふだんのミスは少なめですが、崩れるときは大きい傾向です（参考）」
   - worse×≥0.40 →「読み方: ミスが多めで、大崩れの頻度も高めです（参考）」
   - blowRate≤0.15 →「読み方: 大崩れの少ない安定した出方です（参考）」
   - それ以外は行を出さない（無理に解釈しない）。text-xs text-muted・断定語禁止

3. **帯差と「偏りなし」並置の解説**（`src/app/analysis/LegFingerprintCard.tsx`）
   - 現状: bandLine（同レベル帯より…約+Npt多い）と「統計的に偏って多いセルはありません。」が並ぶと矛盾に見える
   - 修正: フラグ0のとき、bandLine が在る場合のみ文言を「統計的に偏って多いセルはありません（帯との差は偶然の範囲を出ない可能性があります）。」に

4. **「最近の調子」の演出緩和**（`src/app/analysis/AthleteDetail.tsx` line ~495-510）
   - |recentForm| < 5 のとき数値色を中立（クラス無し）に（±5%はn=3のノイズ域。緑/赤は|5|以上のみ）
   - アイコン（TrendingUp/Down）の条件も同閾値に合わせる

5. **スコア推移の F/S 二軸化**（同ファイル ScoreChart・Line dataKey="forest"/"sprint" line ~700/713・YAxis ~666）
   - 生得点の同一軸重ねは自サイトの正規化思想と矛盾（レビュー指摘）→ 左軸=Forest(緑)・右軸=Sprint(青)の yAxisId 二軸に。tick 色を系列色に合わせ、domain は両軸 ["auto","auto"]
   - トレンド線（fSpeedMa等は別チャート。ScoreChart 内の forestMa/sprintMa があれば同じ軸IDに割当）

## 検証と出荷（確立済みフロー）

tsc → `npx vitest run`（615件 green 基準）→ SKIP_FETCH build → ローカル実描画（/a/児玉健: 二軸・調子色・解釈行、+CrossRace/指紋カード）→ commit → push → gh api で PR 作成 → vitest CI green → squash マージ（この件はユーザー包括承認済み）→ 本番デプロイ確認（gh api commits/main/status が success まで・15-40分）

## 第2弾（タスク#8・未着手）

新機能群のため CLAUDE.md 準拠でプラン設計から（ExitPlanMode 承認 → 実装）:
- **H2H 同走大会の対戦成績**: 勝敗数・平均得点差・（可能なら lc_leg_splits からレッグ勝敗）。athlete-index の appearances 突合
- **ミス傾向の期間比較**: 直近12ヶ月 vs それ以前のグリッド比較（leg-fingerprint artifact に期間別セルを追加。ゲート緩和の設計判断要・記述比較なら Codex 必須ではないが統計表現は要注意）
- **再訪トリガー**: 週次の変化表示（設計自由度大・ユーザーと形を確認するのが安全）
- 統計の新しい主張を伴う場合は Codex 辛口レビュー（memory: feedback_trails_results_analysis_rigor）

## 環境の要点（Opus 向け）

- ビルド/テスト/git は WSL: `wsl -d Ubuntu -- bash -c "cd /mnt/c/Users/user/Downloads/trails_jp; export PATH=/home/kodan/.nvm/versions/node/v24.12.0/bin:/usr/bin:/bin; ..."`。PR は gh.exe（`gh api`）
- 一時スクリプトは repo の scripts/ に置かない（セッション scratchpad へ）。rm 系はユーザー依頼（deny リスト）
- Write ツールで稀に U+0000 が混入した実績あり（grep がバイナリ扱いしたら `sed -i 's/\x00/|/g'` 型で除去）
- Supabase 読みは PostgREST max-rows の罠（空ページ終了・実返却幅前進）／ローカル REST キー失効→Management API
- 直近の運用監視: sync-lapcenter cron が 7/7 に1回欠測（7/8 は正常・per-leg 書込確認済み）。数日は cron_log を気にかける。Supabase egress（build毎~50MB）も月内に一度目視
