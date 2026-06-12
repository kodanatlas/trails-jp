# /docs/analysis-system 刷新計画 — サイト全体・modern-report デザイン

作成: 2026-06-12 JST

## 目的

`/docs/analysis-system`（trailsjp.vercel.app 上のライブページ）を最新化する。

- **範囲拡張**: 「分析機能限定」→ **trails.jp サイト全体の技術解説**へ。
- **見せ方**: 技術屋が読みたくなる、魅力的なコンテンツ＋ビジュアル。
- **デザイン**: `modern-report` スキルのデザインシステム（配色・コンポーネント）を採用。
- **形式/URL**: trails.jp 内の React ページとして実装（デプロイ対象）。URL は `/docs/analysis-system` のまま、**直リンクのみ**（ヘッダーナビ非掲載）。

## 現状

- `src/app/docs/analysis-system/page.tsx`（server）が `docs/analysis-system.md` を `MarkdownRenderer` で表示しているだけ。地味・分析機能限定。
- ルートは root `layout.tsx` が Header(固定ダーク) + Footer(ダーク) で全ページを囲う。`globals.css` は `body{background:#0f1720}`。
- サイトはダーク固定（テーマトグル無し）。Tailwind v4。

## 採用するデザイン（modern-report）

- ダーク既定＋ライトのテーマトグル（右上固定・localStorage 保存・OS 追従）。
- 4アクセント: cyan / violet / pink / amber（＋green）。CSS 変数。
- 部品: ヒーロー＋eyebrow＋KPIカード / 番号付きセクション / `.map-frame`＋インラインSVG / 3色カード / 決定カード / 契約パネル / タイムライン＋不変条件 / ロードマップ / 警告アクション / 論点カード / フッター。
- SVG はテーマ追従（presentation attribute を属性セレクタで上書き）。

### modern-report からの意図的な逸脱

- フッター既定「サントリー EA基盤G」は **trails.jp 用に差し替え**（例: `trails.jp ｜ 日本オリエンテーリング統合プラットフォーム ｜ <実日付>`）。
- 標準フロー（template.html を output/ に単体 .html でコピー）ではなく、**TSX へ移植**してサイト内ページ化する（ユーザー指定）。
- CSS は `html[data-theme]` グローバルではなく **`.report-root` 配下にスコープ**（多ページ SPA への埋め込みのため）。

## 実装方針

### ファイル構成

```
src/app/docs/analysis-system/
  page.tsx                  ← server: metadata 出力 + <AnalysisSystemReport/> を描画（.md 読込は廃止）
  AnalysisSystemReport.tsx  ← "use client": テーマ状態 + トグル + 全セクション + SVG
  report.css                ← modern-report の CSS を .report-root 配下にスコープ移植
```

- ページ全体を client にせず、metadata は server の page.tsx が持つ。トグルと localStorage のため本体は client。
- テーマは `.report-root` の `data-theme` 属性で制御（`html` は触らない＝サイト他ページへ非干渉）。
- `docs/analysis-system.md` は内部リファレンスとして残置（ページからは参照しない）。

### サイト chrome（Header/Footer）の扱い — 要確定

直リンクの**スタンドアロン文書**として全画面で見せ、ライトテーマを成立させるため、`/docs/` 配下では Header/Footer を非表示にする方針（推奨）。

- `Header.tsx`（既に client）: `pathname?.startsWith("/docs/")` で `return null`。
- `Footer.tsx`（現在 server）: `"use client"` 化 + `usePathname` ガードで `return null`。
- 影響範囲: `/docs/*` のみ（現状 analysis-system だけ）。リスク小。
- 代替案: chrome を残し **ダーク固定（トグル廃止）** でサイト内一体化。→ modern-report の目玉トグルを失う。

### コンテンツ構成（サイト全体・ドラフト）

| # | セクション | 部品 | 主な内容 |
|---|---|---|---|
| Hero | trails.jp とは | hero + KPI | LIVEピル / キャッチ / リード。KPI: イベント数・選手数・LCレコード数・ランキングクラス数 |
| 01 | システム全体マップ | map-frame + SVG | JOY/LapCenter → スクレイパー → Cron/バッチ → Supabase → API → フロント の層構造図（中核ビジュアル） |
| 02 | 機能 | docs/topics カード | イベント / ランキング / 選手分析 / クラブ分析 / 選手比較 / 応援(いいね) |
| 03 | データソース | 契約パネル or 2カード | JOY（イベント・ランキング・エントリー）/ LapCenter（巡航速度・ミス率） |
| 04 | データパイプライン | タイムライン + 不変条件 | sync-events(03:00) / sync-lapcenter(12:00) / sync-entries(04:00) / 水曜再デプロイ。不変条件=Hobby 1日1回 |
| 05 | 永続化・DBスキーマ | 契約パネル / 表 | Supabase テーブル群（athletes/appearances/lc_performances/likes/cron_log/snapshots）+ Storage |
| 06 | 分析ロジック | 決定カード / code | 安定性(CV) / 最近の調子(種目別) / タイプ分類(z-score) / トレンドライン(最小二乗) — 技術的見どころ |
| 07 | API | 契約パネル | 主要エンドポイント（method/役割/データソース） |
| 08 | 技術スタック | 論点カード / chip | Next.js 16 / React 19 / Tailwind v4 / Recharts / Supabase / cheerio / undici |
| 09 | 既知の制限・ロードマップ | ロードマップ / 警告 | Phase1 DB移行済(now) → Phase2 API化。Hobby 制約等 |

- 数値は出典・as-of を明示（ランキング系は 2026-05-29 時点など）。ライブ厳密値ではなく「規模感」として「約」表記も併用。

## 検証（modern-report QA 準拠）

- **ビルドは WSL のみ**（Windows node は lightningcss native 不足で不可）。`wsl -d Ubuntu -- bash -lc "cd /home/... && npm run build"` 相当。
- 両テーマ × 3幅（1280/768/390px）で横スクロール無し（`scrollWidth - clientWidth = 0`）。
- トグル実クリックで dark ↔ light 往復。
- SVG が両テーマで色追従。タグ開閉の self-closing 誤計上に注意。
- 可能なら Playwright でスクショ目視（4分割クロップ）。

## デプロイ — 要確定

- 実装後の本番反映は **Vercel CLI（Git Bash の Windows node / `--token` PAT）** で手動。outward-facing のためユーザー確認の上で実施 or ユーザー手動。
- 手動アクションが残る場合は `_taskhub/TASKS.md` に追記。

## 未確定事項（実装前に確定したい）

1. chrome 非表示（推奨）か、ダーク固定でサイト内一体化か（＝ライト/ダークトグルの有無）。
2. 公開ページに DB スキーマ・Cron 内部・API 一覧を出して良いか（現 .md は既に全公開。問題なければ踏襲）。
3. デプロイは私が実施（要確認）か、ユーザー手動か。
4. コンテンツ構成（上表）に過不足は無いか。
