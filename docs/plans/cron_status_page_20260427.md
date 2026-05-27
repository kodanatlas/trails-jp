# /admin/cron-status ステータスページ 実装計画

**作成日**: 2026-04-27 JST
**目的**: trails.jp の Vercel Cron ジョブ稼働状況を可視化する公開ステータスページの新設

---

## 1. 要件サマリ

- パス: `/admin/cron-status`
- 公開（認証なし）。`metadata.robots = noindex` で検索除外
- データソース: `cron_log` テーブル（既存、public_read RLS）
- 表示: ジョブ別カード + 履歴テーブル + KPI時系列（SVGスパークライン）
- 健康判定: 緑（24h以内success）/ 黄（24-48h）/ 赤（48h超 or 直近error）
- 水曜限定処理（deploy / runners）も判定対象
- 更新方式: SSR（F5で再取得）
- Resend通知: `logCron()` で error 時に1日1通までデダブ送信

## 2. Q&A 確定仕様

| 項目 | 決定 |
|---|---|
| Q1 アクセス制御 | (a) 完全public、認証なし |
| Q2 表示粒度 | Lv3 = カード + 履歴 + KPI時系列 |
| Q3 健康判定 | 3段階（緑/黄/赤） |
| Q3-おまけ 水曜限定 | (c) deploy/runnersも判定対象 |
| Q4 自動更新 | (a) F5（SSR） |
| Q5 配置 | (a) 単発ページ、ヘッダーリンクなし |
| Q6 データ取得 | (a) サーバーコンポーネント + anon key |
| Q7-1 通知手段 | (a) Resend |
| Q7-2 通知トリガー | (a) Type1のみ（logCron内error時） |

## 3. ファイル一覧

### 新規
- `src/app/admin/cron-status/page.tsx`
- `src/lib/cron-status.ts`
- `src/lib/cron-notifier.ts`
- `supabase/migrations/20260427_cron_log_indexes.sql`
- `docs/changelog/2026-04-27.md`

### 編集
- `src/lib/cron-logger.ts`
- `CLAUDE.md`

## 4. フェーズ

1. **Phase 1**: マイグレーション + 健康判定純粋関数
2. **Phase 2**: ステータスページ（SSR）
3. **Phase 3**: Resend通知 + デダブ + cron-logger 編集
4. **Phase 4**: SVGスパークライン
5. **Phase 5**: CLAUDE.md / changelog / ローカル確認

## 5. 環境変数

| 変数名 | 用途 |
|---|---|
| `RESEND_API_KEY` | Resend API認証 |
| `NOTIFICATION_TO_EMAIL` | 通知送信先 |
| `NOTIFICATION_FROM_EMAIL` | 任意。未設定なら `onboarding@resend.dev` |

## 6. DB変更

```sql
-- 履歴クエリ高速化
CREATE INDEX IF NOT EXISTS cron_log_job_created_idx
  ON cron_log (job_name, created_at DESC);

-- 通知デダブ用テーブル
CREATE TABLE cron_notification_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name text NOT NULL,
  error_signature text NOT NULL,
  sent_at timestamptz DEFAULT now()
);
CREATE INDEX cron_notification_log_lookup_idx
  ON cron_notification_log (job_name, error_signature, sent_at DESC);
ALTER TABLE cron_notification_log ENABLE ROW LEVEL SECURITY;
-- ポリシー無し = anon 全拒否、service_role バイパス
```

## 7. リスク

- Vercel Function SIGKILL の通知レース → `await logCron(...)` で待つ
- Resend無料枠: 100通/日、3000通/月（デダブで通常1障害1通）
- `result` JSON 漏洩注意: `runners.error` などにスタックトレース混入確認
- cron_log 肥大化: 当面放置（年730件）

## 8. 見積もり

合計 約4-4.5時間
