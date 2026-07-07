# Stage 2b: ミスの傾向（クロスレース）＋信頼度加重トレンド＋パック除染

- 作成: 2026-07-07 JST
- ステータス: 実装完了（本番確認は PR マージ後に追記）
- 前段: `2026-06-29_results-analysis-methodology.md` 層A（§10 追記に relay-first 翻訳を明文化）／`2026-07-06_stage2a_per_leg_ingestion.md`（データ基盤）

## Context

層Aの本丸。lc_leg_splits（116,710行）から選手ごとの「ミスの傾向」（局面×レッグ長×重大度×lag-1）と信頼度加重トレンドを生成。設計は Plan エージェントの実データ圧力テスト（84.3万レッグ・ミス閾値 0.15 案と素朴 lag-1 を棄却）→ **Codex 辛口レビューで4点を全採用**:

1. exact 二項+BH は独立性破れで甘い → **レース層別 permutation**（ミス総数固定の並べ替え＝日次調子・レース内相関を帰無に保存）に置換
2. 「両者対称除外は偏り非生成」の断言を削除 → 非無作為性を明記＋**除染 ON/OFF 感度分析**をハーネス化
3. lag-1 の MH 層別はレース間交絡のみ → **permutation p ゲート追加＋「参考」表示**＋コース系列交絡を明記
4. 方法論文書に relay-first 翻訳（per-leg FDR→セル permutation）を**追記**（黙って置換しない）

## 統計スペック（確定）

docs/analysis-system.md §6.7 に転載済み。要点: ミス判定 `loss ≥ max(FLOOR_d, 0.30×(lap−loss))`（実測較正の規約・params 公開）／パック除染 ε=15s/10s・4境界連続 run・両者除外／9セル permutation（B=400・決定的シード）+BH(q=0.10)+効果量1.3倍ゲート／重大度 Δ3ビン+ρ中央値／lag-1 MH+permutation p≤0.1／加重トレンド w=cleanLegs×min(規模,20)・加重中央値 Theil–Sen（等重み厳密一致）・reliable<5 抑制。

## 実装

- 新規 `src/lib/analysis/leg-fingerprint.ts`（純関数・mulberry32 決定的シード）＋ `leg-fingerprint.test.ts`（21件: 対立/帰無合成・パック検出・MH 交絡対照・境界・決定性）
- `cross-race.ts`: `weightedMedian`＋`theilSenTrend(arr, minPoints, weights?)` 後方互換加重化（等重み厳密一致テスト）
- `build-analysis-index.ts`: `buildLegFingerprintStep`（2本の pruned select・#33 イディオム・<40k 行ガード・keepOrSkeleton）
- 新規 `LegFingerprintCard`（3×3 グリッド・重大度バー・lag-1・正直な全部入り脚注・recharts なし・DeferUntilVisible 配下）
- `AthleteDetail`: カード挿入＋ LapCenterChart の（種目,日付）重み照合→加重トレンド＋reliable<5 抑制＋脚注更新
- 新規 `scripts/leg-fingerprint-smoke.ts`（Management API・キャッシュ付き・感度分析内蔵）

## 実データ検証（2026-07-07 smoke）

- 入力 tracked=57,501 / companions=59,209
- 掲載: forest 1,165 / sprint 450 選手。ミス率中央値 20.7%/12.0%（設計時予測と整合）
- パックレッグ率 11.4%/9.4%（目標帯 forest<10% を僅かに超過＝マススタート系を正しく除染している範囲と判断・ε は据え置き）
- フラグ保有 13%/8%（q=0.10 の帰無期待＋実信号として妥当な水準）・lag-1 表示 309/63 選手
- **除染 ON/OFF フラグ一致率 99.1%**（14,535 セル）＝除染がフラグを不安定化しない
- artifact 2,108KB（コミット済み・縮退ビルドの初期値）

## 機械検証

- tsc clean・vitest **609件 green**（+22）
- [x] SKIP_FETCH ビルド縮退パス（既存 artifact 保持）・ローカル実描画（児玉健: 序盤×中レッグ 37% 赤フラグ・重大度ヒスト・lag-1 約1.1倍・パック除外227レッグ表示＝face validity 良好）
- [ ] PR → CI → マージ → 本番確認（ビルドログ tracked≈57k・カード描画・gzip サイズ・数日後 Supabase egress 目視）

## スコープ外（将来）

同走力帯コホート版指紋・フォーク構造検出・EWMA・beta-binomial 化（脚注に将来余地として明記済み）
