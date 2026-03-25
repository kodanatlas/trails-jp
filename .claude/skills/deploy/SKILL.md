---
description: trails.jp をVercelにデプロイする
---

# デプロイ手順

## 本番デプロイ

Vercel Git Integration が不安定なため、手動デプロイを使用:

```bash
cd /mnt/c/Users/user/Downloads/trails_jp
npx vercel --prod
```

## 自動デプロイ

- 水曜 03:00 JST に Cron が Vercel Deployments API で自動再デプロイ
- ビルド時に JOY ランキングを最新取得

## DBマイグレーション適用

```bash
cd /mnt/c/Users/user/Downloads/trails_jp
export SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2)
npx supabase db push
```

マイグレーションファイルは `supabase/migrations/` に配置。

## 確認

- 本番URL: https://trailsjp.vercel.app
- Vercel Dashboard でビルドログを確認
- Supabase Dashboard > Security Advisor でDB脆弱性チェック
