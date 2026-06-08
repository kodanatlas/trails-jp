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
│   │   ├── admin/cron-status/ ← Cron稼働状況ステータス（公開・noindex）
│   │   ├── contact/       ← お問い合わせ（Formspree）
│   │   ├── events/        ← イベント一覧（JOY連携・所属別エントリーリスト表示）
│   │   ├── _maps/         ← [停止] 地図データベース（2026-06-08廃止・`_`で非ルーティング）
│   │   ├── rankings/      ← ランキング
│   │   ├── _tracking/     ← [停止] GPS追跡（2026-06-08廃止）
│   │   ├── _upload/       ← [停止] O-map登録（2026-06-08廃止）
│   │   └── api/
│   │       ├── cron/      ← 日次バッチ（sync-events, sync-lapcenter）
│   │       └── events/[id]/entries ← エントリーリスト取得（オンデマンド+1hキャッシュ）
│   ├── components/        ← UIコンポーネント
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   └── AuthGuard.tsx  ← Supabase Auth (Email OTP)
│   ├── lib/
│   │   ├── supabase.ts    ← Supabase クライアント
│   │   ├── sample-data.ts ← サンプルO-map・ランキングデータ
│   │   ├── map-event-matcher.ts ← O-map↔JOYイベント座標マッチング
│   │   ├── club-normalize.ts ← クラブ名の名寄せ・分割（選手ページとエントリーリストで共有）
│   │   ├── scraper/       ← JOY/Lap Center/エントリーリストスクレイパー
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
| `SUPABASE_SECRET_KEY` | Supabase service_role key | Vercel + .env.local |
| `CRON_SECRET` | Cron認証トークン | Vercel |
| `VERCEL_DEPLOY_HOOK` | 水曜再デプロイ用Deploy Hook URL | Vercel |
| `RESEND_API_KEY` | Cronエラー通知メール送信用 | Vercel + .env.local |
| `NOTIFICATION_TO_EMAIL` | Cronエラー通知の宛先メールアドレス | Vercel + .env.local |
| `NOTIFICATION_FROM_EMAIL` | (任意) 送信元メール。未設定なら `onboarding@resend.dev` | Vercel + .env.local |

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
- Cron: 日次 03:00 JST (sync-events), 04:00 JST (sync-entries), 12:00 JST (sync-lapcenter)
- 水曜 Cron で Deploy Hook による自動再デプロイ → ビルド時に Proxy API 経由で JOY ランキング最新取得
- Cron 実行ログ: Supabase `cron_log` テーブルに記録
- Hobby プラン（Cron 1日1回制限、Function 10秒制限）

## データフロー

- **JOYイベント**: 日次Cron → scrape → Supabase Storage (events.json)
- **O-map↔イベント紐づけ**: bounds + 3km圏内の座標マッチ
- **LapCenter巡航速度・ミス率**: 水曜Cron → Supabase DB (`lc_performances` テーブル) → `/api/lc/[name]` API
- **ランキング**: ビルド時に Proxy API (`/api/rankings/proxy`) 経由で JOY から無差別4クラス全ページ取得（水曜自動再デプロイ、PC起動不要）
- **選手・クラブ**: ビルド時に `build-analysis-index.ts` → 静的JSON + Supabase DB (`athletes`, `athlete_appearances` テーブル)
- **エントリーリスト**: `/events` で各イベントの JOY エントリー者を所属（クラブ）別に集計表示。`/api/events/[id]/entries` が `show_detail` をオンデマンド取得（1hキャッシュ）。名寄せは `club-normalize.ts`（選手ページと共有）。複数所属は分割して各クラブに計上（二重計上）、total は実人数。対象は受付中＋直近30日の締切済。
- **選手別エントリー状況**: 日次Cron `sync-entries`(04:00 JST) が未開催(date>=今日, ~120日以内)の **全大会**(最大60件)のエントリーリストを並列スクレイプ（`entry_status` は信頼せず全statusスキャン＝アーカイブ由来は `none` になり受付中でも none のため。連続供給プール＋全体予算6.5秒・失敗は1回リトライ）→ 氏名キー(スペース除去)で選手別インデックス `entry-index.json` を Supabase Storage に保存。`/api/athletes/[name]/entries` が当該選手分を返し、選手ページ(`/analysis`)の「大会エントリー状況」カード(`UpcomingEntries`, `RecentEvents` の直下)が表示。非2xxは失敗扱いで空集計せず、全件失敗時は既存インデックスを保持（空上書き防止）。`entryStatus` の `none` はバッジ非表示。

## DB構成 (Supabase PostgreSQL)

| テーブル | 用途 | データ量 |
|---------|------|---------|
| `likes` | いいね機能 | - |
| `athlete_like_counts` | いいね数集計ビュー | - |
| `athletes` | 選手マスタ（検索・詳細用） | ~2,500件 |
| `athlete_appearances` | ランキング出場情報 | ~8,750件 |
| `lc_performances` | LapCenter巡航速度・ミス率 | ~19,000件 |
| `cron_log` | Cronジョブ実行ログ（稼働監視） | - |
| `cron_notification_log` | Cronエラー通知のデダブ記録（24h以内同種エラーは1通まで） | - |
| `club_stats_snapshot` | クラブ統計月次スナップショット（前月比・前年比算出） | - |
| `ranking_snapshot` | ランキング月次スナップショット（順位・ポイント変動算出） | - |

## RLS (Row Level Security) ポリシー

全テーブルで RLS 有効。書き込みは全て `supabaseAdmin` (service_role key) 経由で RLS バイパス。

| テーブル | SELECT | INSERT | UPDATE/DELETE |
|---------|--------|--------|---------------|
| `athletes` | public (anon OK) | - (service_role のみ) | - (service_role のみ) |
| `athlete_appearances` | public (anon OK) | - (service_role のみ) | - (service_role のみ) |
| `lc_performances` | public (anon OK) | - (service_role のみ) | - (service_role のみ) |
| `likes` | public (anon OK) | authenticated のみ | - (service_role のみ) |
| `cron_log` | public (anon OK) | - (service_role のみ) | - (service_role のみ) |
| `cron_notification_log` | - (service_role のみ) | - (service_role のみ) | - (service_role のみ) |

マイグレーション: `supabase/migrations/20260311_fix_security_policies.sql`

## 注意事項

- **[機能停止] 地図DB(/maps)・GPS追跡(/tracking)・O-map登録(/upload) は 2026-06-08 に廃止**（ユーザー判断・将来再開の可能性あり）。ナビ・トップページ・about・メタ(layout/manifest)から関連文言を除去済み。コードは `src/app/_maps`・`_tracking`・`_upload` に退避（Next.js `_`プレフィックス＝ルーティング除外、ビルドには含まれ型チェックは通る）。依存(`lib/map-event-matcher`・`lib/tracking/*`・`lib/sample-data`・`components/AuthGuard`・`public/maps/*`)も温存。**復活手順**: 各フォルダ名から`_`を外し、`Header.tsx`(navItems+O-map登録ボタン)・`page.tsx`(ヒーロー/stats/features/最新の地図)・`about/page.tsx`・`layout.tsx`・`manifest.json` の文言・メタを git 履歴から戻す。
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
