"use client";

import { useEffect, useState } from "react";
import type { PocProgress } from "./solver.worker";

type Phase =
  | { kind: "idle" }
  | { kind: "running"; label: string; method: string }
  | {
      kind: "done";
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
  | { kind: "error"; method: string; message: string };

export default function PocClient() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    // StrictMode (dev) では effect→cleanup→effect の順で二重実行される。
    // ガードで2回目を抑止すると、1回目の cleanup で terminate した Worker が
    // 再生成されず固まるため、実行ごとに Worker を生成し cleanup で terminate
    // する標準パターンに従う（二重実行は WASM を2回ロードするが dev のみで許容）。
    setPhase({ kind: "running", label: "Worker を起動中…", method: "init" });

    let worker: Worker;
    try {
      worker = new Worker(
        new URL("./solver.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPhase({ kind: "error", method: "spawn", message });
      return;
    }

    worker.onmessage = (e: MessageEvent<PocProgress>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setPhase({ kind: "running", label: msg.phase, method: msg.method });
      } else if (msg.type === "done") {
        setPhase({
          kind: "done",
          method: msg.method,
          status: msg.status,
          objective: msg.objective,
          assignedPeople: msg.assignedPeople,
          cars: msg.cars,
          people: msg.people,
          wasmLoadMs: msg.wasmLoadMs,
          solveMs: msg.solveMs,
          sample: msg.sample,
        });
      } else if (msg.type === "error") {
        setPhase({ kind: "error", method: msg.method, message: msg.message });
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      setPhase({
        kind: "error",
        method: "worker.onerror",
        message: e.message || "不明な Worker エラー",
      });
    };

    return () => {
      worker.terminate();
    };
  }, []);

  // 自動化用ステータス文字列（#poc-result）
  let resultText: string;
  if (phase.kind === "done") {
    resultText = `${phase.status} | obj=${phase.objective} | ${phase.assignedPeople}/${phase.people} assigned | wasmLoad=${phase.wasmLoadMs}ms solve=${phase.solveMs}ms | via ${phase.method}`;
  } else if (phase.kind === "error") {
    resultText = `ERROR: ${phase.message} (method=${phase.method})`;
  } else if (phase.kind === "running") {
    resultText = `RUNNING: ${phase.label}`;
  } else {
    resultText = "IDLE";
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">配車割 MILP PoC (C-2)</h1>
      <p className="mt-2 text-sm text-gray-500">
        ブラウザ内 Web Worker で highs-js (WASM MILP) を起動し、30人×8台の割当問題を解きます。
      </p>

      <div className="mt-6 rounded-xl border border-gray-300 p-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          ステータス
        </div>
        {/* 自動化フック: 最終ステータス文字列 */}
        <div
          id="poc-result"
          data-kind={phase.kind}
          className="font-mono text-sm break-words"
        >
          {resultText}
        </div>
      </div>

      {phase.kind === "running" && (
        <div className="mt-4 flex items-center gap-2 text-sm text-blue-600">
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-blue-500" />
          {phase.label}
          <span className="text-xs text-gray-400">(method={phase.method})</span>
        </div>
      )}

      {phase.kind === "done" && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm">
            <div className="font-semibold text-green-700">
              求解完了: {phase.status}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">
              <dt className="text-gray-500">目的関数値</dt>
              <dd className="text-right">{phase.objective}</dd>
              <dt className="text-gray-500">割当人数</dt>
              <dd className="text-right">
                {phase.assignedPeople} / {phase.people}
              </dd>
              <dt className="text-gray-500">車両数</dt>
              <dd className="text-right">{phase.cars}</dd>
              <dt className="text-gray-500">WASM ロード</dt>
              <dd className="text-right">{phase.wasmLoadMs} ms</dd>
              <dt className="text-gray-500">求解時間</dt>
              <dd className="text-right">{phase.solveMs} ms</dd>
              <dt className="text-gray-500">ロード方式</dt>
              <dd className="text-right">{phase.method}</dd>
            </dl>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <div className="mb-2 text-xs font-semibold text-gray-400">
              割当サンプル（先頭5件）
            </div>
            <ul className="space-y-0.5 font-mono text-xs text-gray-600">
              {phase.sample.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm">
          <div className="font-semibold text-red-700">エラー</div>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-red-600">
            {phase.message}
          </pre>
          <div className="mt-1 text-xs text-gray-400">
            method = {phase.method}
          </div>
        </div>
      )}
    </div>
  );
}
