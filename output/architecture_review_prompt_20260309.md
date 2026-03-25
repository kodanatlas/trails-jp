# アーキテクチャ方針クロスレビュー依頼

trails_jp プロジェクトの「静的JSONファイルによるデータ配信」の現状アーキテクチャに問題があり、改善方針を策定した。この方針が妥当か、見落としがないかレビューしてほしい。

## 前提の把握

以下のファイルを読んでプロジェクトの全体像を把握してください：

- `CLAUDE.md` — プロジェクト概要・技術スタック・データフロー
- `review_report.md` — コードレビュー報告書（パフォーマンス問題の詳細あり）
- `docs/analysis-system.md` — 分析システムの設計ドキュメント

## 現状のアーキテクチャと問題

### データの流れ（現状）

```
ビルド時:    スクリプト(scripts/build-analysis-index.ts) → 巨大 JSON → public/data/
Cron(水曜):  スクレイプ → Supabase Storage（増分更新）
クライアント: API(Supabase Storage) を試行 → 失敗/不足時 → 静的JSON(public/data/) にフォールバック
```

### 問題点

1. **データソースが2つ（Supabase Storage と静的JSON）あり、鮮度・件数が異なる**
   - 実際にバグが発生: API に1件だけある選手のLCカードが表示されない（静的には17件あるのにフォールバックしない）
   - フォールバック分岐が AthleteDetail.tsx / CompareAthletes.tsx 等の全箇所に必要

2. **クライアントに巨大JSONを丸ごと配信している**
   - `athlete-index.json`: 2.1MB（選手検索用、全2,400人分）
   - `lapcenter-runners.json`: 2.8MB（巡航速度・ミス率、全選手分）
   - `club-stats.json`: 578KB（全380クラブ）
   - `rankings/`: 77ファイル計9MB

3. **ビルド時間が8分超**（JOYランキング全量スクレイプ含む）

### 関連ファイル（現状の実装）

| ファイル | 役割 |
|---------|------|
| `scripts/build-analysis-index.ts` | ビルド時にランキングスクレイプ → JSON生成（597行） |
| `src/app/analysis/AnalysisHub.tsx` | クライアントで athlete-index.json + club-stats.json を全量fetch |
| `src/app/analysis/AthleteDetail.tsx:27-45` | API → 静的JSONフォールバックのLC取得ロジック |
| `src/app/analysis/CompareAthletes.tsx:239-266` | 同上（比較ページ版） |
| `src/lib/lapcenter-runners-store.ts` | Supabase Storage の読み書き |
| `src/app/api/lapcenter-runners/route.ts` | LC データ API（Supabase Storage から読む） |
| `src/lib/analysis/utils.ts` | loadAthleteDetail — ランキングJSONをクライアントでfetch |

### 制約

- **Vercel Hobby プラン**: Function 10秒制限、Cron 1日1回
- **Supabase Free プラン**: PostgreSQL + Storage + Auth
- **データ規模**: 選手 2,400人、クラブ 380、ランキング80クラス、LCデータ 2,289選手

## 提案する改善方針

### Phase 1: API 化（クライアントへの全量配信を廃止）

**目的**: クライアントが巨大JSONを直接fetchする構造をやめ、APIで必要なデータだけ返す

- `/api/lc/[name]` — 1選手分のLCデータだけ返す（数KB）
- `/api/athletes/search?q=xxx` — 検索結果を返す（全量インデックスをクライアントに送らない）
- `/api/clubs/[name]` — 1クラブ分だけ返す
- 静的JSONはビルド時キャッシュとしてサーバー側で保持するが、クライアントからの直接fetchを廃止
- データソースの二重管理を解消（API が唯一の窓口になる）

### Phase 2: Supabase DB 移行

**目的**: JSONファイルベースからRDBに移行し、クエリの柔軟性を得る

- `athletes`, `lc_performances`, `rankings`, `clubs` 等のテーブルに正規化
- Cron/ビルドスクリプトの書き込み先を DB に変更
- SQL で検索・フィルタ・ページネーション・集計
- 静的JSON完全廃止

### Phase 3: ISR（Incremental Static Regeneration）活用

**目的**: 選手詳細ページをサーバーで事前生成し、クライアントfetchをゼロにする

- `/analysis/[name]/page.tsx` に変更（動的ルート）
- `generateStaticParams` で上位選手を事前生成
- 残りは ISR でオンデマンド生成・キャッシュ
- revalidate 間隔でデータ鮮度を制御

## レビューしてほしい観点

1. **Phase 1 の妥当性**: API 化の方針は正しいか？Vercel Hobby の Function 10秒制限で、Supabase Storage から JSON を読んで1選手分を抽出して返す処理は現実的か？
2. **Phase の順序**: Phase 1 → 2 → 3 の順序は適切か？Phase 2（DB移行）を先にすべきか？
3. **Phase 1 での中間形態**: 静的JSONをサーバー側キャッシュとして残す設計は妥当か？それとも最初から DB に行くべきか？
4. **検索のアプローチ**: 2,400人の選手検索を API 化する場合、Supabase の全文検索（pg_trgm 等）で十分か？
5. **ISR の適用範囲**: Phase 3 で ISR を使う場合、Hobby プランの制約（ビルド時間、関数実行時間）で問題ないか？
6. **見落としているリスクや代替案**: 例えば Edge Functions、Vercel KV、クライアント側 IndexedDB キャッシュ等の選択肢は検討すべきか？
7. **移行コスト**: 各 Phase の工数感と、段階的にリリースできるか？

## 回答フォーマット

1. **方針の妥当性**: 全体方針について OK / 問題あり / 改善推奨
2. **各 Phase の評価**: Phase ごとに具体的なフィードバック
3. **推奨する順序・優先度**: 提案と異なる場合はその理由
4. **見落とし・代替案**: 検討すべき追加の選択肢
