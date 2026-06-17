# 直近の土日祝大会「自己平均超え」2リスト（トップページ刷新）

作成: 2026-06-17 JST / 更新: 2026-06-17 17:30 JST / 対象: trails.jp（本番 https://trailsjp.vercel.app ）

## 1. 目的・最終構成

トップページの **「今月の急上昇」（前月比movers）を撤去**し、代わりに
**「直近の土日祝に開催された大会で、自分の平均より良い成績だった選手」** を **上下2リスト**で見せる新ブロックを置く。

| 位置 | リスト | 指標 | 生成 | 鮮度 | データ源 |
|---|---|---|---|---|---|
| 上 | **ポイント上昇度** | 直近大会の獲得イベントP − 自己平均イベントP（同種目） | **ビルド時**（build-analysis-index） | 週次（水デプロイ＝点が火/水更新と整合） | JOYランキング event_scores（ビルド成果物） |
| 下 | **合成上昇度** | 巡航速度・ミス率の自己平均比（z合成） | **ランタイム ISR + RPC** | 日次（lc_performances は毎日Cron更新） | DB `lc_performances` |

両リストは独立に「直近の(データのある)土日祝」を選び、対象日を明記。
ランキング対象大会が無い週末でも、下（合成）はLapCenterデータがあれば表示される（対象日が上下で異なり得る＝各々ラベル表示）。

## 2. 確定仕様（ユーザー回答）

1. 対象 = 直近の**土日祝日**（国民の祝日含む）開催大会。データ無→**データのある直近にフォールバック**。
2. 上=「**直近大会の獲得P − 自己平均**」、下=「**巡航+ミス合成の自己平均比**」。**今月の急上昇は撤去**。
3. 鮮度 = 上はビルド時（週次・水）、下は日次タイミング。
4. ポイントは火/水にJOY反映 → 水曜デプロイで取り込み済み（旧"2週間遅れ"認識は誤りと訂正）。
5. Codex = 当アカウントで全モデル "not supported" のため不使用。Claude のセルフレビュー＋実データゲートで代替。

## 3. 実測で確定した事実

- `lc_performances`(DB): `athlete_name`(空白除去キー), `event_date`,`event_name`,`class_name`,
  `cruising_speed`(8〜476・**高いほど良い**), `miss_rate`(0〜90・**低いほど良い**), `race_type`(forest/sprint)。
- `sync-lapcenter` Cron は**日次**。先週末6/13–14は反映済（552/233名）。
- `build-analysis-index.ts` は各選手の `allEvents:{date,eventName,points,discipline}` を保持済（=上リストの素材）。
- ホームは ISR(`revalidate=86400`) の async サーバーコンポーネントで既にDBを叩く（getSiteStats）。
- **スモーク実測（6/13–14）**: 合成は min5・速度改善で224名／速度もミスも改善で133名 → 表示余裕。
- **罠**: 合成は単純合算でスケール破綻＆%比はミス率支配（普段ミス多い人＝小母数で暴れる）。
  → コホート内 **z-score**＋**外れ値クリップ(速度30–250/ミス0–80)**＋**最小実績**で是正。

## 4. アルゴリズム

### 4-A. 上「ポイント上昇度」（ビルド時・純JS）
1. 対象日 = 全 `allEvents` の日付のうち**土日祝**かつ存在する最大日クラスタ（`weekend-window.ts` 共有）。
2. 各選手で対象日に event_scores があるもの: `p_recent` = 対象大会の獲得P（複数なら最大）。種目 d。
3. `baseline` = その選手の **同種目・対象前** の event_scores 平均P。`件数 >= MIN_P_SAMPLES`(=3)。
4. `delta = p_recent − baseline`。`delta>0` を採用、降順、上位 N(=5)。
5. `weekend-points.json` を出力: `{generatedAtJst, targetDates, items:[{name,key,club,discipline,pRecent,pAvg,delta}]}`。
   - 名前は空白除去キーで表示（下リストと統一）。delta は生値（=ユーザー選択。高得点層に寄る旨は注記）。

### 4-B. 下「合成上昇度」（ランタイム・RPC）
- `weekend_standouts(candidate_dates date[], min_samples int, max_results int)`:
  1. clean: 速度30–250 かつ ミス0–80。
  2. 対象クラスタ: 候補日のうちclean存在の最大日＋[−2d]ブロック。
  3. target (athlete,race_type) avg速度`ts`/avgミス`tm`。baseline: 対象前 avg`bs`/`bm`/件数`bn>=min_samples`(=5)。対象週は除外。
  4. `speedGainPct=(ts-bs)/bs*100`、`missDropPP=bm-tm`。コホート内 z化し `composite=z(speed)+z(miss)`。
  5. 採用ゲート `ts>bs`、並び `composite` 降順、上位 max_results(=8)。
  6. 返却: name,race_type,ts,bs,tm,bm,bn,speedGainPct,missDropPP,composite,class_name,対象日。
- 呼び出しは **`supabaseAdmin`（サーバー専用）**。関数は anon 非公開（権限最小化）。

### 4-C. 共有 `src/lib/weekend-window.ts`（純関数・両経路で使用）
- JST today、過去28日で 土/日/祝 を列挙（曜日は日付要素から＝TZ非依存、祝日は `src/data/jp-holidays.json`(2024–2027)）。
- 与えられた「存在する日付集合」から最新の土日祝クラスタを選ぶ（フォールバック内包）。

## 5. 表示 `src/components/WeekendHighlights.tsx`（async サーバー）

- `page.tsx` の `<MonthlyMovers/>` を撤去し、本コンポーネントを同位置に。`revalidate=86400` 継承。
- 1セクション内に上下2リスト。各リスト見出し＋対象日ラベル＋指標バッジ「自己平均比」。
  - 上「ポイント上昇度」: `weekend-points.json`(静的import)。行=順位/氏名(→`/analysis?athlete=key`)/種目/club/「P +Δ（今回X·平均Y）」。
  - 下「合成上昇度」: `supabaseAdmin.rpc` → `athlete-index.json`でclub補完。行=順位/氏名/クラス・種目/「巡航 +X%」「ミス −Y pt」。
- 各リスト 3件未満は当該リスト非表示。両方空ならブロックごと非表示。エラーは握りつぶし非表示。
- モバイルは movers 同様レスポンシブ（副次列 `sm:` 出し分け、相対値・flex/grid＝reporting.md準拠）。

### 5-1. 合成の算出方法をUIで明示（ユーザー要望）
- 下リスト見出し直下に**常時表示の短い説明**を置く。例:
  「合成上昇度 = 各選手の〈巡航速度〉と〈ミス率〉が**自己平均をどれだけ上回ったか**を、
   その週末の出場者内で標準化(z)して合算。巡航は速いほど＋、ミスは少ないほど＋。」
- さらに `<details>「算出方法」` で1段詳しい式（速度改善% / ミス改善pp / z化 / 合算 / 採用条件＝自己平均より速い / 最小実績5戦）を折りたたみ表示（モバイルでもタップで開閉。tooltip非依存）。
- **各行に内訳を必ず表示**（巡航 +X% ／ ミス −Y pt）。合成スコアは順位の根拠として右端等に併記し、数字の出どころが追えるようにする。

### 5-2. 更新時刻のズレを各リストに明記（ユーザー要望）
- 上下で更新タイミングが異なる（上=週次ビルド／下=日次ISR）ため、**各リストに個別の更新時刻**を表示。
  - 上: `weekend-points.json.generatedAtJst`（ビルド時刻）＋「（週次更新）」。
  - 下: ISRレンダー時に JST 時刻を生成し表示＋「（日次更新）」。
- ブロック内に一言注記:「上下で更新タイミングが異なります（ポイント=週次／巡航・ミス=日次）」。

## 6. 撤去・改変

- `page.tsx`: MonthlyMovers の import/描画を削除 → WeekendHighlights に置換。
- `build-analysis-index.ts`: movers.json 生成ブロック（§4-C末尾の独立ブロック）を削除し weekend-points.json 生成を追加。
  **ランキング delta（rank_delta/points_delta）・スナップショット処理は他用途のため温存**。
- `MonthlyMovers.tsx`・`movers.json` は未使用化（revival 可能なよう削除はしない／import除去で非ビルド）。
- マイグレーション `supabase/migrations/2026-06-17_weekend_standouts_fn.sql` 追加 → Management API で適用＋コミット。

## 7. テスト / 検証（tdd-workflow + 実データゲート + 導線ゲート）

1. vitest: `weekend-window` の曜日/祝日/JST/28日窓/クラスタ選択、上リストの delta 計算・整形（純関数）。
2. 実データスモーク `scripts/weekend-standouts-smoke.ts`（RPC を実DBで叩き目視＝carpool教訓のデータ依存ゲート）。
3. `npx tsc` / `next build`（既存テスト緑も確認）。
4. ペルソナ導線レビュー（初見/既存選手/モバイル）。
5. デプロイ後、本番で2リスト描画・リンク遷移・空状態を確認。

## 8. デプロイ

- DBマイグレーション適用 → Vercel CLI（Git Bash Windows node・PAT `VERCEL_TOKEN`／必要時ユーザー依頼）。

## 9. 実装体制

- model-policy: 実装はサブエージェント(Opus)へ委譲。ultracode: 実装→テスト→敵対的コードレビュー→導線レビューを Workflow で編成。

## 10. 保守・未確定・既知の限界

- `jp-holidays.json` 年次更新（コード保守）。`MIN_P_SAMPLES`/`min_samples`/重み/件数はスモークで調整。
- 上=生delta は高得点層に寄る／巡航速度%・JOY点は大会の基準走者・大会重みに依存（大会間比較ノイズ・既知前提）。
- Phase 2 候補（任意）: 上リストの正規化(%/z)、合成の日次→事前計算cache化、氏名のスペース付き表示。
