/// <reference lib="webworker" />
/**
 * 配車プラン用 求解ワーカー。
 *
 * メインスレッドから `SolveInput`（+ 任意の timeLimitSec）を postMessage で受け取り、
 * highs-js (WASM MILP) を Worker 内で起動して `solveCarpool` を実行し、
 * `SolveResult` を返す。
 *
 * highs のロード方式（動的 import → importScripts フォールバック）と
 * locateFile の組み立ては poc/solver.worker.ts と同一パターンに従う
 * （Worker 内の XHR は絶対 URL を要求するため origin を前置する）。
 */

import { solveCarpool } from "@/lib/carpool/solver/solve";
import type { SolveInput, SolveResult, HighsLike } from "@/lib/carpool/solver/types";

type HighsLoader = (settings: {
  locateFile: (file: string) => string;
}) => Promise<HighsLike>;

/** メイン → Worker のリクエスト。runId は世代管理用（古い実行の応答を捨てる）。 */
export interface PlanWorkerRequest {
  input: SolveInput;
  timeLimitSec?: number;
  runId: number;
}

/** Worker → メイン のメッセージ。runId はリクエストの値をそのまま返す。 */
export type PlanWorkerMessage =
  | { type: "progress"; phase: string; runId: number }
  | { type: "result"; result: SolveResult; solveMs: number; runId: number }
  /** message は常に日本語。detail は技術詳細（折りたたみ表示・console 用）。 */
  | { type: "error"; message: string; detail?: string; runId: number };

/**
 * highs ローダを取得する（poc と同じフォールバック順）。
 *   a. 動的 import("highs")
 *   c. importScripts("/solver/highs.js")（classic worker のみ。module worker では失敗想定）
 */
async function loadHighs(locateFile: (f: string) => string): Promise<HighsLike> {
  // --- 方式 a: 動的 import ---
  try {
    const mod = (await import("highs")) as unknown as { default?: HighsLoader };
    const loader = mod.default;
    if (typeof loader === "function") {
      return await loader({ locateFile });
    }
    throw new Error("dynamic import の default が function ではありません");
  } catch (errA) {
    const msgA = errA instanceof Error ? errA.message : String(errA);
    // --- 方式 c: classic worker での importScripts ---
    try {
      const scope = self as unknown as {
        importScripts?: (url: string) => void;
        Module?: HighsLoader;
      };
      if (typeof scope.importScripts === "function") {
        scope.importScripts(locateFile("highs.js"));
        const loader = scope.Module;
        if (typeof loader === "function") {
          return await loader({ locateFile });
        }
      }
      throw new Error("importScripts 経路が使えません");
    } catch (errC) {
      const msgC = errC instanceof Error ? errC.message : String(errC);
      throw new Error(`highs ローダ取得に失敗。a:${msgA} / c:${msgC}`);
    }
  }
}

function post(msg: PlanWorkerMessage): void {
  self.postMessage(msg);
}

/**
 * 03 §9「WASM は初回のみロード」: highs インスタンスを Worker 生存中キャッシュする。
 * Worker 自体もメイン側で使い回されるため、再最適化のたびの数MB再ロードを避けられる。
 * ロード失敗時は null に戻し、次回リクエストで再試行できるようにする。
 */
let highsPromise: Promise<HighsLike> | null = null;

function getHighs(locateFile: (f: string) => string): Promise<HighsLike> {
  if (!highsPromise) highsPromise = loadHighs(locateFile);
  return highsPromise;
}

self.onmessage = async (e: MessageEvent<PlanWorkerRequest>) => {
  const { input, timeLimitSec, runId } = e.data;

  // Worker 内の XHR は絶対 URL を要求するため origin を前置する
  // （相対 "/solver/..." だと Emscripten の XMLHttpRequest.open が Invalid URL で失敗）。
  const origin = self.location.origin;
  const locateFile = (f: string) => `${origin}/solver/${f}`;

  // M4: ロード失敗と実行例外を分けて捕捉し、ユーザー向けメッセージは常に日本語にする。
  // 技術詳細（英語スタック等）は detail に分離し、console にも出す。
  let highs: HighsLike;
  post({ type: "progress", phase: "WASM をロード中…", runId });
  try {
    highs = await getHighs(locateFile);
  } catch (err) {
    highsPromise = null; // 次回リクエストで再試行できるようにする
    console.error("[plan.worker] highs load failed:", err);
    post({
      type: "error",
      message:
        "最適化エンジン（WASM）の読み込みに失敗しました。通信環境を確認し、ページを再読み込みしてから再試行してください",
      detail: err instanceof Error ? err.message : String(err),
      runId,
    });
    return;
  }

  post({ type: "progress", phase: "求解中…", runId });
  try {
    const tStart = performance.now();
    // solveCarpool 内部の highs.solve 例外は SolveResult(status='error') として
    // 日本語 validationErrors で返る。ここで捕まえるのはそれ以外の予期しない例外。
    const result = solveCarpool(input, highs, { timeLimitSec });
    const solveMs = Math.round(performance.now() - tStart);
    post({ type: "result", result, solveMs, runId });
  } catch (err) {
    console.error("[plan.worker] solve failed:", err);
    post({
      type: "error",
      message: "最適化の実行中に予期しないエラーが発生しました。再試行してください",
      detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
      runId,
    });
  }
};
