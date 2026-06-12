"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCarpool, CarpoolApiError } from "./carpoolFetch";
import CarpoolHeader from "./CarpoolHeader";
import { trimTime, buildMapsDirUrl } from "./planFormat";
import { cn } from "@/lib/utils";
import { calcFare } from "@/lib/carpool/fare";
import { calcDepartRecommend } from "@/lib/carpool/depart-recommend";
import type { FareSettings } from "@/lib/carpool/fare";
import type {
  ClubDTO,
  EventDTO,
  MemberDTO,
  NodeDTO,
  ParticipationDTO,
  RouteDTO,
} from "@/lib/carpool/api/mappers";
import type {
  PlanDetailDTO,
  PlanCarDTO,
  PlanRiderDTO,
} from "@/lib/carpool/api/plan-schemas";

interface ResultClientProps {
  slug: string;
  eventId: string;
}

/** "2026-06-12" → "2026年6月12日（金）"。不正値は素通し。 */
function formatEventDate(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

const PLAN_STATUS_LABEL: Record<PlanDetailDTO["status"], string> = {
  published: "確定公開",
  draft: "下書き",
};

const PLAN_STATUS_CLASS: Record<PlanDetailDTO["status"], string> = {
  published: "bg-green-500/20 text-green-400",
  draft: "bg-yellow-500/20 text-yellow-400",
};

export default function ResultClient({ slug, eventId }: ResultClientProps) {
  const [club, setClub] = useState<ClubDTO | null>(null);
  const [event, setEvent] = useState<EventDTO | null>(null);
  const [routes, setRoutes] = useState<RouteDTO[]>([]);
  const [participations, setParticipations] = useState<ParticipationDTO[]>([]);
  const [members, setMembers] = useState<MemberDTO[]>([]);
  const [nodes, setNodes] = useState<NodeDTO[]>([]);
  const [plan, setPlan] = useState<PlanDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 調整さんモデル: 操作者概念なし。閲覧者は「自分の車を探す」一時選択のみ（保存しない）。
  const [tempMemberId, setTempMemberId] = useState<string | null>(null);
  const effectiveMemberId = tempMemberId;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [clubRes, detailRes, membersRes, nodesRes, planRes] =
          await Promise.all([
            fetchCarpool<{ club: ClubDTO }>(`/clubs/${slug}`),
            fetchCarpool<{
              event: EventDTO;
              routes: RouteDTO[];
              participations: ParticipationDTO[];
            }>(`/clubs/${slug}/events/${eventId}`),
            fetchCarpool<{ members: MemberDTO[] }>(`/clubs/${slug}/members`),
            fetchCarpool<{ nodes: NodeDTO[] }>(`/clubs/${slug}/nodes`),
            fetchCarpool<{ plan: PlanDetailDTO | null }>(
              `/clubs/${slug}/events/${eventId}/plans?status=published&latest=1`,
            ),
          ]);
        if (cancelled) return;
        setClub(clubRes.club);
        setEvent(detailRes.event);
        setRoutes(detailRes.routes);
        setParticipations(detailRes.participations);
        setMembers(membersRes.members);
        setNodes(nodesRes.nodes);
        setPlan(planRes.plan);
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof CarpoolApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : "読み込みに失敗しました",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, eventId]);

  // ルックアップマップ。
  const memberById = useMemo(() => {
    const map = new Map<string, MemberDTO>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const nodeById = useMemo(() => {
    const map = new Map<string, NodeDTO>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const routeById = useMemo(() => {
    const map = new Map<string, RouteDTO>();
    for (const r of routes) map.set(r.id, r);
    return map;
  }, [routes]);

  const participationByMemberId = useMemo(() => {
    const map = new Map<string, ParticipationDTO>();
    for (const p of participations) map.set(p.memberId, p);
    return map;
  }, [participations]);

  const memberName = useCallback(
    (id: string | null): string =>
      id ? (memberById.get(id)?.displayName ?? "不明") : "—",
    [memberById],
  );

  const venueNode = useMemo<NodeDTO | null>(
    () => (event?.venueNodeId ? (nodeById.get(event.venueNodeId) ?? null) : null),
    [event, nodeById],
  );

  // 「自分の車」: actor（または一時選択メンバー）が運転手 or 同乗者として現れる車。
  const ownCarDriverId = useMemo<string | null>(() => {
    if (!effectiveMemberId || !plan) return null;
    for (const car of plan.cars) {
      if (car.driverMemberId === effectiveMemberId) return car.driverMemberId;
      if (car.riders.some((r) => r.memberId === effectiveMemberId)) {
        return car.driverMemberId;
      }
    }
    return null;
  }, [effectiveMemberId, plan]);

  // m3: 一時選択の候補 = 配車に含まれるメンバー（運転手 + 同乗者）。
  const planMembers = useMemo<MemberDTO[]>(() => {
    if (!plan) return [];
    const ids = new Set<string>();
    for (const car of plan.cars) {
      ids.add(car.driverMemberId);
      for (const r of car.riders) ids.add(r.memberId);
    }
    return members
      .filter((m) => ids.has(m.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
  }, [plan, members]);

  // 配車に含まれる全メンバー（運転手 + 同乗者）。未割当の算出に使う。
  const assignedMemberIds = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    if (!plan) return set;
    for (const car of plan.cars) {
      set.add(car.driverMemberId);
      for (const r of car.riders) set.add(r.memberId);
    }
    return set;
  }, [plan]);

  // 未割当: driver/rider 参加なのに、どの車にも（運転手・同乗者どちらでも）現れない人。
  const unassignedMembers = useMemo<ParticipationDTO[]>(() => {
    if (!plan) return [];
    return participations.filter(
      (p) =>
        (p.role === "driver" || p.role === "rider") &&
        !assignedMemberIds.has(p.memberId),
    );
  }, [participations, plan, assignedMemberIds]);

  const selfParticipations = useMemo(
    () => participations.filter((p) => p.role === "self"),
    [participations],
  );
  const undecidedParticipations = useMemo(
    () => participations.filter((p) => p.role === "undecided"),
    [participations],
  );

  const scrollToOwnCar = useCallback(() => {
    if (!ownCarDriverId || typeof document === "undefined") return;
    const el = document.getElementById(`car-${ownCarDriverId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [ownCarDriverId]);

  return (
    <div className="min-h-screen">
      <CarpoolHeader clubName={club?.name ?? slug} slug={slug} />

      <main className="mx-auto max-w-2xl px-4 py-6">
        {loading && <p className="text-sm text-muted">読み込み中…</p>}

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-card p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && event && (
          <>
            {/* TOP HEADER: 大会名・日付・版数 */}
            <section className="mb-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-1 flex items-start justify-between gap-2">
                <h1 className="text-lg font-bold text-foreground">
                  {event.name}
                </h1>
                {plan && (
                  <span
                    className={cn(
                      "shrink-0 rounded px-2 py-0.5 text-[10px] font-medium",
                      PLAN_STATUS_CLASS[plan.status],
                    )}
                  >
                    第{plan.version}版・{PLAN_STATUS_LABEL[plan.status]}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted">
                {formatEventDate(event.eventDate)}
              </p>
              {venueNode && (
                <p className="mt-1 text-sm text-foreground">
                  会場: {venueNode.name}
                </p>
              )}

              {/* 「自分の車」を探せる一時選択（保存しない） */}
              {plan && planMembers.length > 0 && (
                <div className="mt-3">
                  <label
                    htmlFor="result-self-select"
                    className="block text-xs text-muted"
                  >
                    自分の車を探す（この選択は保存されません）
                  </label>
                  <select
                    id="result-self-select"
                    value={tempMemberId ?? ""}
                    onChange={(e) => setTempMemberId(e.target.value || null)}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                  >
                    <option value="">メンバーを選択…</option>
                    {planMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 「自分の車へ」ジャンプ（自分が配車に含まれる場合のみ表示） */}
              {ownCarDriverId && (
                <button
                  type="button"
                  onClick={scrollToOwnCar}
                  className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
                >
                  自分の車へ ↓
                </button>
              )}
            </section>

            {/* プラン未公開: エラーではなく親切な空状態 */}
            {!plan ? (
              <section className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm text-muted">
                  まだ配車案が公開されていません。
                </p>
              </section>
            ) : (
              <>
                {/* CAR CARDS */}
                <div className="flex flex-col gap-3">
                  {plan.cars.map((car) => (
                    <CarCard
                      key={car.driverMemberId}
                      car={car}
                      isOwn={car.driverMemberId === ownCarDriverId}
                      memberById={memberById}
                      nodeById={nodeById}
                      routeById={routeById}
                      participationByMemberId={participationByMemberId}
                      memberName={memberName}
                      venueNode={venueNode}
                      clubSettings={(club?.settings ?? {}) as FareSettings}
                    />
                  ))}
                  {plan.cars.length === 0 && (
                    <section className="rounded-xl border border-border bg-card p-4">
                      <p className="text-sm text-muted">
                        この配車案には車がありません。
                      </p>
                    </section>
                  )}
                </div>

                {/* LISTS: 自力参加 / 未割当 / 回答待ち */}
                <section className="mt-6 flex flex-col gap-4">
                  <NameListSection
                    title="自力参加"
                    names={selfParticipations.map((p) =>
                      memberName(p.memberId),
                    )}
                  />
                  <NameListSection
                    title="未割当"
                    note="どの車にも割り当てられていません"
                    names={unassignedMembers.map((p) => memberName(p.memberId))}
                  />
                  <NameListSection
                    title="回答待ち"
                    names={undecidedParticipations.map((p) =>
                      memberName(p.memberId),
                    )}
                  />
                </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 車カード（collapsible）
// ---------------------------------------------------------------------------

function CarCard({
  car,
  isOwn,
  memberById,
  nodeById,
  routeById,
  participationByMemberId,
  memberName,
  venueNode,
  clubSettings,
}: {
  car: PlanCarDTO;
  isOwn: boolean;
  memberById: Map<string, MemberDTO>;
  nodeById: Map<string, NodeDTO>;
  routeById: Map<string, RouteDTO>;
  participationByMemberId: Map<string, ParticipationDTO>;
  memberName: (id: string | null) => string;
  venueNode: NodeDTO | null;
  clubSettings: FareSettings;
}) {
  const driver = memberById.get(car.driverMemberId) ?? null;
  const driverName = memberName(car.driverMemberId);
  const routeName = car.routeId
    ? (routeById.get(car.routeId)?.name ?? "ルート未設定")
    : "ルート未設定";

  // 同乗者を乗車地点（nodeId）ごとにまとめる（pickupNodeIds の順序を尊重）。
  const ridersByNode = useMemo(() => {
    const map = new Map<string, PlanRiderDTO[]>();
    for (const r of car.riders) {
      const key = r.nodeId ?? "__none__";
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return map;
  }, [car.riders]);

  // 集合場所と乗車時刻（pickupNodeIds の順）。
  const pickupRows = useMemo(() => {
    return car.pickupNodeIds.map((nodeId) => {
      const node = nodeById.get(nodeId) ?? null;
      const riders = ridersByNode.get(nodeId) ?? [];
      // 同一ノードの代表 boardTime（最初の同乗者の値）。
      const boardTime = riders.find((r) => r.boardTime)?.boardTime ?? null;
      return { nodeId, node, riders, boardTime };
    });
  }, [car.pickupNodeIds, nodeById, ridersByNode]);

  // Google Maps ナビ: origin=運転手の自宅ノード / destination=会場 / waypoints=乗車地点（順）。
  const mapsUrl = useMemo(() => {
    const originNode = driver?.homeNodeId
      ? (nodeById.get(driver.homeNodeId) ?? null)
      : null;
    const waypoints = car.pickupNodeIds
      .map((id) => nodeById.get(id) ?? null)
      .filter((n): n is NodeDTO => n !== null);
    return buildMapsDirUrl({
      origin: originNode,
      destination: venueNode,
      waypoints,
    });
  }, [driver, car.pickupNodeIds, nodeById, venueNode]);

  const driverParticipation = participationByMemberId.get(car.driverMemberId);

  // 割り勘計算。
  const route = car.routeId ? routeById.get(car.routeId) ?? null : null;
  const riderCount = car.riders.length;
  const fare = route ? calcFare(route, riderCount, clubSettings) : null;

  // 出発リコメンド計算（運転手の homeNodeId に対応する rt を使う）。
  const driverHomeNodeId = driver?.homeNodeId ?? null;
  const rt =
    route?.routeTimes?.find((t) => t.nodeId === driverHomeNodeId)?.minutesToVenue ?? 0;
  const departRec = calcDepartRecommend(car.departureTime, route?.riskWindows ?? [], rt);

  return (
    <details
      id={`car-${car.driverMemberId}`}
      open
      className={cn(
        "scroll-mt-20 rounded-xl border bg-card p-4",
        isOwn ? "border-primary ring-2 ring-primary/40" : "border-border",
      )}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">
              🚗 {driverName}車（{routeName}）
            </p>
            {isOwn && (
              <span className="shrink-0 rounded bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                自分の車
              </span>
            )}
          </div>
          <p className="text-xs text-muted">
            出発 {trimTime(car.departureTime)} → 会場着{" "}
            {trimTime(car.arrivalTime)}
          </p>
        </div>
      </summary>

      <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
        {/* 集合場所と乗車時刻 */}
        {pickupRows.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold text-muted">
              集合場所と乗車時刻
            </h4>
            <ul className="flex flex-col gap-1">
              {pickupRows.map((row, i) => (
                <li
                  key={`${row.nodeId}-${i}`}
                  className="rounded-lg bg-surface px-3 py-1.5 text-sm text-foreground"
                >
                  集合: {row.node?.name ?? "地点不明"}{" "}
                  <span className="text-muted">{trimTime(row.boardTime)}</span>
                  {row.riders.length > 0 && (
                    <span className="ml-2 text-xs text-muted">
                      （
                      {row.riders
                        .map((r) => memberName(r.memberId))
                        .join("・")}
                      ）
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* メンバー行: 運転手（ST）→ 同乗者（ST） */}
        <div>
          <h4 className="mb-1 text-xs font-semibold text-muted">乗車メンバー</h4>
          <ul className="flex flex-col gap-1 text-sm text-foreground">
            <li>
              {driverName}
              <span className="ml-2 text-xs text-accent">（運転手）</span>
              <span className="ml-2 text-xs text-muted">
                ST {trimTime(driverParticipation?.startTime)}
              </span>
            </li>
            {car.riders.map((r) => {
              const rp = participationByMemberId.get(r.memberId);
              return (
                <li key={r.memberId}>
                  {memberName(r.memberId)}
                  <span className="ml-2 text-xs text-muted">同乗者</span>
                  <span className="ml-2 text-xs text-muted">
                    ST {trimTime(rp?.startTime)}
                  </span>
                </li>
              );
            })}
            {car.riders.length === 0 && (
              <li className="text-xs text-muted">同乗者なし</li>
            )}
          </ul>
        </div>

        {/* ルート名 */}
        <p className="text-xs text-muted">ルート: {routeName}</p>

        {/* 渋滞メモ */}
        {departRec && departRec.kind === "avoid" && (
          <p className="text-xs text-yellow-400">
            🚦 渋滞メモ: {departRec.avoid.reason}のため早め出発案{" "}
            <span className="font-semibold">{departRec.avoid.departMin}発</span>
            （通常 {departRec.departTime}発）
          </p>
        )}

        {/* 割り勘 */}
        {fare && (
          <p className="text-xs text-foreground">
            💰 割り勘: 1人{" "}
            <span className="font-semibold">{fare.perRiderYen.toLocaleString()}円</span>
            （高速往復 {fare.tollRoundYen.toLocaleString()}円 + 燃料 約{fare.fuelRoundYen.toLocaleString()}円）
          </p>
        )}

        {/* Google Maps ナビ */}
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-white hover:bg-primary-dark"
          >
            🗺 Google Maps でナビを開く
          </a>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// 名前リストセクション（空なら非表示）
// ---------------------------------------------------------------------------

function NameListSection({
  title,
  names,
  note,
}: {
  title: string;
  names: string[];
  note?: string;
}) {
  if (names.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold text-muted">
        {title}（{names.length}）
      </h3>
      {note && <p className="mb-1 text-[10px] text-muted">{note}</p>}
      <ul className="flex flex-wrap gap-2">
        {names.map((name, i) => (
          <li
            key={`${name}-${i}`}
            className="rounded-lg bg-card px-3 py-1.5 text-sm text-foreground"
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}
