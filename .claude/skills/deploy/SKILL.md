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
cd ~/projects/trails_jp
op run --env-file=<(echo 'SUPABASE_ACCESS_TOKEN=op://Agent-MacMini/supabase-trails/credential') -- npx supabase db push
```

トークンは 1Password のスコープ付き PAT（trails-jp・Database read-write のみ。2026-11-02〜）。`db push` がこの権限で 403 になる場合は、マイグレーション SQL を `~/bin/sbq < migration.sql` で流す（未検証）。

マイグレーションファイルは `supabase/migrations/` に配置。

## 確認

- 本番URL: https://trailsjp.vercel.app
- Vercel Dashboard でビルドログを確認
- Supabase Dashboard > Security Advisor でDB脆弱性チェック
