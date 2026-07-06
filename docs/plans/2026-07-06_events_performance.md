# バッチ4: /events 高速化（ISR化＋ペイロード削減）

- 作成: 2026-07-06 JST
- ステータス: 実装完了（本番計測は PR マージ後に追記）
- 前段: `2026-07-03_critique_loop_site_review.md` の持ち越し（バッチ4）

## Context

本番 `/events` は 応答 ~2.4s・HTML ~1.26MB・キャッシュなし。原因は3点:

1. `src/app/events/page.tsx` の `dynamic = "force-dynamic"` — 毎リクエストで Supabase Storage から `app-data/events.json`（全 2,272 件・~850KB）をダウンロード＋パース。
2. 全件を Client Component（`EventList`）に props 渡し → 全配列が RSC ペイロードとして HTML に埋め込まれる。デフォルトフィルタ「昨日以降」はクライアント側表示フィルタのみでペイロードは減らない。
3. UI が使わないフィールド（`venue` / `event_type` / `lat` / `lng` / `source` / `dokori_public_id`）も全部載っていた（~25% 死荷重）。

データ鮮度: events.json が変わるのは cron の最大1日2回（sync-events 03:00 JST 毎日＋sync-lapcenter 12:00 JST 条件付き）→ 10分 ISR で実害ゼロ。

## 変更（3ファイル）

1. **`src/app/events/page.tsx`** — `force-dynamic` → `export const revalidate = 600`（ISR 10分）。`toListItem()` で EventList が参照する12フィールドだけの新配列に map してから props 渡し（optional は値がある時だけキーを含める＝Flight の `$undefined` 混入回避）。
2. **`src/app/events/EventList.tsx`** — `export type EventListItem = Pick<JOEEvent, ...12フィールド>` を定義し、props と `canShowEntries()` の型を差し替え。ロジック変更なし。
3. **`src/app/results/page.tsx`** — 同一パターン。`force-dynamic` → `revalidate = 600`（ペイロードは既にスリムなので ISR 化のみ）。

## 触らなかったもの（安全上の理由）

- `readEvents()` 自体のキャッシュ化はしない — cron の read-modify-write が古いベースで書き戻す危険。キャッシュはページ ISR のみ。
- results/[eventId] 系・API routes・cron は変更なし。
- 「デフォルト日付範囲だけサーバー送出＋過去分オンデマンド API」の抜本分割は Phase 3 として持ち越し（今回の効果測定後に判断）。

## 検証結果（ローカル・WSL ビルド）

- `next build` ルートテーブル: `/events` `/results` が `○ (Static) revalidate 10m` に変化
- `tsc --noEmit` clean・vitest 552 件 all green
- ローカル prod サーバー: /events 初回生成後の2回目 **10ms**・HTML **806KB**（本番比 ▲36%）。削減フィールド（venue/event_type/dokori_public_id）= 0 件、温存フィールド（lapcenter_event_id=858・recently_updated=28）を確認
- /results: 2回目 **8ms**

## 本番計測（マージ後に追記）

- [ ] /events: x-vercel-cache MISS→HIT、TTFB、HTML サイズ
- [ ] /results: 同上
- [ ] ブラウザ実機能ウォークスルー（フィルタ・カレンダー切替・エントリー展開・結果分析リンク）
