"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { buildPlanInput, type PlanInputData } from "@/lib/carpool/plan-input";
import type { SolveResult } from "@/lib/carpool/solver/types";
import type { PlanWorkerMessage } from "./plan.worker";
import type {
  EventDTO,
  RouteDTO,
  ParticipationDTO,
  MemberDTO,
  NodeDTO,
  TravelTimeDTO,
} from "@/lib/carpool/api/mappers";
import type { PlanDetailDTO } from "@/lib/carpool/api/plan-schemas";

interface LivePreviewPanelProps {
  event: EventDTO;
  routes: RouteDTO[];
  participations: ParticipationDTO[];
  members: MemberDTO[];
  nodes: NodeDTO[];
  travelTimes: TravelTimeDTO[];
  publishedPlan: PlanDetailDTO | null;
  memberName: (id: string | null) => string;
  slug: string;
  eventId: string;
}

type Phase = "idle" | "running" | "done" | "error";

const DEBOUNCE_MS = 500;
const TIME_LIMIT_SEC = 3;

export default function LivePreviewPanel({
  event,
  routes,
  participations,
  members,
  nodes,
  travelTimes,
  publishedPlan,
  memberName,
  slug,
  eventId,
}: LivePreviewPanelProps) {
  // ── Published plan shortcut ──────────────────────────────────────────
  if (publishedPlan != null) {
    return (
      <section className="mt-6">
        <div className="min-h-[120px] rounded-xl border border-green-500/30 bg-green-500/10 p-4">
          <p className="text-sm text-green-300">
            配車結果が公開されています
          </p>
          <Link
            href={`/carpool/${slug}/${eventId}/result`}
            className="mt-2 inline-block text-sm text-primary underline underline-offset-2"
          >
            結果を見る →
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <PreviewBody
        event={event}
        routes={routes}
        participations={participations}
        members={members}
        nodes={nodes}
        travelTimes={travelTimes}
        memberName={memberName}
        slug={slug}
        eventId={eventId}
      />
    </section>
  );
}

function PreviewBody({
  event,
  routes,
  participations,
  members,
  nodes,
  travelTimes,
  memberName,
  slug,
  eventId,
}: Omit<LivePreviewPanelProps, "publishedPlan">) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<SolveResult | null>(null);
  const [solveMs, setSolveMs] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const planData: PlanInputData = useMemo(
    () => ({ event, routes, participations, members, nodes, travelTimes }),
    [event, routes, participations, members, nodes, travelTimes],
  );

  const built = useMemo(() => buildPlanInput(planData), [planData]);

  // Stable serialisation of solver input for effect dependency.
  // inputRef keeps the latest SolveInput accessible inside the debounce callback
  // without adding a reference-unstable dep to the effect.
  const inputKey = useMemo(
    () => (built.errors.length === 0 ? JSON.stringify(built.input) : null),
    [built],
  );
  const inputRef = useRef(built.input);
  inputRef.current = built.input;

  useEffect(() => {
    if (!inputKey) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      const runId = ++runIdRef.current;
      setPhase("running");

      if (!workerRef.current) {
        workerRef.current = new Worker(
          new URL("./plan.worker.ts", import.meta.url),
          { type: "module" },
        );
      }

      const worker = workerRef.current;

      worker.onmessage = (e: MessageEvent<PlanWorkerMessage>) => {
        const msg = e.data;
        if (msg.runId !== runId) return;

        if (msg.type === "result") {
          setResult(msg.result);
          setSolveMs(msg.solveMs);
          setPhase("done");
        } else if (msg.type === "error") {
          setErrorMsg(msg.message);
          setPhase("error");
        }
      };

      worker.onerror = () => {
        worker.terminate();
        workerRef.current = null;
        setErrorMsg("ワーカーで予期しないエラーが発生しました");
        setPhase("error");
      };

      worker.postMessage({
        input: inputRef.current,
        timeLimitSec: TIME_LIMIT_SEC,
        runId,
      });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [inputKey]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // ── Compute unassigned riders ────────────────────────────────────────
  const unassigned = useMemo(() => {
    if (!result || result.status !== "optimal") return [];
    const assignedIds = new Set(
      result.cars.flatMap((c) => [c.driverId, ...c.riders.map((r) => r.memberId)]),
    );
    return participations.filter(
      (p) => p.role === "rider" && !assignedIds.has(p.memberId),
    );
  }, [result, participations]);

  const totalRiders = result
    ? result.cars.reduce((sum, c) => sum + c.riders.length, 0)
    : 0;

  // ── Prerequisite errors ──────────────────────────────────────────────
  if (built.errors.length > 0) {
    return (
      <div className="min-h-[120px] rounded-xl border border-red-500/30 bg-red-500/5 p-4">
        <h3 className="text-sm font-semibold text-red-400">
          エラー（解消するまで配車の自動計算ができません）
        </h3>
        <ul className="mt-2 space-y-1 pl-4 text-xs text-red-300/90">
          {built.errors.map((err, i) => (
            <li key={i} className="list-disc">
              {err}
              {err.includes("ルート候補") && (
                <Link
                  href={"/carpool/" + slug + "/" + eventId + "/plan"}
                  className="ml-1.5 whitespace-nowrap text-primary hover:underline"
                >
                  配車計画ページで自動作成 →
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="min-h-[120px] rounded-xl border border-border bg-card p-4">
      {/* Spinner overlay */}
      {phase === "running" && (
        <div className="mb-3 flex items-center gap-2 text-sm text-muted">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
          配車を計算中...
        </div>
      )}

      {/* Error */}
      {phase === "error" && !result && (
        <p className="text-sm text-red-400">{errorMsg}</p>
      )}

      {/* Result */}
      {result && (
        <details open>
          <summary className="cursor-pointer text-xs text-muted">
            自動プレビュー（参考値・未確定）
            {solveMs > 0 && (
              <span className="ml-2 text-xs text-muted">
                {solveMs}ms
              </span>
            )}
          </summary>

          {result.status === "infeasible" ? (
            <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
              <p className="text-sm text-amber-200">
                現在の登録内容では全員を割り当てられません。座席数やルートを調整してください。
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {/* KPI summary */}
              <p className="text-sm text-foreground">
                車{result.kpi.carsUsed}台 ・ 乗車{totalRiders}人 ・ 最大待ち{result.kpi.maxSpreadMin}分
              </p>

              {/* Compact car cards */}
              <div className="space-y-2">
                {result.cars.map((car) => {
                  const total = car.riders.length + 1;
                  return (
                    <div
                      key={car.driverId}
                      className="rounded-lg border border-border bg-white/5 p-2"
                    >
                      <p className="text-xs text-muted">
                        {memberName(car.driverId)}（{total}人乗車）
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-foreground">
                          {memberName(car.driverId)} 運転
                        </span>
                        {car.riders.map((r) => (
                          <span
                            key={r.memberId}
                            className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-foreground"
                          >
                            {memberName(r.memberId)}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Unassigned riders */}
              {unassigned.length > 0 && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2">
                  <p className="text-xs text-amber-200">
                    未割当の同乗希望者（{unassigned.length}人）
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {unassigned.map((p) => (
                      <span
                        key={p.memberId}
                        className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200"
                      >
                        {memberName(p.memberId)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Link to full plan page */}
          <Link
            href={`/carpool/${slug}/${eventId}/plan`}
            className="mt-3 inline-block text-sm text-primary underline underline-offset-2"
          >
            詳しく調整する →
          </Link>
        </details>
      )}

      {/* Idle with no result yet */}
      {phase === "idle" && !result && (
        <p className="text-sm text-muted">参加登録の変更を検知すると自動で配車プレビューを表示します</p>
      )}
    </div>
  );
}
