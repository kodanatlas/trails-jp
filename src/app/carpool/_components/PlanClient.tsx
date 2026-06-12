"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { fetchCarpool, postCarpool, CarpoolApiError } from "./carpoolFetch";
import { useToast } from "./Toast";
import { minToTime, minToDuration } from "./planFormat";
import StartlistImport from "./StartlistImport";
import type { PlanWorkerMessage, PlanWorkerRequest } from "./plan.worker";
import { cn } from "@/lib/utils";
import {
  buildPlanInput,
  WEIGHT_PRESET_LABELS,
  WEIGHT_PRESETS,
  type WeightPresetKey,
  type PlanInputData,
} from "@/lib/carpool/plan-input";
import { recomputeBoardCars } from "@/lib/carpool/board-kpi";
import { validate, expandSchedule } from "@/lib/carpool/solver/solve";
import {
  DEFAULT_WEIGHTS,
  type Lock,
  type SolveInput,
  type SolveResult,
  type Weights,
} from "@/lib/carpool/solver/types";
import type { CarSchedule } from "@/lib/carpool/solver/postprocess";
import type {
  ClubDTO,
  EventDTO,
  MemberDTO,
  NodeDTO,
  ParticipationDTO,
  RouteDTO,
  TravelTimeDTO,
} from "@/lib/carpool/api/mappers";
import type {
  PlanCreateInput,
  PlanDetailDTO,
  PlanMetaDTO,
} from "@/lib/carpool/api/plan-schemas";

interface PlanClientProps {
  slug: string;
  eventId: string;
}

// 重みスライダの定義（03 §5 のキー順）。
const WEIGHT_FIELDS: { key: keyof Weights; label: string; max: number; step: number }[] = [
  { key: "drive", label: "走行", max: 10, step: 0.5 },
  { key: "spread", label: "待ち時間", max: 10, step: 0.5 },
  { key: "access", label: "アクセス", max: 10, step: 0.5 },
  { key: "risk", label: "リスク", max: 100, step: 1 },
  { key: "car", label: "台数", max: 300, step: 5 },
  { key: "soft", label: "希望地点", max: 100, step: 1 },
];

const PRESET_ORDER: WeightPresetKey[] = ["balanced", "wait", "drive"];

// P5.5: 座標未取得が原因のチェック項目から masters へ飛ぶときに付ける focus パラメータ。
// MastersClient 側はこの値を見て「場所」タブを開き、座標なしの行をハイライトする。
const FOCUS_MISSING_COORDS = "focus=missing-coords";

/**
 * 0時からの分 → "HH:MM"（両桁ゼロ詰め）。0..1439 にクランプ、範囲外は null。
 * POST body の departureTime / arrivalTime / boardTime で使う（API は "HH:MM" を要求）。
 */
function minToHHMM(min: number | null | undefined): string | null {
  if (min === null || min === undefined || Number.isNaN(min)) return null;
  const m = Math.round(min);
  if (m < 0 || m > 1439) return null;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** JST で "YYYY/MM/DD HH:MM" を作る（履歴の createdAt 表示）。 */
function formatJst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** kpi(jsonb) から totalDriveMin 等を緩く取り出す。 */
function readKpiNum(kpi: unknown, key: string): number | null {
  if (kpi && typeof kpi === "object" && key in kpi) {
    const v = (kpi as Record<string, unknown>)[key];
    return typeof v === "number" ? v : null;
  }
  return null;
}

type RunPhase =
  | { kind: "idle" }
  | { kind: "running"; label: string }
  | { kind: "done" }
  | { kind: "error"; message: string; detail?: string };

/** M1: infeasible/error は盤面（result）と分離して保持する。 */
interface SolveFailure {
  type: "infeasible" | "error";
  messages: string[];
}

export default function PlanClient({ slug, eventId }: PlanClientProps) {
  const { toast, toastEl } = useToast();

  // --- ロードしたデータ ---
  const [club, setClub] = useState<ClubDTO | null>(null);
  const [event, setEvent] = useState<EventDTO | null>(null);
  const [routes, setRoutes] = useState<RouteDTO[]>([]);
  const [participations, setParticipations] = useState<ParticipationDTO[]>([]);
  const [members, setMembers] = useState<MemberDTO[]>([]);
  const [nodes, setNodes] = useState<NodeDTO[]>([]);
  const [travelTimes, setTravelTimes] = useState<TravelTimeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- 設定 ---
  const [provisional, setProvisional] = useState(false);
  const [preset, setPreset] = useState<WeightPresetKey | "custom">("balanced");
  const [weights, setWeights] = useState<Weights>({ ...DEFAULT_WEIGHTS });
  const [showSliders, setShowSliders] = useState(false);
  const [timeLimitSec, setTimeLimitSec] = useState(5);

  // --- ロック（ボード操作由来）。memberId → driverId。 ---
  const [locks, setLocks] = useState<Lock[]>([]);

  // --- 求解結果 ---
  // M1: result は常に「直近の optimal 盤面」を保持する。infeasible/error は
  // failure に分離し、盤面を消さずに上へ重ねて表示する。
  const [runPhase, setRunPhase] = useState<RunPhase>({ kind: "idle" });
  const [result, setResult] = useState<SolveResult | null>(null);
  const [prevResult, setPrevResult] = useState<SolveResult | null>(null);
  const [failure, setFailure] = useState<SolveFailure | null>(null);
  const [schedules, setSchedules] = useState<CarSchedule[]>([]);
  // M3: expandSchedule の警告（時刻が不正確になり得る区間）。
  const [scheduleWarnings, setScheduleWarnings] = useState<string[]>([]);
  const [solveMs, setSolveMs] = useState<number | null>(null);
  // m5: 手動移動後は KPI を盤面から再計算した参考値として表示する。
  const [manualMoved, setManualMoved] = useState(false);
  const [kpiApprox, setKpiApprox] = useState(false);
  // 直前の求解に使った SolveInput（手動移動後の KPI 再計算・時刻再展開に使う）。
  const [lastSolveInput, setLastSolveInput] = useState<SolveInput | null>(null);
  // M2: 公開成功後の導線（結果ページリンク・URL コピー）。
  const [publishedInfo, setPublishedInfo] = useState<{
    status: "draft" | "published";
    version: number;
  } | null>(null);
  // onmessage クロージャから最新 result を読むための ref（stale closure 回避）。
  const resultRef = useRef<SolveResult | null>(null);
  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  // --- ボード操作: チップ選択 ---
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  // --- 公開/保存 ---
  const [publishing, setPublishing] = useState(false);

  // D: 移動時間の自動計算（OSRM）実行中フラグ。
  const [autoCalculating, setAutoCalculating] = useState(false);

  // --- 履歴 ---
  const [history, setHistory] = useState<PlanMetaDTO[]>([]);

  const workerRef = useRef<Worker | null>(null);
  // 実行の世代番号。Worker を使い回すため、古い実行からの応答を無視するのに使う。
  const runIdRef = useRef(0);

  // 調整さんモデル: 配車プランの保存・公開・移動時間の自動計算はメンバー文脈を持たない
  // クラブ全体の操作のため、change_log の actorName は固定文字列 "guest"。
  const actorName = "guest";

  // member / node / route の索引。
  const memberById = useMemo(() => {
    const map = new Map<string, MemberDTO>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);
  const nameOf = useCallback(
    (id: string) => memberById.get(id)?.displayName ?? id,
    [memberById],
  );
  const routeById = useMemo(() => {
    const map = new Map<string, RouteDTO>();
    for (const r of routes) map.set(r.id, r);
    return map;
  }, [routes]);

  // M6: 確約（fixed）の同乗者 → 確約先 driver。チップは固定表示で手動移動の対象外。
  const fixedDriverByMember = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of participations) {
      if (p.role === "rider" && p.fixedDriverMemberId) {
        map.set(p.memberId, p.fixedDriverMemberId);
      }
    }
    return map;
  }, [participations]);

  // --- データロード ---
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [clubRes, detailRes, membersRes, nodesRes, travelRes] = await Promise.all([
        fetchCarpool<{ club: ClubDTO }>(`/clubs/${slug}`),
        fetchCarpool<{
          event: EventDTO;
          routes: RouteDTO[];
          participations: ParticipationDTO[];
        }>(`/clubs/${slug}/events/${eventId}`),
        fetchCarpool<{ members: MemberDTO[] }>(`/clubs/${slug}/members`),
        fetchCarpool<{ nodes: NodeDTO[] }>(`/clubs/${slug}/nodes`),
        fetchCarpool<{ travelTimes: TravelTimeDTO[] }>(`/clubs/${slug}/travel-times`),
      ]);
      setClub(clubRes.club);
      setEvent(detailRes.event);
      setRoutes(detailRes.routes);
      setParticipations(detailRes.participations);
      setMembers(membersRes.members);
      setNodes(nodesRes.nodes);
      setTravelTimes(travelRes.travelTimes);
    } catch (e) {
      setError(
        e instanceof CarpoolApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "読み込みに失敗しました",
      );
    } finally {
      setLoading(false);
    }
  }, [slug, eventId]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetchCarpool<{ plans: PlanMetaDTO[] }>(
        `/clubs/${slug}/events/${eventId}/plans`,
      );
      setHistory(res.plans);
    } catch {
      // 履歴の取得失敗はページを壊さない（一覧は空のまま）。
      setHistory([]);
    }
  }, [slug, eventId]);

  // D: 移動時間の自動計算（場所どうし + 会場ルート）。
  // 実行前チェックに「移動時間が未入力」が出ているとき、ワンクリックで
  // OSRM 由来の移動時間とルート所要時間を埋め、プラン再読込で警告を更新する。
  const autoCalcTravelTimes = useCallback(async () => {
    setAutoCalculating(true);
    try {
      // 1) 場所どうしの移動時間（車/公共交通）。
      const tt = await postCarpool<{
        count: number;
        car: number;
        transit: number;
        osrmOk?: boolean;
        geoNodeCount?: number;
        message?: string;
      }>(`/clubs/${slug}/travel-times/auto`, { actorName });

      // 2) 会場ルートの所要時間。
      const rt = await postCarpool<{
        count: number;
        routeCount: number;
        osrmOk: boolean;
        message?: string;
      }>(`/clubs/${slug}/events/${eventId}/routes/auto-times`, { actorName });

      // 座標不足（geoNodeCount<2 もしくは message が座標に言及）は、まずマスタで座標取得を促す。
      const coordMissing =
        (tt.geoNodeCount !== undefined && tt.geoNodeCount < 2) ||
        (tt.message?.includes("座標") ?? false);
      if (coordMissing) {
        toast(
          "場所の座標が不足しています。マスタで座標を取得してください",
          "error",
        );
      } else if (tt.osrmOk === false || rt.osrmOk === false || tt.message || rt.message) {
        // OSRM 未接続など。埋まったぶんは反映済みなので、案内だけ出して続行する。
        toast(
          tt.message ??
            rt.message ??
            "自動計算サーバーに接続できませんでした。手動入力で補ってください",
          "success",
        );
      } else {
        toast(
          `移動時間を自動計算しました（車 ${tt.car}件・公共交通 ${tt.transit}件・会場 ${rt.count}件）`,
          "success",
        );
      }
    } catch (e) {
      toast(
        e instanceof CarpoolApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "自動計算に失敗しました",
        "error",
      );
    } finally {
      setAutoCalculating(false);
      // 反映ぶんで警告を更新するため、必ずプランを再読込する。
      await load();
    }
  }, [actorName, slug, eventId, load, toast]);

  useEffect(() => {
    void load();
    void loadHistory();
  }, [load, loadHistory]);

  // アンマウント時に Worker を確実に終了する。
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // --- 入力の組み立て（buildPlanInput） ---
  const planData: PlanInputData | null = useMemo(() => {
    if (!event) return null;
    return { event, routes, participations, members, nodes, travelTimes };
  }, [event, routes, participations, members, nodes, travelTimes]);

  const built = useMemo(() => {
    if (!planData) return null;
    return buildPlanInput(planData, {
      provisional,
      weights,
      locks,
      bufferMin: event?.bufferMin,
    });
  }, [planData, provisional, weights, locks, event?.bufferMin]);

  const input: SolveInput | null = built?.input ?? null;

  // 各 driverId の定員（運転手込み）を引くマップ。
  const capacityByDriver = useMemo(() => {
    const map = new Map<string, number>();
    if (input) for (const c of input.cars) map.set(c.driverId, c.capacity);
    return map;
  }, [input]);

  // --- 実行前チェック（validate + warnings をマージ） ---
  const validationErrors = useMemo(() => {
    if (!input) return [];
    try {
      return validate(input);
    } catch (e) {
      return [e instanceof Error ? e.message : "検証に失敗しました"];
    }
  }, [input]);

  const warnings = built?.warnings ?? [];
  // B1: 組み立て段階のブロッキングエラー（会場/ルート/運転手/脱落/確約/到達性）。
  const inputErrors = built?.errors ?? [];

  const driverCount = input?.cars.length ?? 0;
  const memberCount = input?.members.length ?? 0;

  // 実行不可の理由（最初の1件をボタン無効理由に使う）。
  // B1: inputErrors（データ不足）を最優先でブロックし、無言の infeasible を防ぐ。
  const blockReason = useMemo<string | null>(() => {
    if (!input) return "データを読み込み中です";
    if (inputErrors.length > 0) return "実行前チェックのエラーを解消してください";
    if (memberCount === 0) return "参加者がいません";
    if (driverCount === 0) return "運転手が登録されていません";
    if (validationErrors.length > 0) return "実行前チェックのエラーを解消してください";
    return null;
  }, [input, inputErrors.length, memberCount, driverCount, validationErrors.length]);

  const canRun = blockReason === null && runPhase.kind !== "running";

  // 求解実行中はボード操作（選択・移動・ロック）を禁止する。
  // 実行中の操作は完走時の setResult で上書きされ、解にも反映されないため。
  const boardLocked = runPhase.kind === "running";

  // B1: 各エラー/警告のテキストから解消先リンクを引く（不足データの修正導線）。
  const issueLink = useCallback(
    (text: string): { href: string; label: string } | null => {
      // 会場・駐車場の「場所」は座標が要るので focus を付けて座標未取得行へ誘導する。
      if (text.includes("会場・駐車場の場所")) {
        return {
          href: `/carpool/${slug}/masters?${FOCUS_MISSING_COORDS}`,
          label: "マスタ管理で登録",
        };
      }
      // ルート候補はルートデータの問題（座標ではない）ので plain href のまま。
      if (text.includes("ルート候補")) {
        return { href: `/carpool/${slug}/masters`, label: "マスタ管理で登録" };
      }
      // ルート所要時間はルート側の所要時間入力。座標ハイライトの対象ではない。
      if (text.includes("ルート所要時間")) {
        return { href: `/carpool/${slug}/masters`, label: "マスタ管理で入力" };
      }
      // 移動時間/マトリクス/乗車可能地点は座標不足が主因なので focus を付ける。
      if (
        text.includes("移動時間") ||
        text.includes("マトリクス") ||
        text.includes("乗車できる地点") ||
        text.includes("乗車可能地点")
      ) {
        return {
          href: `/carpool/${slug}/masters?${FOCUS_MISSING_COORDS}`,
          label: "マスタ管理で入力",
        };
      }
      // R7: 乗車エリアは参加状況ページの参加フォームで入力できる。
      if (text.includes("乗車エリア")) {
        return { href: `/carpool/${slug}/${eventId}`, label: "参加状況で入力" };
      }
      if (text.includes("自宅エリア") || text.includes("メンバー一覧に見つかりません")) {
        return { href: `/carpool/${slug}/members`, label: "メンバー一覧で設定" };
      }
      if (
        text.includes("確約") ||
        text.includes("スタート時刻") ||
        text.includes("同乗可能人数") ||
        text.includes("出発下限")
      ) {
        return { href: `/carpool/${slug}/${eventId}`, label: "参加状況で修正" };
      }
      return null;
    },
    [slug, eventId],
  );

  // 実行前チェックに出す全エラー（組み立て段階 + ソルバ validate）。描画用なので素の計算でよい。
  const allCheckErrors = [...inputErrors, ...validationErrors];

  // D: エラー/警告のいずれかに「移動時間が未入力」が含まれるか（自動計算ボタンの表示条件）。
  // allCheckErrors/warnings 同様に描画用の素の計算（小さい配列なので memo 不要）。
  const hasMissingTravelTime = [...allCheckErrors, ...warnings].some((m) =>
    m.includes("移動時間が未入力"),
  );

  // --- 最適化実行（Worker 起動） ---
  const runSolve = useCallback(
    (runLocks: Lock[]) => {
      if (!planData || !event) return;
      // ロックを反映した input を組み立て直す。
      const rebuilt = buildPlanInput(planData, {
        provisional,
        weights,
        locks: runLocks,
        bufferMin: event.bufferMin,
      });
      const solveInput = rebuilt.input;

      // 03 §9「WASM は初回のみロード」: Worker はユーザー操作（クリック）起点で
      // 遅延生成し、以後は使い回す（highs インスタンスは worker 側でキャッシュ）。
      // アンマウント時の cleanup effect が terminate する。古い実行の応答は runId で捨てる。
      let existing = workerRef.current;
      if (!existing) {
        try {
          existing = new Worker(new URL("./plan.worker.ts", import.meta.url), {
            type: "module",
          });
        } catch (e) {
          setRunPhase({
            kind: "error",
            message: "Worker の起動に失敗しました。ページを再読み込みしてください",
            detail: e instanceof Error ? e.message : String(e),
          });
          return;
        }
        workerRef.current = existing;
      }
      const worker = existing;
      const runId = ++runIdRef.current;
      setRunPhase({ kind: "running", label: "Worker を起動中…" });
      setSelectedMemberId(null);

      worker.onmessage = (e: MessageEvent<PlanWorkerMessage>) => {
        const msg = e.data;
        if (msg.runId !== runId) return; // 古い実行の応答は無視
        if (msg.type === "progress") {
          setRunPhase({ kind: "running", label: msg.phase });
        } else if (msg.type === "result") {
          const res = msg.result;
          setSolveMs(msg.solveMs);
          setRunPhase({ kind: "done" });
          if (res.status === "optimal") {
            // M1: optimal のときだけ盤面を更新。直前盤面は prevResult（差分表示用）へ。
            setPrevResult(resultRef.current);
            setResult(res);
            setFailure(null);
            setManualMoved(false);
            setKpiApprox(false);
            setLastSolveInput(solveInput);
            try {
              const exp = expandSchedule(solveInput, res.cars);
              setSchedules(exp.schedules);
              setScheduleWarnings(exp.warnings);
            } catch {
              setSchedules([]);
              setScheduleWarnings([]);
            }
          } else if (res.status === "infeasible") {
            // M1: 盤面（直前の optimal）は保持したまま、失敗パネルを重ねる。
            setFailure({ type: "infeasible", messages: [] });
          } else {
            setFailure({ type: "error", messages: res.validationErrors });
          }
          // Worker は使い回す（terminate しない）。WASM の再ロードを避ける。
        } else if (msg.type === "error") {
          setRunPhase({ kind: "error", message: msg.message, detail: msg.detail });
        }
      };

      worker.onerror = (e: ErrorEvent) => {
        setRunPhase({
          kind: "error",
          message: "最適化処理でエラーが発生しました。再試行してください",
          detail: e.message || undefined,
        });
        // ハードエラー時は Worker が壊れている可能性があるため作り直す。
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      };

      worker.postMessage({
        input: solveInput,
        timeLimitSec,
        runId,
      } satisfies PlanWorkerRequest);
    },
    [planData, event, provisional, weights, timeLimitSec],
  );

  const handleOptimize = useCallback(() => {
    setPrevResult(null);
    setFailure(null);
    setPublishedInfo(null);
    runSolve(locks);
  }, [runSolve, locks]);

  const handleReoptimize = useCallback(() => {
    setFailure(null);
    // 盤面が変わるため、直前の「公開しました」表示は下げる（公開済み版自体は履歴に残る）。
    setPublishedInfo(null);
    runSolve(locks);
  }, [runSolve, locks]);

  // M1: 失敗パネルからロックを個別解除する（どのロックが原因か試行錯誤できるように）。
  const removeLockAt = useCallback((idx: number) => {
    setLocks((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // --- プリセット選択 ---
  const handlePreset = useCallback((key: WeightPresetKey) => {
    setPreset(key);
    setWeights({ ...WEIGHT_PRESETS[key] });
  }, []);

  const handleWeightChange = useCallback((key: keyof Weights, value: number) => {
    setPreset("custom");
    setWeights((w) => ({ ...w, [key]: value }));
  }, []);

  // --- ロック判定 ---
  const isLocked = useCallback(
    (memberId: string) => locks.some((l) => l.memberId === memberId),
    [locks],
  );

  const toggleLock = useCallback(
    (memberId: string, driverId: string) => {
      if (boardLocked) return;
      setLocks((prev) => {
        const exists = prev.some((l) => l.memberId === memberId);
        if (exists) return prev.filter((l) => l.memberId !== memberId);
        return [...prev, { memberId, driverId }];
      });
    },
    [boardLocked],
  );

  // --- チップ選択 → 行先カードクリックで移動（自動ロック） ---
  const handleChipClick = useCallback(
    (memberId: string) => {
      if (boardLocked) return;
      // M6: 確約（fixed）メンバーは選択不可。確約の変更は参加状況ページで行う。
      if (fixedDriverByMember.has(memberId)) return;
      setSelectedMemberId((cur) => (cur === memberId ? null : memberId));
    },
    [boardLocked, fixedDriverByMember],
  );

  const handleMoveTo = useCallback(
    (destDriverId: string) => {
      if (boardLocked) return;
      if (!selectedMemberId) return;
      const memberId = selectedMemberId;
      // 運転手チップ・確約メンバーは移動できない（後者は選択ガードで通常到達しない）。
      if (memberId === destDriverId || fixedDriverByMember.has(memberId)) {
        setSelectedMemberId(null);
        return;
      }
      const cur = resultRef.current;
      if (!cur) return;

      // 定員超過ガード: 移動先が満席（riders は運転手込み）なら移動を拒否する。
      const destCar = cur.cars.find((c) => c.driverId === destDriverId);
      const destCap = capacityByDriver.get(destDriverId);
      if (
        destCar &&
        destCap !== undefined &&
        !destCar.riders.some((r) => r.memberId === memberId) &&
        destCar.riders.length >= destCap
      ) {
        toast(
          `${nameOf(destDriverId)} さんの車は定員（${destCap}人）に達しています`,
          "error",
        );
        setSelectedMemberId(null);
        return;
      }

      const homeNode = memberById.get(memberId)?.homeNodeId ?? null;
      // 乗車エリア不明のメンバーは移動先で乗車地点を決められない。
      // 盤面から消えるのを防ぐため、移動自体を中止する（ロックも追加しない）。
      if (!homeNode) {
        toast(
          `${nameOf(memberId)} さんの乗車エリアが未設定のため移動できません`,
          "error",
        );
        setSelectedMemberId(null);
        return;
      }

      // 盤面の cars を組み替える（nodeId は本人の自宅エリアを暫定採用）。
      const cars = cur.cars.map((car) =>
        car.driverId !== destDriverId
          ? { ...car, riders: car.riders.filter((r) => r.memberId !== memberId) }
          : car,
      );
      const destIdx = cars.findIndex((c) => c.driverId === destDriverId);
      if (
        destIdx >= 0 &&
        homeNode &&
        !cars[destIdx].riders.some((r) => r.memberId === memberId)
      ) {
        cars[destIdx] = {
          ...cars[destIdx],
          riders: [...cars[destIdx].riders, { memberId, nodeId: homeNode }],
        };
      }

      // m5: KPI と時刻を盤面と整合させる。直前の SolveInput から
      // driveMin/spread/KPI を再計算し、expandSchedule で時刻も再展開する。
      if (lastSolveInput) {
        const re = recomputeBoardCars(lastSolveInput, cars);
        setResult({ ...cur, cars: re.cars, kpi: re.kpi });
        setKpiApprox(re.incomplete);
        try {
          const exp = expandSchedule(lastSolveInput, re.cars);
          setSchedules(exp.schedules);
          setScheduleWarnings(exp.warnings);
        } catch {
          /* 時刻再展開に失敗しても盤面は維持する */
        }
      } else {
        setResult({ ...cur, cars });
        setKpiApprox(true);
      }
      setManualMoved(true);

      setLocks((prev) => {
        // 同一メンバーの既存ロックを除去し、行先 driver へのロックを追加する
        // （手動移動 = 移動先に自動ロック）。
        const next = prev.filter((l) => l.memberId !== memberId);
        return [...next, { memberId, driverId: destDriverId }];
      });
      setSelectedMemberId(null);
    },
    [
      boardLocked,
      selectedMemberId,
      fixedDriverByMember,
      capacityByDriver,
      memberById,
      lastSolveInput,
      nameOf,
      toast,
    ],
  );

  // --- 前回との差分（memberId → driverId が変わった人） ---
  const movedMemberIds = useMemo(() => {
    const moved = new Set<string>();
    if (!result || !prevResult) return moved;
    const driverOf = (res: SolveResult) => {
      const map = new Map<string, string>();
      for (const car of res.cars)
        for (const r of car.riders) map.set(r.memberId, car.driverId);
      return map;
    };
    const cur = driverOf(result);
    const prev = driverOf(prevResult);
    for (const [memberId, driverId] of cur) {
      const before = prev.get(memberId);
      if (before !== undefined && before !== driverId) moved.add(memberId);
    }
    return moved;
  }, [result, prevResult]);

  // schedule を driverId で引く。
  const scheduleByDriver = useMemo(() => {
    const map = new Map<string, CarSchedule>();
    for (const s of schedules) map.set(s.driverId, s);
    return map;
  }, [schedules]);

  // --- POST body 組み立て（公開/下書き） ---
  const buildCreateBody = useCallback(
    (status: "draft" | "published"): PlanCreateInput | null => {
      if (!result) return null;
      const cars: PlanCreateInput["cars"] = result.cars.map((car) => {
        const sched = scheduleByDriver.get(car.driverId);
        // 経由ノード順（schedule.stops が無ければ rider の nodeId 重複排除）。
        const pickupNodeIds: string[] = sched
          ? sched.stops.map((s) => s.nodeId)
          : Array.from(
              new Set(
                car.riders
                  .filter((r) => r.memberId !== car.driverId)
                  .map((r) => r.nodeId),
              ),
            );
        // 各ノードの到着時刻（stop.arriveMin）を引くマップ。
        const arriveByNode = new Map<string, number>();
        if (sched) for (const s of sched.stops) arriveByNode.set(s.nodeId, s.arriveMin);

        const riders = car.riders
          .filter((r) => r.memberId !== car.driverId)
          .map((r) => ({
            memberId: r.memberId,
            nodeId: r.nodeId,
            boardTime: minToHHMM(arriveByNode.get(r.nodeId)),
            // M6: 確約（fixed）メンバーもロック扱いで保存する。
            locked: isLocked(r.memberId) || fixedDriverByMember.has(r.memberId),
          }));

        return {
          driverMemberId: car.driverId,
          routeId: car.routeId || null,
          pickupNodeIds,
          departureTime: minToHHMM(sched?.departMin),
          arrivalTime: minToHHMM(sched?.venueArriveMin),
          riders,
        };
      });

      return {
        actorName,
        kind: "outbound",
        status,
        locks,
        weights,
        kpi: result.kpi,
        cars,
      };
    },
    [result, actorName, scheduleByDriver, isLocked, fixedDriverByMember, locks, weights],
  );

  // M3: 出発/到着/乗車時刻のいずれかが計算できていない車があるか。
  const timesIncomplete = useMemo(() => {
    if (!result) return false;
    return result.cars.some((car) => {
      const sched = scheduleByDriver.get(car.driverId);
      if (!sched) return true;
      if (
        minToHHMM(sched.departMin) === null ||
        minToHHMM(sched.venueArriveMin) === null
      ) {
        return true;
      }
      const arriveByNode = new Map(sched.stops.map((s) => [s.nodeId, s.arriveMin]));
      return car.riders.some(
        (r) =>
          r.memberId !== car.driverId &&
          minToHHMM(arriveByNode.get(r.nodeId)) === null,
      );
    });
  }, [result, scheduleByDriver]);

  const resultPath = `/carpool/${slug}/${eventId}/result`;

  const handlePublish = useCallback(
    async (status: "draft" | "published") => {
      const body = buildCreateBody(status);
      if (!body) return;
      // 定員超過の盤面は保存不可（手動移動は拒否されるが、防御的に公開直前でも検証）。
      const overCap = result?.cars.find((car) => {
        const cap = capacityByDriver.get(car.driverId);
        return cap !== undefined && car.riders.length > cap;
      });
      if (overCap) {
        toast(
          `${nameOf(overCap.driverId)} さんの車が定員を超えています。同乗者を移動するか再最適化してください`,
          "error",
        );
        return;
      }
      // M3: 時刻が空/部分欠落のまま公開しようとしたら確認を挟む。
      if (status === "published" && timesIncomplete) {
        const ok = window.confirm(
          "集合・出発時刻が計算できていません（移動時間の未入力が原因の可能性があります）。このまま公開しますか？",
        );
        if (!ok) return;
      }
      setPublishing(true);
      try {
        const res = await postCarpool<{ plan: PlanDetailDTO }>(
          `/clubs/${slug}/events/${eventId}/plans`,
          body,
        );
        toast(status === "published" ? "公開しました" : "下書き保存しました");
        // M2: 公開後の導線（結果ページ・URL コピー）を表示する。
        setPublishedInfo({ status, version: res.plan.version });
        await loadHistory();
      } catch (e) {
        const msg =
          e instanceof CarpoolApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : "保存に失敗しました";
        toast(msg, "error");
      } finally {
        setPublishing(false);
      }
    },
    [
      buildCreateBody,
      result,
      capacityByDriver,
      nameOf,
      timesIncomplete,
      slug,
      eventId,
      toast,
      loadHistory,
    ],
  );

  // M2: 結果ページ URL をクリップボードへコピー。
  const copyResultUrl = useCallback(async () => {
    const url = `${window.location.origin}${resultPath}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("結果ページの URL をコピーしました");
    } catch {
      // clipboard API 不可（非 https 等）の環境ではプロンプトにフォールバック。
      window.prompt("この URL をコピーしてください", url);
    }
  }, [resultPath, toast]);

  const clubName = club?.name ?? "配車";

  // ---------------------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted">
        読み込み中…
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {toastEl}

      {/* シンプルヘッダ（共通ヘッダーは別エージェント所有のため自前で最小構成）。 */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              href={`/carpool/${slug}/${eventId}`}
              className="truncate text-sm font-semibold text-foreground hover:text-primary"
              title="参加状況へ戻る"
            >
              🚗 {clubName}
            </Link>
            <span className="text-sm text-muted">配車プラン</span>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs">
            {/* M2: 結果ページへの常設リンク（公開後の共有 URL）。 */}
            <Link
              href={resultPath}
              className="shrink-0 text-primary hover:underline"
            >
              結果ページ
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {event && (
          <div className="mb-4">
            <h1 className="text-lg font-bold text-foreground">{event.name}</h1>
            <p className="text-sm text-muted">配車プランの作成・最適化</p>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* ===== 左: 設定 + 実行前チェック ===== */}
          <aside className="lg:col-span-3 space-y-4">
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold text-foreground">設定</h2>

              {/* 暫定/確定 */}
              <div className="mb-4">
                <span className="mb-1.5 block text-xs text-muted">モード</span>
                <div className="flex rounded-lg border border-border bg-surface p-0.5">
                  <button
                    type="button"
                    onClick={() => setProvisional(false)}
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium",
                      !provisional
                        ? "bg-primary text-white"
                        : "text-muted hover:text-foreground",
                    )}
                  >
                    確定
                  </button>
                  <button
                    type="button"
                    onClick={() => setProvisional(true)}
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium",
                      provisional
                        ? "bg-primary text-white"
                        : "text-muted hover:text-foreground",
                    )}
                  >
                    暫定
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  暫定はスタート時刻を無視して割当のみ最適化します。
                </p>
              </div>

              {/* P5.5: 重みプリセット・詳細スライダ・時間予算は ⚙ 詳細設定 に畳む。
                  既定（balanced / 5秒）のまま「最適化を実行」できるよう、開かなくても動く。 */}
              <details className="group rounded-lg border border-border bg-surface/50">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted hover:text-foreground">
                  <span>⚙ 詳細設定</span>
                  <span className="text-[10px] transition-transform group-open:rotate-90">
                    ▶
                  </span>
                </summary>
                <div className="border-t border-border px-3 pb-3 pt-3">
                  {/* 重みプリセット */}
                  <div className="mb-4">
                    <span className="mb-1.5 block text-xs text-muted">重みプリセット</span>
                    <div className="flex flex-col gap-1.5">
                      {PRESET_ORDER.map((key) => (
                        <label
                          key={key}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs",
                            preset === key
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border text-muted hover:text-foreground",
                          )}
                        >
                          <input
                            type="radio"
                            name="preset"
                            checked={preset === key}
                            onChange={() => handlePreset(key)}
                            className="accent-primary"
                          />
                          {WEIGHT_PRESET_LABELS[key]}
                        </label>
                      ))}
                      {preset === "custom" && (
                        <span className="text-[11px] text-yellow-400">
                          カスタム（スライダ編集中）
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 詳細スライダ（折りたたみ） */}
                  <div className="mb-4">
                    <button
                      type="button"
                      onClick={() => setShowSliders((s) => !s)}
                      className="text-xs text-primary hover:underline"
                    >
                      {showSliders ? "▼ 詳細スライダを隠す" : "▶ 詳細スライダ"}
                    </button>
                    {showSliders && (
                      <div className="mt-2 space-y-2">
                        {WEIGHT_FIELDS.map((f) => (
                          <div key={f.key}>
                            <div className="flex items-center justify-between text-[11px] text-muted">
                              <span>{f.label}</span>
                              <span className="tabular-nums">{weights[f.key]}</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={f.max}
                              step={f.step}
                              value={weights[f.key]}
                              onChange={(e) =>
                                handleWeightChange(f.key, Number(e.target.value))
                              }
                              className="w-full accent-primary"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ソルバ時間予算 */}
                  <div>
                    <label className="mb-1.5 block text-xs text-muted">
                      ソルバ時間予算（秒）
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={timeLimitSec}
                      onChange={(e) =>
                        setTimeLimitSec(
                          Math.max(1, Math.min(60, Number(e.target.value) || 5)),
                        )
                      }
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    />
                  </div>
                </div>
              </details>
            </section>

            {/* 実行前チェック（B1: エラーは実行をブロック。各項目に解消先リンク） */}
            {(warnings.length > 0 || allCheckErrors.length > 0) && (
              <section className="rounded-xl border border-border bg-card p-4">
                <h2 className="mb-2 text-sm font-semibold text-foreground">
                  実行前チェック
                </h2>
                {/* D: 移動時間が未入力のとき、OSRM 由来の自動計算をワンクリックで実行する。 */}
                {hasMissingTravelTime && (
                  <div className="mb-3 rounded-lg border border-primary/40 bg-primary/10 p-3">
                    <p className="text-xs text-foreground">
                      移動時間が未入力の区間があります。自動計算で埋められます。
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void autoCalcTravelTimes()}
                        disabled={autoCalculating}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
                      >
                        {autoCalculating ? "計算中…" : "自動計算する"}
                      </button>
                      <Link
                        href={`/carpool/${slug}/masters?${FOCUS_MISSING_COORDS}`}
                        className="whitespace-nowrap text-xs text-primary hover:underline"
                      >
                        マスタで座標を取得 →
                      </Link>
                    </div>
                  </div>
                )}
                {allCheckErrors.length > 0 && (
                  <div className="mb-2">
                    <span className="text-[11px] font-semibold text-red-400">
                      エラー（解消するまで実行できません）
                    </span>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-red-400">
                      {allCheckErrors.map((w, i) => {
                        const link = issueLink(w);
                        return (
                          <li key={`e-${i}`}>
                            {w}
                            {link && (
                              <Link
                                href={link.href}
                                className="ml-1.5 whitespace-nowrap text-primary hover:underline"
                              >
                                {link.label} →
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {warnings.length > 0 && (
                  <div>
                    <span className="text-[11px] font-semibold text-yellow-400">
                      注意
                    </span>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-yellow-400/90">
                      {warnings.map((w, i) => {
                        const link = issueLink(w);
                        return (
                          <li key={`w-${i}`}>
                            {w}
                            {link && (
                              <Link
                                href={link.href}
                                className="ml-1.5 whitespace-nowrap text-primary hover:underline"
                              >
                                {link.label} →
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* 実行ボタン */}
            <section className="rounded-xl border border-border bg-card p-4">
              <button
                type="button"
                onClick={handleOptimize}
                disabled={!canRun}
                className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {runPhase.kind === "running" ? "実行中…" : "最適化を実行"}
              </button>
              {blockReason && (
                <p className="mt-2 text-[11px] text-muted">{blockReason}</p>
              )}
              {runPhase.kind === "running" && (
                <div className="mt-3 flex items-center gap-2 text-xs text-primary">
                  <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
                  {runPhase.label}
                </div>
              )}
              {runPhase.kind === "error" && (
                <div className="mt-2 text-[11px] text-red-400">
                  <p className="break-words">{runPhase.message}</p>
                  {runPhase.detail && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-muted hover:text-foreground">
                        技術詳細
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-black/20 p-2 text-[10px] text-muted">
                        {runPhase.detail}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </section>

            {/* スタートリスト取込（発行書類 / URL / テキスト → 参加へ反映） */}
            <StartlistImport
              slug={slug}
              eventId={eventId}
              actorName={actorName}
              members={members}
              onApplied={() => void load()}
            />
          </aside>

          {/* ===== 中央: ボード ===== */}
          <main className="lg:col-span-6 space-y-4">
            {!result && runPhase.kind !== "running" && !failure && (
              <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted">
                「最適化を実行」を押すと配車案が表示されます。
              </div>
            )}

            {/* M1: 再最適化の失敗パネル。直前の optimal 盤面は下に保持したまま重ねて表示する。 */}
            {failure && (
              <div
                className={cn(
                  "rounded-xl border p-4 text-sm",
                  failure.type === "infeasible"
                    ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-300"
                    : "border-red-500/40 bg-red-500/10 text-red-400",
                )}
              >
                {failure.type === "infeasible" ? (
                  <>
                    <p className="font-semibold">
                      条件が厳しすぎて、実行可能な配車が見つかりませんでした。
                    </p>
                    <p className="mt-1 text-xs">
                      下のロックを解除して「再最適化」を試すか、「必要なら出す」車の定員を確認してください。
                      {result && "（直前の盤面は保持しています）"}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">求解エラー</p>
                    <ul className="mt-1 list-disc pl-4 text-xs">
                      {failure.messages.map((w, i) => (
                        <li key={`fe-${i}`}>{w}</li>
                      ))}
                    </ul>
                  </>
                )}
                {locks.length > 0 && (
                  <div className="mt-3">
                    <span className="text-xs font-semibold">現在のロック:</span>
                    <ul className="mt-1 space-y-1">
                      {locks.map((l, i) => (
                        <li
                          key={`lk-${i}`}
                          className="flex items-center justify-between gap-2 rounded-md bg-black/15 px-2 py-1 text-xs"
                        >
                          <span>
                            {l.memberId ? nameOf(l.memberId) : "—"} →{" "}
                            {nameOf(l.driverId)} の車
                          </span>
                          <button
                            type="button"
                            onClick={() => removeLockAt(i)}
                            className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[11px] text-foreground hover:bg-white/20"
                          >
                            解除
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={handleReoptimize}
                      disabled={runPhase.kind === "running"}
                      className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/15 disabled:opacity-50"
                    >
                      再最適化
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* optimal: 盤面 */}
            {result?.status === "optimal" && (
              <>
                {/* m1: ボード操作の常設ヒント */}
                <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-muted">
                  チップをタップ → 移動先の車をタップで移動できます。チップ右端の
                  🔒 でその車に固定。⛓確約のメンバーは
                  <Link
                    href={`/carpool/${slug}/${eventId}`}
                    className="mx-0.5 text-primary hover:underline"
                  >
                    参加状況ページ
                  </Link>
                  でのみ変更できます。
                </div>

                {/* M3: 時刻展開の警告（移動時間の未入力で時刻が不正確な区間） */}
                {scheduleWarnings.length > 0 && (
                  <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-400">
                    <span className="font-semibold">時刻の注意:</span>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {scheduleWarnings.map((w, i) => (
                        <li key={`sw-${i}`}>{w}</li>
                      ))}
                    </ul>
                    <Link
                      href={`/carpool/${slug}/masters`}
                      className="mt-1 inline-block text-primary hover:underline"
                    >
                      マスタ管理で移動時間を入力 →
                    </Link>
                  </div>
                )}

                {selectedMemberId && (
                  <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-foreground">
                    {nameOf(selectedMemberId)} さんを選択中。移動先の車をタップしてください。
                    <button
                      type="button"
                      onClick={() => setSelectedMemberId(null)}
                      className="ml-2 text-muted hover:text-foreground"
                    >
                      選択解除
                    </button>
                  </div>
                )}

                <div
                  className={cn(
                    "grid grid-cols-1 gap-3 sm:grid-cols-2",
                    // 実行中はボード操作を無効化（ハンドラ側のガードと二重防御）。
                    boardLocked && "pointer-events-none opacity-60",
                  )}
                >
                  {result.cars.map((car) => {
                    const driverName = nameOf(car.driverId);
                    const route = car.routeId ? routeById.get(car.routeId) : undefined;
                    const sched = scheduleByDriver.get(car.driverId);
                    const capacity = capacityByDriver.get(car.driverId) ?? car.riders.length;
                    const isMoveTarget =
                      selectedMemberId !== null && selectedMemberId !== car.driverId;
                    return (
                      <div
                        key={car.driverId}
                        onClick={() => isMoveTarget && handleMoveTo(car.driverId)}
                        className={cn(
                          "rounded-xl border border-border bg-card p-4",
                          isMoveTarget &&
                            "cursor-pointer border-primary/60 ring-2 ring-primary/30",
                        )}
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-foreground">
                              🚗 {driverName}
                            </div>
                            <div className="text-[11px] text-muted">
                              {route?.name ?? "ルート未定"}
                            </div>
                          </div>
                          <div className="text-right text-[11px] text-muted">
                            <div>
                              定員 {car.riders.length}/{capacity}
                            </div>
                            {sched && (
                              <div className="tabular-nums">
                                {minToTime(sched.departMin)}→
                                {minToTime(sched.venueArriveMin)}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {car.riders.map((r) => {
                            const isDriver = r.memberId === car.driverId;
                            const isFixed = fixedDriverByMember.has(r.memberId);
                            const locked = isLocked(r.memberId);
                            const selected = selectedMemberId === r.memberId;
                            const moved = movedMemberIds.has(r.memberId);
                            return (
                              <span
                                key={r.memberId}
                                className={cn(
                                  "inline-flex items-stretch overflow-hidden rounded-full text-[11px]",
                                  isDriver
                                    ? "bg-primary/20 text-primary"
                                    : isFixed
                                      ? "bg-accent/15 text-foreground"
                                      : "bg-white/10 text-foreground",
                                  selected && "ring-2 ring-primary",
                                  moved && "ring-2 ring-yellow-400",
                                )}
                              >
                                {/* 名前部分 = 選択用ボタン（m2: ロックと当たり判定を分離） */}
                                <button
                                  type="button"
                                  disabled={isDriver || isFixed}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleChipClick(r.memberId);
                                  }}
                                  title={
                                    isDriver
                                      ? undefined
                                      : isFixed
                                        ? "確約のため移動できません（参加状況ページで変更）"
                                        : "タップして選択 → 移動先の車をタップ"
                                  }
                                  className={cn(
                                    "inline-flex items-center gap-1 py-0.5 pl-2",
                                    isDriver || isFixed
                                      ? "cursor-default pr-2"
                                      : "cursor-pointer hover:bg-white/10",
                                    !isDriver && !isFixed && "pr-1",
                                  )}
                                >
                                  {nameOf(r.memberId)}
                                  {isDriver && (
                                    <span className="text-[10px] text-muted">運転</span>
                                  )}
                                  {/* M6: 確約バッジ（解除不可の固定表示） */}
                                  {isFixed && !isDriver && (
                                    <span
                                      className="text-[10px] text-accent"
                                      aria-label="確約のため固定"
                                    >
                                      ⛓確約
                                    </span>
                                  )}
                                </button>
                                {/* ロックボタン（独立した当たり判定・確約には出さない） */}
                                {!isDriver && !isFixed && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleLock(r.memberId, car.driverId);
                                    }}
                                    title={locked ? "ロック解除" : "この車にロック"}
                                    aria-label={locked ? "ロック解除" : "この車にロック"}
                                    className="border-l border-white/10 px-1.5 hover:bg-white/15"
                                  >
                                    {locked ? "🔒" : "🔓"}
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={handleReoptimize}
                  disabled={runPhase.kind === "running"}
                  className="rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15 disabled:opacity-50"
                >
                  ロックを保持して再最適化
                </button>
              </>
            )}
          </main>

          {/* ===== 右: KPI + アクション ===== */}
          <aside className="lg:col-span-3 space-y-4">
            {result?.status === "optimal" && (
              <>
                <section className="rounded-xl border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-semibold text-foreground">KPI</h2>
                  {/* M4: タイムリミット内の最良解（最適性未証明）バッジ */}
                  {result.solverStatus && result.solverStatus !== "Optimal" && (
                    <p className="mb-2 rounded-md bg-blue-500/10 px-2 py-1 text-[11px] text-blue-400">
                      時間内の最良解（最適性未証明）
                    </p>
                  )}
                  {/* m5: 手動移動後は盤面から再計算した参考値 */}
                  {manualMoved && (
                    <p className="mb-2 rounded-md bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-400">
                      手動移動後の再計算値（参考値）。
                      {kpiApprox && "一部の移動時間が未入力のため概算です。"}
                      「再最適化」で最適値に更新されます。
                    </p>
                  )}
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted">総走行時間</dt>
                      <dd className="tabular-nums text-foreground">
                        {minToDuration(result.kpi.totalDriveMin)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">最大スプレッド</dt>
                      <dd className="tabular-nums text-foreground">
                        {minToDuration(result.kpi.maxSpreadMin)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">使用台数</dt>
                      <dd className="tabular-nums text-foreground">
                        {result.kpi.carsUsed} 台
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">総アクセス時間</dt>
                      <dd className="tabular-nums text-foreground">
                        {minToDuration(result.kpi.totalAccessMin)}
                      </dd>
                    </div>
                  </dl>
                  {solveMs !== null && (
                    <p className="mt-2 text-[11px] text-muted">求解 {solveMs}ms</p>
                  )}
                  {movedMemberIds.size > 0 && (
                    <p className="mt-2 rounded-md bg-yellow-500/10 px-2 py-1 text-[11px] text-yellow-400">
                      前回から移動: {movedMemberIds.size}人
                    </p>
                  )}
                </section>

                <section className="rounded-xl border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-semibold text-foreground">公開</h2>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => handlePublish("published")}
                      disabled={publishing}
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
                    >
                      この案を公開
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePublish("draft")}
                      disabled={publishing}
                      className="rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15 disabled:opacity-50"
                    >
                      下書き保存
                    </button>
                  </div>

                  {/* M2: 公開成功後の導線（トーストだけにしない） */}
                  {publishedInfo && (
                    <div className="mt-3 rounded-lg border border-green-500/40 bg-green-500/10 p-3">
                      <p className="text-xs font-semibold text-green-400">
                        {publishedInfo.status === "published"
                          ? `第${publishedInfo.version}版を公開しました`
                          : `下書き保存しました（v${publishedInfo.version}）`}
                      </p>
                      {publishedInfo.status === "published" && (
                        <div className="mt-2 flex flex-col gap-1.5">
                          <Link
                            href={resultPath}
                            className="rounded-lg bg-primary px-3 py-1.5 text-center text-xs font-medium text-white hover:bg-primary-dark"
                          >
                            結果ページを見る →
                          </Link>
                          <button
                            type="button"
                            onClick={copyResultUrl}
                            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/15"
                          >
                            URL をコピー（メンバーに共有）
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}
          </aside>
        </div>

        {/* ===== 履歴 ===== */}
        <section className="mt-8 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">保存済みプラン</h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted">まだ保存されたプランはありません。</p>
          ) : (
            <ul className="space-y-2">
              {history.map((p) => {
                const drive = readKpiNum(p.kpi, "totalDriveMin");
                const cars = readKpiNum(p.kpi, "carsUsed");
                const spread = readKpiNum(p.kpi, "maxSpreadMin");
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs"
                  >
                    <span className="font-semibold text-foreground">v{p.version}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px]",
                        p.status === "published"
                          ? "bg-green-500/20 text-green-400"
                          : "bg-white/10 text-muted",
                      )}
                    >
                      {p.status === "published" ? "公開" : "下書き"}
                    </span>
                    <span className="text-muted">{formatJst(p.createdAt)}</span>
                    <span className="text-muted">
                      {cars !== null && `${cars}台`}
                      {drive !== null && ` / 走行${minToDuration(drive)}`}
                      {spread !== null && ` / 最大${minToDuration(spread)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
