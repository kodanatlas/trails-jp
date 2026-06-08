# 選手ページ「大会エントリー状況」カード 実装計画

- 作成日: 2026-06-08 (JST)
- 対象: trails.jp `/analysis` 選手詳細ページ
- 目的: 選手詳細の「大会参加状況」(`RecentEvents`) の **下に**、その選手が **これから出場予定（エントリー済）の大会一覧** を表示するカードを追加する。

---

## 1. 確定した方針（ユーザー決定 2026-06-08）

| 論点 | 決定 | 補足 |
|------|------|------|
| 集計方式 | **日次cronで事前集計** → 選手別インデックスをSupabase Storageに保存 | カード表示は薄いAPIを1回叩くだけ＝高速・前日鮮度 |
| 対象大会 | **開催前×エントリー済すべて**（`entry_status=open` ∪ `closed`かつ`date>=今日`） | 締切後でも未開催の確定エントリーを「次に出る大会」として表示 |
| 本人判定 | **他ページと同じ名寄せ**＝スペース除去後の氏名キー (`name.replace(/\s+/g,"")`) | 選手マスタは氏名でユニーク統合済み。所属は表示用に保持 |

### 重要な前提（調査で確定済み）
- エントリーリストは「イベントページのリスト」も「JOY」も、結局すべて **同一のJOYスクレイプ** (`scrapeEntryList(eventId)` → `/event/view/{id}/show_detail`) に帰着する。取得元は1つ。
- 既存に **選手別・クラブ別のエントリー集計は存在しない**（すべて per-event オンデマンド）。本機能で初めて per-athlete 集計を作る。
- 氏名照合の正準キーは `name.replace(/\s+/g,"")`（`utils.ts:34` / `build-analysis-index.ts:399` で全システム共通）。エントリー行 `name`(氏名) とランキング由来の選手名はどちらもJOY発なので、スペース除去で安定一致する。
- クラブ名寄せは `club-normalize.ts` の `normalizeClubName` / `splitAffiliations`（選手ビルドとエントリー解析で共有）。表示・補助照合に利用可。

---

## 2. アーキテクチャ全体図

```
[日次 cron: sync-entries]  04:00 JST (= 19:00 UTC, sync-events の1時間後)
   1. readEvents()                      ← Supabase Storage app-data/events.json
   2. 対象抽出: date>=today かつ entry_status∈{open,closed} かつ date<=today+120d
   3. buildEntryIndex(targets)          ← 各大会を scrapeEntryList で並列スクレイプ
        - 並列度6 / per-event 4s タイムアウト / 失敗はスキップ（部分許容）
        - 各 EntryRow を key=氏名(スペース除去) で集計
   4. writeEntryIndex(index)            → Supabase Storage app-data/entry-index.json
   5. logCron("sync-entries", ...)

[表示時]  /analysis (CSR)
   AthleteDetail useEffect
     └ fetch /api/athletes/[name]/entries   ← 薄いAPI: index 読込→当該選手の配列を返す（1h CDNキャッシュ）
          └ <UpcomingEntries entries=…/>    ← RecentEvents の直後に描画
```

- **per-view スクレイプは一切しない**（cronが1日1回まとめてスクレイプ済み）。
- 10秒関数制限は **専用cron** に full budget を割り当てて回避（並列度＋タイムアウト＋部分許容）。

---

## 3. データモデル

`src/lib/entries/index-types.ts`（新規。`entries.ts` の `EntryRow`/`EntryListResult` とは別レイヤ）

```ts
/** 選手1人の1エントリー（=ある大会への出場予定） */
export interface AthleteEntryRef {
  joe_event_id: number;
  eventName: string;
  date: string;            // YYYY-MM-DD
  prefecture: string;
  className: string;       // このエントリーのクラス (M21A 等)
  affiliation: string;     // エントリー時の所属（生文字列・表示用）
  entryStatus: "open" | "closed";  // 受付中 / 締切（未開催）
  joeUrl: string;          // JOY大会詳細URL
  totalEntries: number;    // その大会の総エントリー数（表示用・任意）
}

/** 氏名(スペース除去)キー → エントリー配列（date昇順） */
export interface EntryIndex {
  generatedAt: string;     // ISO
  targetEventCount: number;
  scrapedEventCount: number;  // 実際に取得成功した大会数（部分許容の可視化）
  athletes: Record<string, AthleteEntryRef[]>;
}
```

API レスポンス（`/api/athletes/[name]/entries`）:

```ts
{ name: string; entries: AthleteEntryRef[]; generatedAt: string | null }
```

---

## 4. 変更/新規ファイル一覧

### 新規
1. `src/lib/entries/index-types.ts` — `AthleteEntryRef` / `EntryIndex` 型定義。
2. `src/lib/entry-index-store.ts` — `readEntryIndex()` / `writeEntryIndex()`。`src/lib/events-store.ts` を雛形にSupabase Storage `app-data/entry-index.json` を読み書き。読み込みはモジュールスコープで簡易メモ化。
3. `src/lib/entries/build-index.ts` — `buildEntryIndex(targetEvents, opts): Promise<EntryIndex>`。`scrapeEntryList` を並列度制御で呼び、`EntryRow.name` をスペース除去キーで集計。`pLimit` 相当の簡易セマフォを内包（依存追加なし）。
4. `src/app/api/cron/sync-entries/route.ts` — 新cron。CRON_SECRET認証 → `readEvents` → 対象抽出 → `buildEntryIndex` → `writeEntryIndex` → `logCron`。
5. `src/app/api/athletes/[name]/entries/route.ts` — 薄いAPI。`readEntryIndex` → `index.athletes[キー] ?? []` を返す。`Cache-Control: s-maxage=3600`。
6. `src/app/analysis/UpcomingEntries.tsx` — カード本体（クライアント）。

### 変更
7. `vercel.json` — 3本目のcron追加: `{ "path": "/api/cron/sync-entries", "schedule": "0 19 * * *" }`（04:00 JST）。
   - ⚠️ **要確認（ユーザー手動アクション）**: 現プラン(Hobby)で3本目cronが許可されるか。不可なら `sync-events` 末尾に `buildEntryIndex` を統合する（10秒budget共有のリスクは §6 参照）。
8. `src/app/analysis/AthleteDetail.tsx`
   - `useEffect` の `Promise.all` に entries 取得を追加（`/api/athletes/${name}/entries`）。
   - 描画順の末尾、`<RecentEvents profile={profile} />`（L55）の **直後** に `<UpcomingEntries entries={entries} />` を追加。
   - `entries` state（`AthleteEntryRef[] | null`）を追加。
9. `src/lib/cron-status.ts` — `CronJobName` に `"sync-entries"` 追加、`JOB_CONFIG` にラベル/実行時刻(4時)追加。
10. `src/app/admin/cron-status/page.tsx`
    - `JOB_NAMES` に `"sync-entries"` 追加（L27）。
    - `summarizeResult` に `sync-entries` 分岐追加（`targets`/`scraped`/`athletes` 件数表示）。

---

## 5. 各ステップ詳細

### 5.1 cron `sync-entries`（route.ts）
- `sync-events`(route.ts) の認証・logCron パターンを踏襲。
- 対象抽出:
  ```ts
  const today = new Date().toISOString().slice(0,10);
  const horizon = /* today + 120日 */;
  const targets = events.filter(e =>
    e.date >= today && e.date <= horizon &&
    (e.entry_status === "open" || e.entry_status === "closed")
  );
  ```
- **安全キャップ**: `targets` が `MAX_SCRAPE`(=60) を超える場合は date昇順＋open優先で上位のみ処理し、`log` に残数を明示（**サイレント truncation 禁止**）。
- `buildEntryIndex(targets, { concurrency: 6, perEventTimeoutMs: 4000 })`。
- 失敗イベントはスキップして `scrapedEventCount` に反映。
- payload 例: `{ success, targets: N, scraped: M, athletes: K, generated_at }`。

### 5.2 buildEntryIndex
- 簡易セマフォで並列度6。各イベントは `scrapeEntryList(id)` を `Promise.race` で4sタイムアウト。
- 各 `EntryRow` について:
  ```ts
  const key = row.name.replace(/\s+/g, "");
  if (!key) continue;                       // 空名スキップ
  push(key, { joe_event_id, eventName: ev.name, date: ev.date,
              prefecture: ev.prefecture, className: row.className,
              affiliation: row.affiliation, entryStatus: ev.entry_status,
              joeUrl: ev.joe_url, totalEntries: result.total });
  ```
- 各選手配列を `date` 昇順ソート。
- リレー行（`name`=チーム名, 個人は `members`）は個人クラスと一致しないため自然に除外＝個人選手ページの趣旨に合致（§6 既知の制約）。

### 5.3 薄いAPI `/api/athletes/[name]/entries`
- `const key = decodeURIComponent(name).replace(/\s+/g,"");`
- `const index = await readEntryIndex();`（無ければ `null`）
- `return NextResponse.json({ name, entries: index?.athletes[key] ?? [], generatedAt: index?.generatedAt ?? null }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" }})`
- `/api/lc/[name]` / `/api/athletes/[name]` と同じ作法。

### 5.4 カード `UpcomingEntries.tsx`
- props: `{ entries: AthleteEntryRef[] | null }`
- `entries === null` → ローディング（小スピナー）。
- `entries.length === 0` → 空状態カード「現在エントリー予定の大会はありません」。
- それ以外 → リスト（date昇順）:
  - 左: 日付 + 「あと N 日」カウントダウン（過去になったものは除外済の想定だが念のため `date>=today` を再フィルタ）。
  - 中: 大会名（`joeUrl` へ外部リンク or 内部 `/events` 該当へスクロール）、`prefecture`、`className` バッジ、`affiliation`。
  - 右: `entryStatus` バッジ（受付中=green / 締切=muted）、`totalEntries` 人。
- スタイルは既存カード踏襲: `rounded-lg border border-border bg-card p-4`、ヘッダ `text-xs font-semibold uppercase tracking-wider text-muted`、行 `bg-surface rounded`、アイコンは `CalendarCheck`（lucide）。
- ヘッダ右に `generatedAt` を「N時間前更新」で小さく表示（鮮度の透明化、任意）。

### 5.5 AthleteDetail への組み込み
```tsx
const [entries, setEntries] = useState<AthleteEntryRef[] | null>(null);
// useEffect 内
const loadEntries = fetch(`/api/athletes/${encodeURIComponent(summary.name)}/entries`)
  .then(r => r.ok ? r.json() : null)
  .then(d => setEntries(d?.entries ?? []))
  .catch(() => setEntries([]));
Promise.all([loadProfile, loadLc, loadEntries]).then(() => setLoading(false));
// JSX: RecentEvents の直後
<UpcomingEntries entries={entries} />
```

---

## 6. エッジケース / 既知の制約

- **10秒制限（最重要）**: 対象~30〜45件。専用cronで full budget を確保し、並列度6＋4sタイムアウト＋部分許容＋上限60で吸収。`sync-events` への統合はbudget共有でリスク増のため次善。
- **Vercel cron本数**: 現状2本（sync-events / sync-lapcenter）。3本目が現プランで不可なら `sync-events` に統合（§4-7 のフォールバック）。→ **要ユーザー確認**。
- **初回デプロイ時**: index未生成 → APIは空配列 → カードは空状態で正常表示。cronを1回手動起動して初期生成 or 翌04:00 JST待ち（→ 手動タスク）。
- **同名別人**: 氏名キー統合は全システム共通の既存挙動。所属を表示して文脈補助（照合自体は氏名キーのまま＝ユーザー指示「他ページと同様」に準拠）。
- **リレー**: 個人選手ページの趣旨上、リレーのチーム名行は照合対象外（将来拡張で `members` 解析可）。
- **JOY負荷**: 並列度を抑え既存UA `trails.jp/1.0 (entry list)` を流用。失敗は握りつぶしてスキップ。
- **`entry_status` の意味**: `closed` は「申込締切」であって「開催済」ではない。`date>=today` 条件で未開催のみに限定するのが肝。

---

## 7. 検証手順

1. **ローカルビルド**（WSLのみ。Windows nodeは lightningcss native 不足で不可）: `npm run build`。
2. **cron手動起動**でindex生成:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://trailsjp.vercel.app/api/cron/sync-entries`
   → Supabase Storage `app-data/entry-index.json` 生成を確認、`scraped`/`athletes` 件数を確認。
3. **APIスポット確認**: 受付中大会に実在するエントリー者名で
   `/api/athletes/<氏名>/entries` が当該大会を返すか。
4. **画面確認**: `/analysis?athlete=<その氏名>` を開き、RecentEvents 直下にカード表示・日付・あとN日・受付中バッジを確認。エントリーの無い選手で空状態を確認。
5. **cron-status**: `/admin/cron-status` に `sync-entries` カードが出て成功ログが見えるか。
6. **デプロイ**: Vercel CLI（WSLビルド＋ユーザー作成PAT `--token`、cwd `/c/...`）。

---

## 8. ロールアウト順序（実装時）

1. 型・store・builder（4-1,2,3）→ ローカル単体で `buildEntryIndex` を1イベントに対し動作確認。
2. cron route（4-4）→ ローカル/プレビューで手動起動しindex生成確認。
3. 薄いAPI（4-5）→ レスポンス確認。
4. カード（4-6）＋ AthleteDetail 結線（4-8）。
5. cron監視（4-9,10）＋ vercel.json（4-7）。
6. デプロイ → 手動起動でseed → 画面確認。

---

## 9. ユーザー手動アクション（→ `_taskhub/TASKS.md` へ追記）

1. **[Vercel]** 現プラン(Hobby)で3本目cron `sync-entries` が許可されるか確認。不可なら「sync-events統合」フォールバックに切替指示。
2. **[Vercel/初回seed]** 初回デプロイ後、`sync-entries` を手動起動して entry-index を初期生成（または翌04:00 JST待ち）。
3. **[Deploy]** 本番デプロイ実行（Vercel CLI）と選手ページ目視確認。

---

## 9.5 実装完了メモ（2026-06-08）

計画どおり実装・型/Lint 検証済み（`tsc --noEmit` クリーン / 新規ファイル ESLint クリーン。`next build` は Vercel/WSL 側で実行＝当環境の Windows node は lightningcss native 不足）。

**実装ファイル（11）**: §4 のとおり。リレーは MVP で `members` 解析を省略（個人クラス行のみ照合）。大会リンクは JOY(`joeUrl`) へ外部リンク。表示密度は提案どおり（日付＋あとN日／クラス／所属／受付ステータス／総人数）。

**レビューと修正（計画からの差分）**:
- Codex 連携: Git Bash 側 codex は当アカウントのモデル階層エラーで `gpt-5.3-codex`/`gpt-5-codex`/`gpt-5` 全拒否 → **`-m gpt-5.5` で実行成功**（[[reference-wsl-windows-codex-dual-home]] の既知レシピ）。加えて Claude 多エージェントの敵対的レビューを併用。
- **[高] 10秒予算の是正**: 当初の逐次バッチ案では最悪40秒。**連続供給型並列プール＋全体ウォールクロック予算**に再設計し、予算 8秒→**6.5秒**に短縮（fetch後の同期 cheerio パースは abort 不可なため末尾＋write 用に余白確保）。
- **[高/Codex] 取得失敗の空データ上書き防止**: `scrapeEntryList` は非2xx で空を返す仕様 → cron が「成功裏に空」として良いインデックスを潰すリスク。`throwOnError` を追加し cron 経路は失敗を失敗として扱い scraped に数えない＋**全件失敗時は書き込みスキップ（既存インデックス保持）**。オンデマンドAPIの挙動は不変。
- **[高] React レース修正**: 選手切替時の stale 応答上書きを `cancelled` クリーンアップガードで防止（既存の profile/lc 経路も併せて是正）。
- **[高] リストキー**: 配列 index を除去し `joe_event_id+className`（dedup後は選手内で一意）。
- **[中] dedup 堅牢化**: 空 className/氏名の不正行を builder で除外。
- **[P1/Codex セキュリティ・本機能外]** `.claude/settings.local.json` に Supabase `sbp_` トークン平文（GitHub remote 有り）→ `.gitignore` に追加（誤コミット防止）。**トークンのローテーションは要ユーザー対応**（→ `_taskhub/TASKS.md`）。

## 9.6 ローンチ後の是正（2026-06-08・児玉健の未反映報告から）

- **根因**: 当初の対象抽出を `entry_status ∈ {open,closed}` に限定していたが、**未開催38大会のうち35が `none`**（アーカイブ由来は status が付かず none になる）。児玉健のエントリー先「第48回東大OLK大会(2264)／前日大会(2448)」も該当し索引対象から漏れていた。
- **修正1（対象拡大）**: `entry_status` での絞り込みを撤廃し、**未開催(date>=今日)かつ120日以内の全大会**を対象に（実エントリー有無はスクレイプ結果で判断）。`AthleteEntryRef.entryStatus` に `none` を追加しカードはバッジ非表示。targets ~60・athletes ~1500 規模でも予算内。
- **修正2（取りこぼし低減）**: 一斉スクレイプの transient 失敗（JOY 403/timeout）対策に**失敗イベントの1回即リトライ**を追加。seed で scraped 57/60 → 59/60 に改善。
- **検証**: 児玉健で 2448(L)・2264(M21A) の両方が正しく返却・カード表示を確認（cache-bust）。

## 10. 将来拡張（任意）

- リレー `members` 解析で個人をリレーエントリーにも紐付け。
- カードから内部 `/events` の該当大会エントリーリストへディープリンク。
- 「あとN日」が近い大会のハイライト / 通知。
- entry-index に前回比（新規エントリー/取消）を持たせ「動き」を可視化。
