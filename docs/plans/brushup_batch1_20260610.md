# ブラッシュアップ Batch 1 実装計画（批判レビュー反映版）

作成: 2026-06-10 22:20 JST / 改訂: 2026-06-10 23:00 JST（3視点批判レビュー反映、全レンズ approve-with-fixes）
状態: レビュー反映済み → 実装 → ユーザー確認 → デプロイ
※ Codex 壁打ちは CLI がモデルエラー（ChatGPT アカウントで全モデル 400）のため今回未実施。再ログイン後に掛け直し可。

## 0. スコープ

| ID | 施策 | 種別 |
|----|------|------|
| S1 | スナップショット基盤の修繕＋全クラス拡張 | 基盤（仕込み） |
| S2 | movers.json ビルド時生成＋トップページ「今月の急上昇」 | データ分析 |
| S3 | Head-to-Head 対戦成績（選手詳細） | データ分析 |
| S4 | オリエンタイプ・シェアカード（/a/[name] + OG画像） | バイラル装置 |
| S5 | トップページ「今週の応援」表彰台 | エンゲージメント |
| S6 | loading.tsx 横展開（cron-status のみ） | UX quick win |

次バッチ送り: 4象限マップ・フィールド強度指数・クラブページ・ヒートマップ・週末プレビュー・LC スループット修正・スナップショットの name+club キー化。

## 1. 確定済みの前提事実（調査＋レビューで裏取り済み）

- スナップショットは既に月次書き込み中（build-analysis-index.ts L630-780 が PostgREST 生 fetch）。UNIQUE は ranking_snapshot(month, file_key) / club_stats_snapshot(month) — 実DB確認済み。
- 既存 POST は on_conflict 未指定 → 同月2回目以降 409 無音失敗（res.ok 未チェック）。「月初ビルドの値が凍結」が現挙動。
- delta は無差別系4ファイル限定（DELTA_FILES）。yoy 全 null。**スナップショットのキーは生 athlete_name の後勝ち上書き → 同姓同名で捏造 delta が発生**（実例: S_無差別の鈴木健太2人 → 筑波側に mom +959 が捏造されたのを実証）。
- **同一選手×同一大会の points はクラスファイル間で完全一致**（無差別 vs M21 で差分0件を実証）= 無差別は全実走クラスの換算点寄せ集め。M21 全1268人・女子無差別全396人が無差別に包含。
- **同点 points は普通にある**（無差別41大会中39大会で発生、全スコアの26%が同点絡み）。
- active 選手の76%が mom>0 を持ち、深い順位帯ほど mom は機械的に巨大化（12ヶ月窓の母集団変動による受動上昇）。
- /analysis は静的1ページ＋`?athlete=<空白除去名>` 完全一致深リンク（AnalysisHub.tsx L58、正規化なし）。**movers の name と likes の athlete_name は形式が違う**（生名 vs 空白除去名）。
- AnalysisHub は pushState/popstate の state オブジェクト（e.state.tab）に依存する履歴状態機械を持つ（L71-97, L261-288）。
- 動的ルートの params は **decodeURIComponent 必須**（既存3 API ルート全てがそうしている）。
- リポジトリに日本語フォント資産ゼロ。next/og（next 16.1.6 同梱）は Node ランタイム可。
- /api/likes/top は累計・like_count 降順のみ・二次ソートなし。**現在首位は4人同率（15）**。いいね重複ガードは週次リセット（JST月曜、2026-06-10 migration）。
- /events/[id] へのサイト内リンクは存在しない（全て joe_url へ外部リンク）→ loading.tsx の価値ほぼゼロ。
- ranking-configs は80クラス定義・実ファイル77（W80/W85/W90 が空クラス）。
- build-analysis-index.ts は env の有無に関わらず JOY フル再取得を実行し、ローカル実行は rankings JSON を delta なしで上書きする（→ SKIP_FETCH フラグ新設で対処）。
- RankDelta の実装色は text-green-400 / text-red-400（text-accent ではない）。

## 2. 設計（レビュー反映済み）

### S1: スナップショット修繕＋全クラス拡張（scripts/build-analysis-index.ts）

1. **upsert 修正**: ranking_snapshot POST に `?on_conflict=month,file_key`、club_stats_snapshot POST に `?on_conflict=month`（`Prefer: resolution=merge-duplicates` 維持）。**res.ok チェック＋失敗時 console.warn（status と件数を出す）**。ビルドは落とさない。同月内は最新ビルドで上書き（mom = 前月最終ビルド比になる）。
2. **全クラス拡張**: DELTA_FILES 撤廃、存在する全ファイル（現77）を対象に delta 付与＋スナップショット書き込み。
   - 前月/前年の読みは `GET /ranking_snapshot?month=eq.<YYYY-MM>&select=file_key,stats` を月ごとに1リクエスト。取得件数を console.warn/log に出す（無言全滅の防止）。
   - 書き込みは 20行ずつの分割バルク POST。
   - **同姓同名ガード**: クラスファイル内に同一 athlete_name が2件以上ある名前は (a) スナップショット書き込み (b) delta 付与 の両方からスキップ（捏造 delta の根絶。既存 RankingView の偽 ↑↓ も同時に直る）。name+club キー化は過去スナップショットとの互換が切れるので次バッチ。
3. **SKIP_FETCH=1 環境変数**: JOY 再取得を飛ばし、ローカル既存 JSON で index/movers/snapshot 経路だけ実行できるドライランフラグ（検証用）。
4. club 側は res.ok チェックのみ追加。

### S2: movers.json＋トップページ「今月の急上昇」

1. **抽出契約（A/B 固定）**: delta 付与後の全クラスから
   - `points_delta.mom > 0`（受動上昇の除外）AND `rank <= 200` AND is_active AND 同姓同名でない
   - 選手単位 dedupe（最良 mom を採用）、mom 降順 top 10
   - **結果が3件未満なら既存 movers.json を温存**（月初の正味空対策。env なし・fetch 失敗時も温存）
2. **スキーマ（A/B 契約・固定）**:
   ```json
   { "generatedAtJst": "YYYY-MM-DD HH:mm JST",
     "items": [ { "name": "小山 温史", "key": "小山温史", "club": "トータス",
                  "type": "age_forest", "className": "無差別",
                  "rank": 172, "mom": 1241, "pointsMom": 2797.1 } ] }
   ```
   - `name` = 表示用生名（スペース保持）、`key` = 空白除去名（`/analysis?athlete=` リンク用）。リンク生成は必ず `encodeURIComponent(key)`。
3. トップページ: 静的 import セクション「今月の急上昇」（Features の後）。上位5件、↑n は text-green-400（RankDelta と同実装色）、クラブ・現順位・クラス併記。items < 3 ならセクション非表示。
4. 初期ファイル: 本番 JSON から**新契約（pointsMom>0・rank≤200・同名除外）で再生成**してコミット（現コミット版は鈴木健太の捏造値を含むため破棄）。

### S3: Head-to-Head 対戦成績

1. **共通化**: stripEventNoise / eventFuzzyMatch を `src/lib/analysis/event-match.ts` へ抽出、AthleteDetail / CompareAthletes は import に差し替え。
2. **新コンポーネント** `src/app/analysis/HeadToHead.tsx`（AthleteDetail の RecentEvents と UpcomingEntries の間）:
   - **突合契約**: 両者の共通 (type, className) appearance のスコアを大会単位で突合した後、**date＋stripEventNoise 正規化名で大会単位に重複排除**（無差別系と個別クラスで同一レースが2〜3重に出るため。points はクラス間同値なので勝敗は不変）。
   - **勝敗定義**: points 大小。**同点 = 引き分け**。表示は「X勝Y敗Z分」。
   - **注記**: 「JOY ランキング換算点での比較（同一大会でも別クラス出走の場合があります）」。
   - **デフォルト候補**: 検索ボックスに加え、同クラブのランキング選手＋無差別クラスの近順位（±5）から候補チップを出す（athleteIndex だけで計算可）。
   - **空状態**: 「共通のランキング掲載大会がありません」＋再戦予定のみでも表示。
   - **再戦予定**: `/api/athletes/<name>/entries` ×2 → JST（Asia/Tokyo 明示）今日以降 → joe_event_id 交差（同一 id 複数行ありうるので配列前提で dedupe）。className 一致（配列同士の交差）なら「同クラスで再戦」、不一致は「同大会出場予定」。
   - 対戦履歴リスト: 日付・大会名（parseEventName 正規化表示）・両者 points・勝者ハイライト。
3. AnalysisHub → AthleteDetail に athleteIndex を props 追加。

### S4: シェアカード（/a/[name]）

1. `src/lib/site.ts`: `export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://trailsjp.vercel.app"`。layout.tsx に `metadataBase: new URL(SITE_URL)`（preview デプロイの OG URL が本番を指す点は認識済みで許容）。
2. `src/app/a/[name]/page.tsx`（サーバー、**dynamic 設定なし＝デフォルト動的**。force-static は使わない）:
   - `const { name } = await params; const key = decodeURIComponent(name).replace(/\s+/g, "")` — **decode 必須（既存 API ルートと同パターン）**。generateMetadata / opengraph-image でも同様に decode。
   - データ: `public/data/athlete-index.json` を import（UI と同一ソース）。不在キーは notFound()。
   - generateMetadata: title「<名前>のオリエンタイプ | trails.jp」、description、openGraph + twitter summary_large_image。
   - 本文: カード同等情報（名前・タイプ・ベスト順位・最近の調子・F/S出走数）＋「分析ページで詳しく見る」CTA ボタン（`/analysis?athlete=<key>`）。**自動リダイレクトはしない**（遷移先が 1.8MB ロードで体験が悪い・戻るボタン破壊リスク）。
3. `src/app/a/[name]/opengraph-image.tsx`: ImageResponse（1200×630、サイト配色 #0f1720 / #f97316 / #00e5ff）。**params は Promise — await＋decode**。内容: 選手名・クラブ・タイプ日本語ラベル・ベスト順位・最近の調子%・F/S 出走数バー・trails.jp ブランド。
4. **日本語フォント**: `assets/fonts/NotoSansJP-subset.otf`（**ブラケットなしパス**）に同梱し `fs.readFile(path.join(process.cwd(), "assets/fonts/…"))`（Next 公式パターン、nft トレース可）。保険で next.config.ts に outputFileTracingIncludes（キー '/a/[name]/opengraph-image'、glob のブラケットはエスケープ）。module スコープで一度だけロード。
   - サブセット = athlete-index 全選手名・クラブ文字 ∪ かな・ASCII・記号 ∪ UI ラベル文字 ∪ JIS第一水準。pyftsubset（WSL python3、なければ pip install --user fonttools）。元フォントは noto-cjk の NotoSansJP-Bold.otf。
5. **シェア導線**（実体は AthleteDetail.tsx の ProfileHeader）: X intent＋navigator.share＋URL コピー。URL は `${SITE_URL}/a/${encodeURIComponent(key)}`。
6. **URL 同期**: 選手選択時 `history.replaceState(history.state, "", url)`（**既存 state を必ず保持** — AnalysisHub の popstate 状態機械を壊さない）。選手解除・タブ切替時は ?athlete を除去。クラブ→選手→戻るの回帰確認を必須チェックに。

### S5: 「今週の応援」表彰台（トップページ）

1. **API 拡張**（src/app/api/likes/top/route.ts）: `?window=week` で likes テーブルから JST 月曜起点の今週分を取得し JS で集計（行数は小さい）。window なしは従来の累計（後方互換）。二次ソート: like_count desc, athlete_name asc（安定化）。
2. **UI**: クライアントコンポーネント（トップページ「近日開催」の後）。今週分を表示、**同率は同順位でグルーピング**（タイで limit を切らない。表示人数上限6、超過は「+N人」）。今週 0 件なら累計にフォールバックしラベルを「累計」に切替。それも 0 なら非表示。名前は athlete-index 形式（空白除去）のまま表示（既存 UI と同じ）、リンクは `/analysis?athlete=`。ハートは bg-pink-500/15 text-pink-400。応援タブ（/analysis 応援タブ）への導線を添える。

### S6: loading.tsx

- `src/app/admin/cron-status/loading.tsx` のみ（events/[id] はサイト内リンク不在＋サーバー redirect 先行のため見送り）。

## 3. ファイル所有権（実装エージェント分割）

| Agent | 担当 | 触るファイル |
|-------|------|--------------|
| A | S1+S2ビルド側 | scripts/build-analysis-index.ts、src/data/movers.json（新契約で再生成） |
| B | S2表示+S5 | src/app/page.tsx、トップ用新コンポーネント、src/app/api/likes/top/route.ts |
| C | S3+S4導線+URL同期 | src/app/analysis/*、src/lib/analysis/event-match.ts（新規） |
| D | S4サーバー側 | src/app/a/[name]/*（新規）、src/app/layout.tsx（metadataBase）、next.config.ts、assets/fonts/* |
| 先行 | 共有定数 | src/lib/site.ts（オーケストレータが事前作成、C/D は import のみ） |
| 直営 | S6 | src/app/admin/cron-status/loading.tsx |

## 4. 検証計画

1. WSL `npx next build`（フル build-analysis-index は回さない）。
2. `SKIP_FETCH=1 npx tsx scripts/build-analysis-index.ts` で movers/snapshot 経路のドライラン（env なし → スキップ＋温存ログを確認。rankings JSON は上書きされない）。
3. WSL dev サーバーでユーザー確認: トップ（急上昇＋表彰台）、/analysis（H2H・シェアボタン・クラブ→選手→戻る回帰）、/a/<選手名>（+ /a/<name>/opengraph-image 直アクセス）、/admin/cron-status 遷移。
4. コードレビュー: Claude find→adversarial verify ワークフロー（複雑3箇所: S1 upsert・S4 OG/フォント・S3 突合は重点）。
5. **本番昇格前に preview デプロイ**で (a) /a/<日本語名> 直アクセス (b) 不在選手404 (c) opengraph-image 描画（フォント同梱確認）を実機確認 → ユーザー承認 → 本番。
6. デプロイ後: 次回水曜ビルドで「当月 month の行数 = 存在ファイル数」を DB 照合（created_at は更新されないので件数と stats 中身で見る）。

## 5. 既知のリスクと判断（更新）

- S1 上書き運用変更（月初凍結→月内上書き）: mom がより正確になる。許容。
- S3 fuzzy match の同日複数大会誤マッチ: 既存機能と同等リスク。注記で吸収。
- S3 同姓同名選手の H2H: loadAthleteDetail が先勝ちで拾う既存制限。候補チップからは除外し、根本対応は次バッチ。
- S4 フォントカバレッジ: JIS第一水準＋実データ全文字。第二水準のみの新選手は豆腐化リスク（許容）。
- S5 いたずら耐性: 既存 API の週次ガードのまま。今回スコープ外。
- /a/[name] 鮮度: athlete-index はビルド時固定（週次更新）。UI と同一ソースなので矛盾なし。
