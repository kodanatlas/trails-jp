# Stage 2d: ミス傾向の期間比較（直近12ヶ月 vs それ以前）

- 作成: 2026-07-08 JST / ステータス: 実装完了（本番確認は PR マージ後）
- 前段: `2026-07-07_stage2b_miss_fingerprint.md`・`2026-07-07_stage2c_cohort_homonym.md`
- 発端: 専門読者レビュー第2弾「序盤×中レッグに弱いのが直っているか見たい」

## 設計判断（Codex 辛口レビューで確定）

ユーザー当初選択は「全体＋十分なnのセル」だったが、Codex レビューが**セル別期間差分は最高学府OL層に雑と刺される**（n≥15 でも±25-30pt揺れ・レッグのレース内相関で実質1-2レースのコース差・9セルの選択バイアス・permutation赤フラグと証拠水準が違う）と強く指摘 → ユーザー再確認で**「全体ミス率の2期間のみ」に決定**。

- 記述のみ・検定なし。**矢印/色で改善判定を示さない**（`N%→M%` はNG）。5%刻み＋レース数併記。
- 表示ゲート: 両期間とも **races≥3 かつ legsValid≥30**（実データ掲載率 forest 54%/sprint 43%）。
- 交絡（クラス・季節・コース難度）を分離していない旨を明記。「上達/悪化の判定に使えない」「方向はトレンド線」。

## 実装

- `leg-fingerprint.ts`: `PeriodStat{races,n,m}`・`DisciplineFingerprint.periods?`・`LegFingerprintIndex.periodCutoff?`・params `periodMinRaces/periodMinLegs`（3/30）を**全てオプショナル追加**（新旧 artifact 混在で壊れない＝切り戻し容易）。opts に `periodCutoff` を受け、集計前に `races: RacePool[]` を `.date` で二分（純関数維持・cutoff は引数）。
- `build-analysis-index.ts` / `leg-fingerprint-smoke.ts`: cutoff = ビルド時点の12ヶ月前を渡す。
- `LegFingerprintCard.tsx`: DisciplineBlock に期間ブロック（5%刻み `pct5`・レース数・未調整 caveat）。
- artifact サイズ 2121→2188KB（+67KB のみ・periods は各指紋に軽量追加）。

## 検証

- tsc clean・vitest **628件 green**（+3: 両期間ゲート通過で periods 出力／片期間薄で抑制／cutoff未指定で無し）
- 実データ smoke: 期間比較掲載 forest 632/1164 (54%)・sprint 191/449 (43%)・児玉健 = 直近14レース(22.9%) / 以前27レース(27.2%) → 両方5pt丸めで約25%（レース内相関を踏まえ差は判別不能＝honest）
- ローカル実描画確認（フォレストに期間ブロック・スプリントは薄く非表示＝正しいゲート）
- [ ] PR → CI → マージ → 本番確認

## スコープ外
セル別期間差分（Codex 棄却）・期間×コホート帯の交絡補正・beta-binomial
