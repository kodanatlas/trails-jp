# マイグレーション台帳の修復と baseline 作成

**ステータス: 完了（2026-08-24）**

## 背景

`supabase_migrations.schema_migrations` に登録されているのが `20260311_fix_security_policies`
の 1 件だけだった。調べると、問題は登録漏れではなく**マイグレーションが本番スキーマを
表現できていない**ことだった。2026-08-24 に Management API と supabase CLI で実測した事実:

1. ハイフン名 6 ファイル（`2026-06-17_` 形式）は CLI が
   `file name must match pattern "<timestamp>_name.sql"` で読み飛ばしていた。
   台帳以前に、新環境では適用対象にすらならない。
2. 数値名 9 ファイルは pending 扱い。ただし `db push` を打っても先頭の
   `20260325_create_cron_log.sql`（`CREATE TABLE cron_log`、`IF NOT EXISTS` なし）で
   即エラー中断する。静かに壊す種類ではなく、失敗して止まる。
3. 本番 public の 25 テーブルのうち **6 テーブルに作成マイグレーションが存在しなかった**
   （`athletes` / `athlete_appearances` / `lc_performances` / `likes` /
   `ranking_snapshot` / `db_health_samples`）。関数 `sample_db_health`、
   ビュー `athlete_like_counts` も同様。
4. `20260612_` が 3 本、`2026-07-08_` が 2 本あり、`schema_migrations.version` は
   一意なので、そのままでは台帳に登録できなかった。
5. `20260612_` は辞書順で `carpool_fixes`(ALTER) が `carpool_tables`(CREATE) より
   先に来ており、replay すると存在しないテーブルへの ALTER で落ちる状態だった。

したがって台帳だけ直しても再現性は戻らず、「全件 applied ＝ migrations は完全」という
誤った安心を作ってしまう。そこで台帳修正と baseline 作成を同時に行った。

## やったこと

### 1. baseline を起こした

- `supabase/migrations/20260301_baseline_schema.sql`（新規）
  - 本番カタログ（`pg_get_constraintdef` / `pg_get_indexdef` / `pg_get_functiondef` /
    `pg_get_viewdef`）から機械抽出した DDL が唯一の事実源。Docker が無く
    `supabase db dump` が使えないための代替手段。
  - 収録: テーブル 6 / 索引 6 / RLS 有効化 5 / ポリシー 5 / 関数 1 / ビュー 1
  - 移植のため `nextval(...)` を `serial` へ、`ranking_snapshot.id` を
    `bigint generated always as identity` へ変換（本番の `attidentity='ALWAYS'` に対応）
  - 他ファイルが作る 3 つは意図的に除外（`likes_session_athlete_week_idx` →
    `20260610`、`db_health_samples` の RLS → `20260823`、
    `"Authenticated users can insert likes"` → `20260311`）
- `supabase/migrations/20260302_cron_jobs.sql`（新規）
  - pg_cron ジョブ `db-health-sample`（`*/5 * * * *`）。未導入環境で `db reset` が
    壊れないよう拡張の存在を確認してから登録する。
- `supabase/migrations/20260824000100_lc_leg_splits_runner_key_date_class_idx.sql`（新規）
  - カバレッジ突合で見つかった、**本番にあるのにどのマイグレーションでも作られていない索引**。
    `get_lc_perf_with_rank` の検索条件 3 列と一致するため、2026-07-08 前後に手で
    追加されたものと推測される。

### 2. ファイル名を正規化した（`git mv`、中身は無変更）

ハイフン名 6 件を数値形式へ。加えてバージョン重複と適用順の壊れを解消:

- `20260612_{tables,fixes,undecided}` → `20260612000100/000200/000300`（CREATE → ALTER の順）
- `2026-07-08_{lc_perf_with_rank_rpc,ranking_snapshot_weekly}` → `20260708000100/000200`

`20260311_fix_security_policies.sql` はリネームしていない。唯一台帳に登録済みで、
名前を変えると台帳の行が孤児になるため。

### 3. 台帳へ登録した

`supabase migration repair --status applied` で 18 バージョン（`20260311` は登録済み）。

## 検証結果

| 受入条件 | 結果 |
|---|---|
| `migration list --linked` の Local/Remote 一致・skip 0 | 19 行すべて一致、Skipping 0 |
| 本番スキーマが不変 | テーブル 25 / 索引 73 / ポリシー 9 / 関数 4 / ビュー 1 / トリガー 12 / RLS 25（作業前と同一） |
| カバレッジ突合（全オブジェクトがちょうど 1 つのマイグレーションで作られる） | 実質 0 件の穴。検出された MISSING 3 件は inline UNIQUE 制約が自動生成した索引、MULTI 6 件は名前の重複とコメント誤検出で、いずれも偽陽性と個別に確認 |
| `npx vitest run` | 68 files / 852 tests green |
| リネーム 9 件の中身が無変更 | HEAD と byte 一致を確認 |

二次レビュー（Codex read-only）の指摘 3 件のうち 2 件を採用:

- replay の前提（Supabase 提供のロールと `extensions` スキーマが必要）を baseline に明記
- cron ジョブの所有者は実行ロールになる／競合キーが `(jobname, username)` で別ロール実行時に
  二重登録される点を明記し、`cron.alter_job` で `active` を明示的に有効化
- 見送り: 関数・ビュー本体のスキーマ修飾。`pg_get_functiondef` / `pg_get_viewdef` の出力
  そのままであり、修飾すると新環境の定義文が本番と食い違うため、忠実さを優先した

## 残る限界

**このマシンには Docker が無いため、実リプレイ検証をしていない**（`supabase db reset` /
`db diff` は shadow DB を要する）。baseline の正しさは上記のカバレッジ突合という
構造検証止まりで、「実際に新環境で再現できる」ことの確証ではない。
確証が要る場合は、使い捨ての Supabase プロジェクトを 1 つ作って `db push` を通すこと。
