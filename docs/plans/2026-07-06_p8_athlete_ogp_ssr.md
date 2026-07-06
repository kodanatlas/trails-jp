# P8: 選手ページ OGP/SSR — /a/[name] を正 URL に昇格

- 作成: 2026-07-06 JST
- ステータス: 実装完了（本番検証は PR マージ後に追記）
- 前段: `2026-07-03_critique_loop_site_review.md` P8（中期）

## Context

選手ページの実体が client 描画の `/analysis?athlete=<key>` で、X 共有時に OGP が汎用・初期 HTML に選手名が乗らなかった。調査の結果、SSR 共有ルート `/a/[name]`（generateMetadata＋動的OG画像＋SSRカード）が既に存在し、ページ内共有ボタンは既にそこを指していた。ギャップは「アドレスバーからコピーされる URL が `/analysis?athlete=` のまま」なこと。

## 実施内容

1. **`/a/[name]` をフル選手ページに昇格**: 新規 `AthleteStandalone.tsx`（client）が summary を props で受け（SSR され初期 HTML に選手名＋タイプ＋スタッツが入る）、athlete-index(1.9MB) 到着後に `AthleteDetail` へ差し替え。選手名・クラブは常設ヘッダーとして残す（ロード中に名前が消えない）。旧 CTA は分析ハブへの控えめリンクに置換
2. **未収録選手は 404 でなく `redirect("/analysis?q=<key>")`**（レッグ分析・週末ハイライトはランキング未収録名をリンクするため）。壊れ percent-encoding のみ 404 の設計だが、実際は **Next がルートセグメントの decode 段階で 500 を返す（既存挙動・本番でも再現・フレームワークレベル）** — 実害小のため今回は触らず
3. **キャッシュ**: `generateStaticParams() => []`（オンデマンド静的生成・デプロイまでキャッシュ。ビルド時に 1,781 件の OG 画像を生成しない）
4. **AnalysisHub のアドレスバー正規化**: `syncAthleteUrl` が選手選択中 `/a/<key>` を replaceState、解除時 `/analysis` に復帰。旧 `?athlete=`/`?q=` パースは後方互換で維持＋初期ロードでバーを正規 URL に正規化。popstate の forward 復元ギャップも修正（`athleteIndexRef` 導入）
5. **内部リンク 7箇所を `/a/<key>` にフリップ**（WeeklyCheerPodium / WeekendHighlights×2 / MonthlyMovers / RankingView / LegAnalysisClient×2）。HeroSearch `?q=`・results/go フォールバック・`?tab=support` 深リンクは非対象
6. **`sitemap.ts`（静的8＋選手1,781=1,789 URL）＋`robots.ts`** 新規

## 検証結果（ローカル）

- build: `● /a/[name]`=SSG・`○ /analysis` 静的維持・`○ sitemap.xml`/`robots.txt`。tsc clean・vitest 552 green
- curl `/a/児玉健`: og:title / twitter:card / og:image 参照 / 本文に選手名＋オリエンタイプ＋スタッツ（SSR）
- 未知名 → 307 `/analysis?q=<name>`。sitemap `<url>`=1,789 件。robots 正常

## 本番検証（マージ後に追記）

- [ ] ランキング→選手クリック→ /a/ 着地・カード即表示・詳細ロード
- [ ] ハブ検索→選手→アドレスバー /a/ →コピー→新タブ再現・タブ切替で /analysis 復帰
- [ ] クラブ/応援→選手→Back でタブ復元
- [ ] X 共有カード（メタタグ確認）・旧 `?athlete=` リンク後方互換
- [ ] 未収録名リンク→検索プリフィル
