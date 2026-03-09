# trails.jp - 日本オリエンテーリング統合プラットフォーム

## プロジェクト概要

リトアニアの trails.lt をベースに、日本のオリエンテーリング・トレイルラン向けに
地図DB・GPS追跡・ランキングを統合したWebプラットフォームを構築する。

**本番URL**: https://trailsjp.vercel.app

## 技術スタック

- **フロントエンド**: Next.js 16 (App Router) + TypeScript
- **UI**: Tailwind CSS v4
- **地図**: MapLibre GL JS + 国土地理院タイル
- **バックエンド**: Next.js API Routes
- **認証**: Supabase Auth (Email OTP)
- **ホスティング**: Vercel (Hobby)
- **外部連携**: JOY (イベント), Lap Center (成績), Formspree (問い合わせ)

## フォルダ構成

```
trails_jp/
├── CLAUDE.md              ← このファイル
├── docs/
│   ├── plans/             ← 計画書
│   ├── research/          ← 調査資料
│   └── changelog/         ← 作業ログ
├── scripts/               ← バッチスクリプト
├── src/
│   ├── app/               ← App Router pages
│   │   ├── about/         ← このサイトについて
│   │   ├── contact/       ← お問い合わせ（Formspree）
│   │   ├── events/        ← イベント一覧（JOY連携）
│   │   ├── maps/          ← 地図データベース
│   │   ├── rankings/      ← ランキング
│   │   ├── tracking/      ← GPS追跡
│   │   ├── upload/        ← O-map登録
│   │   └── api/cron/      ← 日次バッチ（sync-events, sync-lapcenter）
│   ├── components/        ← UIコンポーネント
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   └── AuthGuard.tsx  ← Supabase Auth (Email OTP)
│   ├── lib/
│   │   ├── supabase.ts    ← Supabase クライアント
│   │   ├── sample-data.ts ← サンプルO-map・ランキングデータ
│   │   ├── map-event-matcher.ts ← O-map↔JOYイベント座標マッチング
│   │   ├── scraper/       ← JOY/Lap Centerスクレイパー
│   │   └── utils.ts
│   ├── data/
│   │   └── events.json    ← JOYイベントキャッシュ（573件、438件座標付き）
│   └── types/             ← TypeScript型定義
└── public/
    └── data/rankings/     ← ランキングJSONキャッシュ
```

## 環境変数

| 変数名 | 用途 | 設定場所 |
|--------|------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクトURL | Vercel + .env.local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anon Key | Vercel + .env.local |
| `NEXT_PUBLIC_FORMSPREE_ID` | Formspreeフォーム ID | Vercel |

## 外部サービス設定

### Supabase (trails-jp)
- プロジェクトRef: `.env.local` を参照
- 認証: Email OTP (8桁コード)
- メールテンプレート: カスタム日本語テンプレート適用済み
- Site URL: `https://trailsjp.vercel.app`
- Redirect URLs: `https://trailsjp.vercel.app/**`

### Formspree
- フォームID: `.env.local` を参照
- 送信先: `.env.local` を参照

### Vercel
- プロジェクト: `trails_jp`
- Cron: 日次 03:00 JST (sync-events), 12:00 JST (sync-lapcenter)
- 水曜 Cron で自動再デプロイ → ビルド時にJOYランキング最新取得
- Hobby プラン（Cron 1日1回制限、Function 10秒制限）

## データフロー

- **JOYイベント**: 日次Cron → scrape → events.json
- **O-map↔イベント紐づけ**: bounds + 3km圏内の座標マッチ
- **Lap Center**: 日次Cron → 成績ページリンク付与
- **ランキング**: ビルド時にJOYから無差別4クラス全ページ取得（水曜自動再デプロイ）

## 注意事項

- 地図データベースの8件はサンプルデータ（`isSample: true`）
- O-map登録にはSupabase Auth認証が必要
- O-mapアップロード時は画像の長辺2000px以上が必須（写真撮影のO-map排除）
- ドメイン `trails.jp` は未取得

## コーディング規約

- 日本語コメント可、変数名・関数名は英語
- コンポーネントは機能単位で分離
- サーバーコンポーネント優先、必要な場合のみ "use client"
- 地図関連は `lib/map/` に集約

## レビューワークフロー

1. **Claude Code (Opus 4.6)** でコードレビュー → `review_report.md` に出力
2. **Cursor Agent (GPT-5.4)** で `review_report.md` をクロスチェック
3. 指摘の誤り修正・見落とし追加を反映
