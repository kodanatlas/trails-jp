# C-2 PoC: highs-js (WASM MILP) をブラウザ内 Web Worker で実行 — 結果記録

- 日付: 2026-06-12 12:08 JST
- 対象: trails_jp / Next.js 16.1.6 + React 19.2.3 + Turbopack
- ゲート: 配車割ツール Phase 1 の C-2（ブラウザ内 Worker で WASM MILP が解けるか）

## 結論

**Yes。** ブラウザ内 module Worker で highs-js が WASM をロードし、30人×8台の割当 MILP を解いて `Optimal` を返した。
headless Edge（puppeteer-core）で `#poc-result` に `Optimal` を確認、pageerror 0 件。

## 計測値（headless Edge, dev サーバ）

| 指標 | 値（2 回計測） |
|------|----------------|
| Status | Optimal |
| 目的関数値 | 69（決定論。2 回とも同値） |
| 割当 | 30 / 30 |
| WASM ロード | 331ms / 391ms |
| 求解 | 167ms / 159ms |
| ロード方式 | a: 動的 import("highs") |

## どの方式で動いたか

- **方式 a（worker 内 `const loader = (await import("highs")).default`）で成功。**
- highs 1.14.2 は UMD（`module.exports = Module` / `.default = Module`）。`Module` は Emscripten の async factory で、`loader({ locateFile }) => Promise<Highs>`、`Highs.solve(lpString, opts)` が `{ Status, ObjectiveValue, Columns, Rows }` を返す。
- 問題は **CPLEX LP 文字列**で渡す（行列 API ではない）。決定論生成（Math.random 不使用、剰余ハッシュでコスト/定員を固定）。

## ハマりどころと回避策（重要・Phase 3 への引き継ぎ）

1. **`locateFile` は絶対 URL を返すこと。**
   - 当初 `"/solver/" + f`（相対）にしたら、worker 内の Emscripten が XHR で wasm を取りに行く際に
     `Failed to execute 'open' on 'XMLHttpRequest': Invalid URL` で Abort。
   - 修正: `const origin = self.location.origin; locateFile = (f) => \`${origin}/solver/${f}\``。
2. **Turbopack の worker チャンクは HMR で再ビルドされないことがある。**
   - worker のソースを編集しても古いバンドルが配信され続け、修正が反映されない（エラーメッセージが変わらず誤診を招いた）。
   - 回避: dev サーバを再起動し `.next` を削除してクリアビルド。Phase 3 でも worker 修正後は要ハードリロード／再起動。
3. **方式 c（importScripts）は module worker では不可。**
   - `{ type: "module" }` の worker は `importScripts` が使えない（`Failed to execute 'importScripts'`）。classic worker 専用のフォールバックなので、module worker 構成では方式 a を主とする。

## 作成・コピーしたファイル（新規のみ）

- `public/solver/highs.wasm` … node_modules/highs/build からコピー（3,078,627 bytes, magic `\0asm`）
- `public/solver/highs.js` … 同上（フォールバック c 用に同梱。方式 a 成功のため実際には未使用）
- `src/app/carpool/poc/page.tsx` … Server Component、`robots: { index:false, follow:false }`
- `src/app/carpool/poc/PocClient.tsx` … `"use client"`、マウント時に Worker 自動起動、`#poc-result` に最終ステータス
- `src/app/carpool/poc/solver.worker.ts` … module worker、LP 生成＋求解、ms 計測
- `docs/plans/carpool_c2_highs_worker_poc_20260612.md` … 本記録

## 設定変更

- **next.config.ts / package.json / tsconfig は変更なし。** Worker+WASM のための追加設定は不要だった。
  （`new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" })` を Turbopack が標準サポート、
   wasm は public 配信＋絶対 URL `locateFile` で解決。）

## Phase 3（本実装の Worker 統合）への引き継ぎ

- `locateFile` は必ず `self.location.origin` 前置の絶対 URL。本番（Vercel）でも `/solver/highs.wasm` を public 配信し同様に解決可。
- 問題は CPLEX LP 文字列で組み立てる。既存の `src/lib/carpool/solver/`（model.ts / types.ts / validate.ts ＝ 既存 WIP）と LP 生成ロジックの責務分担を決める。
- バイナリ変数規模（30×8=240 var）でロード~0.3s/求解~0.16s。実運用規模が大きくなる場合は求解時間の再計測が必要。
- worker 編集時は Turbopack のチャンクキャッシュに注意（再起動 or `.next` 削除でクリア）。
- WASM 初回ロードはネットワーク＋コンパイルで体感がある。UI 側はローディング表示必須（本 PoC の進行表示パターンを踏襲可）。
- `public/solver/highs.js` は方式 a で不要。Phase 3 で方式 a 採用を確定するなら同梱不要（リポジトリ肥大回避）。

## 追記: code-reviewer 指摘の修正（2026-06-12）

- **[major] PocClient.tsx の `startedRef` ガードが StrictMode と非互換**: StrictMode (dev) の effect 二重実行は
  effect→cleanup→effect の順で走るため、1回目の cleanup で `worker.terminate()` 後、2回目がガードで早期 return
  すると Worker が再生成されず「Worker を起動中…」で固まり得る。
- **修正**: ガードを廃止し、effect 実行ごとに Worker を生成して cleanup で terminate する標準パターンに変更
  （dev では WASM を2回ロードするが許容。本番は二重実行なし）。
- **再検証**: `.next` 削除→クリーンビルド→headless Edge で `Optimal | obj=69 | 30/30 assigned` を2回確認
  （wasmLoad 360-422ms / solve 174-189ms、pageerror 0）。
