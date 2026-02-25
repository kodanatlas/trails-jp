# trails.jp - 日本オリエンテーリング統合プラットフォーム

## プロジェクト概要

リトアニアの trails.lt をベースに、日本のオリエンテーリング・トレイルラン向けに
地図DB・GPS追跡・ランキングを統合したWebプラットフォームを構築する。

## 技術スタック

- **フロントエンド**: Next.js 15 (App Router) + TypeScript
- **UI**: Tailwind CSS v4 + shadcn/ui
- **地図**: MapLibre GL JS + 国土地理院タイル
- **バックエンド**: Next.js API Routes
- **DB**: PostgreSQL + PostGIS (Supabase)
- **認証**: NextAuth.js v5
- **ホスティング**: Vercel
- **GPX処理**: gpxparser.js

## フォルダ構成

```
trails_jp/
├── CLAUDE.md              ← このファイル
├── output/                ← 成果物出力先
├── docs/
│   ├── plans/             ← 計画書
│   └── research/          ← 調査資料
└── src/                   ← ソースコード (Next.js)
    ├── app/               ← App Router pages
    ├── components/        ← UIコンポーネント
    ├── lib/               ← ユーティリティ
    └── types/             ← TypeScript型定義
```

## 開発フェーズ

1. **Phase 1 (MVP)**: 地図ライブラリ + イベントカレンダー + 静的ランキング
2. **Phase 2**: ライブGPS追跡 + 軌跡再生
3. **Phase 3**: ユーザー登録 + プロフィール + クラブページ
4. **Phase 4**: PWA + API公開 + トレイルラン拡張

## コーディング規約

- 日本語コメント可、変数名・関数名は英語
- コンポーネントは機能単位で分離
- サーバーコンポーネント優先、必要な場合のみ "use client"
- 地図関連は `lib/map/` に集約
