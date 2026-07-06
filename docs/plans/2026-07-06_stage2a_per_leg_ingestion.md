# Stage 2a: per-leg ingestion 基盤 ＋ ⑤順位が動いたレッグ

- 作成: 2026-07-06 JST
- ステータス: **実装完了・PR #34 本番反映済み**（backfill 進行中・定時 cron 検証は翌日）
- 前段: `2026-06-29_results-analysis-methodology.md` §6.1（per-leg ingestion）・プリミティブ4（⑤）・`2026-07-06_cross_race_stage1.md`（Stage 2b の前提基盤）

## Context

クロスレース Stage 2（ミス指紋・信頼度加重トレンド）の前提となる per-leg データの DB 永続化と、DB 不要で出せる ⑤ を実装。**scalar 版と detailed 版のパーサは同一 URL** のため、cron の切替に追加スクレイピングコストなし。

## 実装

1. **`lc_leg_splits`＋`lc_leg_events`**（migration `2026-07-06_lc_leg_splits.sql`・Management API 適用済み）: 走者×レース1行・per-leg 配列カラム（秒 int・null 要素可）・全走者保持（MP=rank null）・`UNIQUE(lc_event_id,lc_class_id,runner_index)`・RLS 有効ポリシーなし。台帳はイベント選択/resume/健全性検証を兼ね、**zero-tracked イベントの永久再スクレイプと processedKeys の max-rows 切詰めを同時に解消**
2. **共有ビルダー `src/lib/analysis/leg-ingest.ts`**: 1パースから scalar 行（旧パスとビット同一・**フィクスチャでの新旧パリティテストで固定**）と per-leg 行を生成。normalizeClub/isSprint を cron から移設
3. **cron 改修**: detailed フェッチ切替・legRows 100行バッチ upsert・成功時のみ台帳記帳（失敗は翌日リトライ）・payload に leg_rows_upserted 等追加。予算ガード不変
4. **`scripts/backfill-lc-legs.ts`**（コミット済み運用ツール）: バンドル events.json の LC 突合イベントを新しい順に Management API SQL で投入（100行/文・quote二重化・NUL除去・JSON配列検証）。**lc_performances にも DO NOTHING 挿入**＝cron 未到達イベントのスカラー欠落を封じる。resume=台帳
5. **⑤順位が動いたレッグ**（`buildLegImpact`・レッグ分析ページ）: Codex 辛口レビュー反映済み——
   - **主指標=通過順位の平均変動**（elapsedRank の |Δ| 平均・記述統計）。C(l) が構造的に見逃す「1本で決まったレース」も捕捉
   - 副指標=ミス残差連動度 C(l)（T=残差行和・同一除数・優勝+25%コホート・折りたたみ・相対バーのみ）
   - 見出しから「勝負どころ」を排除・百分率禁止・負のC は「相殺傾向」・ρ は参考値・リレー系抑制＋フォーク未検出の明記・自己相関残存とレッグ長交絡を脚注
6. `backfillRaceTypeFromJoy` が lc_leg_splits も PATCH。docs（analysis-system.md §6.6・公開ページ LEG-IMPACT ブロック）

## Codex レビューでの設計変更（記録）

C(l) 単独主指標案を棄却（①1レッグ決着を見逃す ②レッグ長交絡 ③leave-self-out の自己影響残存 ④結果によるコホート選択 ⑤名前ベースのリレー抑制の弱さ）→ 順位変動を主指標に昇格・文言全面弱体化。

## 検証

- tsc clean・vitest **587件 green**（パリティ・leave-self-out 対照・ゲート・リレー抑制 等 +20）・build 成功
- [x] backfill dry-run（2件・クラス保持ルール動作）→ --limit 3 実書込 → 健全性クエリ**全 pass**（台帳793行一致・恒等式 relay 検算 0違反・ideal 恒等式 0違反・配列長 0違反・MP 159行保持）
- [x] フル backfill 起動（**Windows デタッチプロセス**・wsl 一発セッションでは子が死ぬため Start-Process 経由・log=/tmp/backfill-legs.log・resume可）— 2026-07-06 夜間実行中（855件・~3件/分）
- [x] PR #34 マージ・20:19 JST 本番デプロイ
- [x] ⑤本番確認: 西日本ロングセレ関西ME（24完走・K=6→C ボタン非表示=ゲート動作）／OME1（18完走・K=5）／**東大OLK 大クラス（67完走・K≥15）で順位変動バー＋C(l) 展開テーブル（バイポーラバー・ρ併記）完全表示**
- [ ] 翌日 12:00 JST 定時 cron の検証: `lc_leg_events` の source='cron' 前進・cron_log の leg_rows_upserted（CRON_SECRET がローカルに無く手動 smoke は省略。コアロジックは backfill が同一ビルダーで実証中・supabaseAdmin=service_role で RLS 非該当）
- [ ] backfill 完了後: 健全性クエリ再実行＋ pg_total_relation_size 実測（250MB 警戒線・dry-run 実測から ~200MB 見込み）

## Stage 2b（持ち越し）

ミス指紋（局面×レッグ長×重大度×lag-1・FDR・要統計設計レビュー）・信頼度加重トレンド・パック除染・フォーク構造検出。backfill 完了データが前提。
