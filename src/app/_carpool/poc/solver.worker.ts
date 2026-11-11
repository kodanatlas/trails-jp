/// <reference lib="webworker" />
/**
 * C-2 PoC: highs-js (WASM MILP) を Web Worker 内で実行する検証用ワーカー。
 *
 * 30人 × 8台 の配車割当 MILP を CPLEX LP 形式で決定論的に生成して解く。
 * - 各人はちょうど1台に割り当てる (assignment 制約)
 * - 各台には capacity 上限 (車両定員)
 * - 目的: 総「コスト」最小化（コスト行列は決定論的に算出。Math.random は使わない）
 *
 * 結果と所要時間 (wasmLoadMs / solveMs) を postMessage で返す。
 */

type HighsSolution = {
  Status?: string;
  ObjectiveValue?: number;
  Columns?: Record<string, { Primal?: number; Name?: string }>;
};

type HighsInstance = {
  solve(problem: string, options?: Record<string, unknown>): HighsSolution;
};

type HighsLoader = (settings: {
  locateFile: (file: string) => string;
}) => Promise<HighsInstance>;

export type PocProgress =
  | { type: "progress"; phase: string; method: string }
  | {
      type: "done";
      method: string;
      status: string;
      objective: number;
      assignedPeople: number;
      cars: number;
      people: number;
      wasmLoadMs: number;
      solveMs: number;
      sample: string[];
    }
  | { type: "error"; method: string; message: string };

const PEOPLE = 30;
const CARS = 8;

/**
 * 決定論的な「コスト」を返す（1..9 の整数）。
 * 単純な剰余ハッシュで人×車ごとに固定値を作る（Math.random 不使用）。
 */
function cost(person: number, car: number): number {
  return ((person * 7 + car * 13 + person * car) % 9) + 1;
}

/**
 * 各車の定員（合計 >= PEOPLE になるよう決定論的に設定）。
 * 8台で 5 or 4 人乗り → 合計 36 席（30人を収容可能）。
 */
function capacity(car: number): number {
  return car % 2 === 0 ? 5 : 4; // 4*5 + 4*4 = 20+16 = 36
}

/** 30人×8台の割当 MILP を CPLEX LP 文字列として決定論的に生成 */
function buildLpProblem(): string {
  const lines: string[] = [];

  // --- 目的関数: 総コスト最小化 ---
  lines.push("Minimize");
  const objTerms: string[] = [];
  for (let p = 0; p < PEOPLE; p++) {
    for (let c = 0; c < CARS; c++) {
      objTerms.push(`${cost(p, c)} x_${p}_${c}`);
    }
  }
  lines.push(" obj: " + objTerms.join(" + "));

  // --- 制約 ---
  lines.push("Subject To");

  // (1) 各人はちょうど1台
  for (let p = 0; p < PEOPLE; p++) {
    const terms: string[] = [];
    for (let c = 0; c < CARS; c++) terms.push(`x_${p}_${c}`);
    lines.push(` person_${p}: ${terms.join(" + ")} = 1`);
  }

  // (2) 各車は定員以下
  for (let c = 0; c < CARS; c++) {
    const terms: string[] = [];
    for (let p = 0; p < PEOPLE; p++) terms.push(`x_${p}_${c}`);
    lines.push(` car_${c}: ${terms.join(" + ")} <= ${capacity(c)}`);
  }

  // --- 変数の範囲（0..1） ---
  lines.push("Bounds");
  for (let p = 0; p < PEOPLE; p++) {
    for (let c = 0; c < CARS; c++) {
      lines.push(` 0 <= x_${p}_${c} <= 1`);
    }
  }

  // --- 整数変数（0/1 割当） ---
  lines.push("Binary");
  for (let p = 0; p < PEOPLE; p++) {
    for (let c = 0; c < CARS; c++) {
      lines.push(` x_${p}_${c}`);
    }
  }

  lines.push("End");
  return lines.join("\n");
}

/**
 * highs ローダを取得する。
 * フォールバック順:
 *   a. 動的 import("highs")
 *   c. importScripts("/solver/highs.js") で globalThis.Module（classic worker のみ）
 *
 * module worker (type: "module") では importScripts が使えないため a を主とする。
 * どの方式で動いたかを method として返す。
 */
async function loadHighs(locateFile: (f: string) => string): Promise<{
  highs: HighsInstance;
  method: string;
}> {
  // --- 方式 a: 動的 import ---
  try {
    const mod = (await import("highs")) as unknown as {
      default?: HighsLoader;
    };
    const loader = mod.default;
    if (typeof loader === "function") {
      const highs = await loader({ locateFile });
      return { highs, method: "a:dynamic-import" };
    }
    throw new Error("dynamic import の default が function ではありません");
  } catch (errA) {
    const msgA = errA instanceof Error ? errA.message : String(errA);
    // --- 方式 c: classic worker での importScripts（module worker では失敗する想定） ---
    try {
      const scope = self as unknown as {
        importScripts?: (url: string) => void;
        Module?: HighsLoader;
      };
      if (typeof scope.importScripts === "function") {
        scope.importScripts(locateFile("highs.js"));
        const loader = scope.Module;
        if (typeof loader === "function") {
          const highs = await loader({ locateFile });
          return { highs, method: "c:importScripts" };
        }
      }
      throw new Error("importScripts 経路が使えません");
    } catch (errC) {
      const msgC = errC instanceof Error ? errC.message : String(errC);
      throw new Error(`highs ローダ取得に失敗。a:${msgA} / c:${msgC}`);
    }
  }
}

async function run(): Promise<void> {
  const method0 = "init";
  try {
    // Worker 内の XHR は絶対 URL を要求するため origin を前置する
    // （相対パス "/solver/..." だと Emscripten の XMLHttpRequest.open が Invalid URL で失敗）
    const origin = self.location.origin;
    const locateFile = (f: string) => `${origin}/solver/${f}`;

    self.postMessage({
      type: "progress",
      phase: "WASM をロード中…",
      method: method0,
    } satisfies PocProgress);

    const tLoadStart = performance.now();
    const { highs, method } = await loadHighs(locateFile);
    const wasmLoadMs = Math.round(performance.now() - tLoadStart);

    self.postMessage({
      type: "progress",
      phase: "MILP を求解中…",
      method,
    } satisfies PocProgress);

    const problem = buildLpProblem();

    const tSolveStart = performance.now();
    const sol = highs.solve(problem, { presolve: "on" });
    const solveMs = Math.round(performance.now() - tSolveStart);

    const status = sol.Status ?? "Unknown";
    const objective = sol.ObjectiveValue ?? NaN;

    // 割り当て結果のサマリ（先頭5人分）
    const cols = sol.Columns ?? {};
    let assignedPeople = 0;
    const sample: string[] = [];
    for (let p = 0; p < PEOPLE; p++) {
      let assignedCar = -1;
      for (let c = 0; c < CARS; c++) {
        const v = cols[`x_${p}_${c}`]?.Primal ?? 0;
        if (v > 0.5) {
          assignedCar = c;
          break;
        }
      }
      if (assignedCar >= 0) {
        assignedPeople++;
        if (sample.length < 5) {
          sample.push(`person_${p} → car_${assignedCar}`);
        }
      }
    }

    self.postMessage({
      type: "done",
      method,
      status,
      objective,
      assignedPeople,
      cars: CARS,
      people: PEOPLE,
      wasmLoadMs,
      solveMs,
      sample,
    } satisfies PocProgress);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({
      type: "error",
      method: method0,
      message,
    } satisfies PocProgress);
  }
}

// マウント時に PocClient が new Worker するので、即座に実行
void run();
