# Phase 0: 検証レイヤーの自動化（cron + CI）

- 日付: 2026-06-26 (JST)
- ステータス: 実装中
- 関連: Loop Engineering（Addy Osmani / Anthropic）の最初の一手。Codex(gpt-5.5) 壁打ち済み。

## 背景・結論

「agentic loop を作る前に、検証(gate)を cron で固める」。Codex 壁打ちと自己分析が収束した結論:

- **trails.jp に agentic loop は今はまだ要らない**（4条件テストを正直に当てると、検証の自動化が穴だらけで土台が無い）。
- 過去の実害に直結する data-dependent チェックが**手動・無スケジュール**＝唯一の本物の穴。
- まず「検証の半分」を安く確実に自動化し、**ループへの昇格は後述の条件が揃ってから**。

### 検証資産の実状（裏取り済み）

| 資産 | 種別 | 判定 |
|---|---|---|
| `scripts/geocode-smoke.ts` | 実GSIに対し haversine≤2km を assert、外れたら `exit 1` | ✅ **本物のオラクル**（lat/lngスワップ・同名近接・GSIベンダ変化を検知） |
| `scripts/weekend-standouts-smoke.ts` | 行を `console.log` するだけ・0行で成功・assert ゼロ | ❌ **目視スクリプト（ゲートではない）**。指標の向きバグを検知不能。Supabase Management API（広権限） |
| `npm test`（vitest 46ファイル/約463件） | 純ロジック・ネットワーク不要 | ✅ ゲートだが **CI で回っていない** |
| GitHub Actions | `entry-index-backstop.yml`（cron 20:30 UTC）のみ | テストは未実行 |

## Phase 0 スコープ（このプラン）

1. **`npm test` を CI に載せる** … `.github/workflows/test.yml`。PR/main push/手動で vitest を実行。生成PRを信頼する前の table stakes。
2. **`geocode-smoke` を定期＋関連PRで実行** … `.github/workflows/geocode-smoke.yml`。日次スケジュール（GSIベンダ変化監視）＋geocode関連ファイルの PR/push（回帰検知）＋手動。失敗で job 落ち（既定通知）＋ログを artifact 保存。

**スコープ外（意図的に触らない）**:
- `weekend-standouts-smoke.ts` のゲート化（目視→assert化＋権限縮小）は別タスク（Phase 0.5 候補）。今回は手動のまま明示。
- `next build`（型チェック）の CI 化＝JOY ランキング fetch を伴い重い。Vercel ビルド時の型チェックに委ねる。
- lint の CI 化（任意。低コストだが今回スコープ外）。

## 実装方針（既存 `entry-index-backstop.yml` の作法に準拠）

- `runs-on: ubuntu-latest` / Node 20（`@types/node: ^20`）/ `npm ci` / `actions/setup-node@v4` cache=npm。
- `concurrency` で重複実行を抑制。`workflow_dispatch` で手動可。
- geocode-smoke は `set -o pipefail` を明示（`| tee` でスモークの非ゼロ終了をマスクしない）。

### スケジュール衝突回避（既存 cron）

| ジョブ | UTC | JST |
|---|---|---|
| Vercel sync-lapcenter | 03:00 | 12:00 |
| Vercel sync-events | 18:00 | 03:00 |
| Vercel sync-entries | 19:00 | 04:00 |
| GH entry-index-backstop | 20:30 | 05:30 |
| **GH geocode-smoke（新規）** | **22:00** | **07:00** |

geocode-smoke はデータ同期と独立（コード/ベンダ正しさの監視）なので時刻は任意。既存枠と被らない 22:00 UTC に置く。

## リスクと対策

- **GSI が GitHub Actions の海外ランナーIPを地理ブロック/レート制限 → 偽の失敗**。初回数日は要観察。多発時は (a) スモークにリトライ追加 (b) 日次→週次に緩和、で対応。スクリプトは既に呼出間 300ms 空けている。
- **`npm test` が現状 red だと CI が即赤**。記憶上は直近で 463 green。初回 run（または手動 dispatch）で確認する。
- **偽の完了（Ralph Wiggum）**: geocode-smoke は硬いオラクルなので可。weekend はゲートでないので**今回スケジュールしない**（弱いゲートを「緑」と誤認しないため）。
- **無人ループのセキュリティ**: 本 Phase 0 はどちらも **secret 不要**（geocode=公開API、test=ローカルのみ）。本番書込/auto-merge/deploy 権限なし。

## ユーザー手動アクション

- [ ] 作成された2ワークフローの diff を確認 → **trails.jp リポジトリへ commit/push**（私は本番リポジトリに勝手に push しない）。
  - 確認事項: **GitHub への push が Vercel デプロイを誘発するか**（trails.jp は CLI/Deploy Hook 運用＝Git非連携なら push は安全。Git連携なら no-op 相当の再ビルドが走る）。
- [ ] push 後、Actions 画面で `test` と `geocode-smoke` を一度 **Run workflow（手動 dispatch）** して緑を確認。
- [ ] 失敗通知の受け取り先（GitHub 既定はリポジトリ owner へメール）を確認。必要なら失敗時 Issue 自動起票を追加（任意）。

## ループへの昇格条件（Phase 1 の発火点）

scheduled gate が**実際に再発失敗を出し**、次がすべて満たされたら agentic loop（maker→checker→worktree→draft PR）に昇格:

- 失敗がスケジュール実行の外で再現できる
- ゲートが硬いオラクルを持つ（ログでなく合否）
- エージェントが原因を局在化して branch/PR を起草できる
- **独立した checker** が（未変更ゲート or 第2オラクルに対して）走る
- マージ/デプロイ前に人間レビュー

それまでは cron で十分・安く・確実。
