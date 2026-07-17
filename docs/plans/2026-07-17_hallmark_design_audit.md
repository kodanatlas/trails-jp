# 2026-07-17 Hallmark デザイン監査（トップページ＋共通chrome）

ステータス: 実装完了・二段レビュー済・ローカルプレビュー確認済（コミット `1a2de1a` on `design/hallmark-audit`）。**push/マージ/デプロイは未実施＝ユーザー承認待ち**

## 二次レビュー（Codex read-only）結果と対応
- must-fix「ライト補正値が小サイズ文字 4.5:1 未達」→ 対応済（accent #0e7490 / positive #047857 / negative #b91c1c / cheer #be185d に濃色化）
- must-fix「置換漏れ」→ スコープ内（events/loading.tsx スケルトン・LegFingerprintCard ミス指紋セル）は対応済。**EventList.tsx 6箇所・AuthGuard.tsx はスコープ外＝下記フォローアップ**
- should-fix「ダークの見た目微差」（Footer 文字色が muted に統一・green-400(v4=#05df72)→positive #10b981 の色相差・tag α5%→6%）→ トークン統一の意図した変化として許容
- should-fix「EventList.tsx の transition-all 残 2 件」→ フォローアップ

## 背景
公開スキル [nutlope/hallmark](https://github.com/nutlope/hallmark)（anti-AI-slop デザインスキル、`~/.claude/skills/hallmark/` に導入済）の `audit` モードを trails.jp に適用する実験。対象はトップページ（`src/app/page.tsx`＋構成コンポーネント）と Header/Footer。全面 redesign は行わない（2026-06-28 エディトリアルリデザインの確立済アイデンティティを維持）。

## Audit 所見（hallmark anti-patterns 基準）

構造面は合格（左寄せエディトリアル hero・実データ stat・AIテンプレ構造なし・Footer は Ft2 inline 型）。指摘は以下。

### Major
1. **Mid-render token improvisation（gate 48）** — globals.css に意味トークン（--positive/--negative/--accent 等）を定義済みなのに、コンポーネント側は生値を直書き。サイト全体で 306 箇所/49 ファイル。
   - `text-[#00e5ff]`（JOY連携/βバッジ）: page.tsx, events/page.tsx, events/loading.tsx, analysis/page.tsx, LegFingerprintCard.tsx
   - `text-green-400`/`bg-green-500/15`/`text-red-400`: page.tsx, WeekendHighlights, MonthlyMovers ほか
   - `bg-white/5` タグ地: 同上
   - Footer: `bg-[#1a2332]`/`border-white/10`/`text-white/40` ハードコード
2. **ライトテーマ破綻（token 逸脱の実害）** — #00e5ff は白地でほぼ不可視、bg-white/5 は白地で消失、Footer はライトでも濃紺のまま、green-400 は白地でコントラスト約1.9:1。
3. **transition-all（microinteraction tell）** — カード hover。対象スコープ内 4 箇所（サイト全体 19 箇所）。
4. **絵文字アイコン（gate 30）** — WeeklyCheerPodium の 🥇🥈🥉（OS 依存描画）。

### Minor / 据え置き判断
- Header は AI-nav 形状に部分一致するが、実アプリの chrome として妥当（6 実導線・アクティブ状態・テーマトグル）→ 維持
- hero の kicker（罫線＋一行）は序数装飾でなくサイト定義文・1箇所のみ → 維持
- stat 行は実 DB 数値＋ラベル付き・border-l 型（カード羅列でない）→ 維持

## 実装スコープ（Codex 委譲）
1. globals.css: ライトテーマ用 semantic 上書き（--accent/--positive/--negative/--optimal/--warning）＋新トークン --tag/--cheer/--medal-{gold,silver,bronze}（dark/light 両値）＋ @theme inline 登録
2. スコープ内ファイルの生値→トークン移行（page.tsx / WeekendHighlights / MonthlyMovers / WeeklyCheerPodium / Footer / JOY・βバッジ4箇所）
3. transition-all → transition-colors（スコープ内のみ）
4. 表彰台の絵文字メダル削除（色トークン化した段ブロックで代替）

## スコープ外（フォローアップ候補）
- analysis 配下（AthleteDetail 31 箇所ほか）・carpool・rankings・events 残りの生カラー移行（計 306 箇所の残り）
- SupportTab の pink → --cheer 統一
- OG 画像（常時ダーク描画のため対象外）

## 検証
- `npx tsc --noEmit`・`npm run lint`（機械）
- WSL 側 `npm run dev` → ダーク/ライト両テーマでトップページ実描画確認（SW キャッシュ注意）
- 二段レビュー: Claude 一次（diff）→ Codex read-only 二次
