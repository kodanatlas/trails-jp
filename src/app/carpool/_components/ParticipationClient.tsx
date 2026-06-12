"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { fetchCarpool, postCarpool, patchCarpool } from "./carpoolFetch";
import { useActor } from "./useActor";
import { useToast } from "./Toast";
import ActorModal from "./ActorModal";
import CarpoolHeader from "./CarpoolHeader";
import { cn } from "@/lib/utils";
import type {
  ClubDTO,
  EventDTO,
  MemberDTO,
  NodeDTO,
  ParticipationDTO,
  PickupPrefDTO,
  RouteDTO,
} from "@/lib/carpool/api/mappers";
import type { DetectedEntry } from "./carpoolTypes";

interface ParticipationClientProps {
  slug: string;
  eventId: string;
}

type Role = "driver" | "rider" | "self" | "absent";
type Willingness = "always" | "if_needed";

const ROLE_SEGMENTS: { value: Role; label: string }[] = [
  { value: "driver", label: "運転手" },
  { value: "rider", label: "同乗希望" },
  { value: "self", label: "自力で行く" },
  { value: "absent", label: "不参加" },
];

const STATUS_LABEL: Record<EventDTO["status"], string> = {
  planning: "募集中",
  provisional: "暫定公開",
  final: "確定公開",
  closed: "終了",
};

const STATUS_CLASS: Record<EventDTO["status"], string> = {
  planning: "bg-blue-500/20 text-blue-400",
  provisional: "bg-yellow-500/20 text-yellow-400",
  final: "bg-green-500/20 text-green-400",
  closed: "bg-white/10 text-muted",
};

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

interface PForm {
  memberId: string;
  role: Role;
  capacityOverrideSeats: string;
  willingness: Willingness;
  earliestDepartureOverride: string;
  pickupPrefsOverride: PickupPrefDTO[];
  fixedDriverMemberId: string;
  notes: string;
  startTime: string;
  className: string;
}

const EMPTY_PFORM: PForm = {
  memberId: "",
  role: "rider",
  capacityOverrideSeats: "",
  willingness: "if_needed",
  earliestDepartureOverride: "",
  pickupPrefsOverride: [],
  fixedDriverMemberId: "",
  notes: "",
  startTime: "",
  className: "",
};

export default function ParticipationClient({ slug, eventId }: ParticipationClientProps) {
  const { toast, toastEl } = useToast();
  const { actorName, ready, setActor } = useActor(slug);

  const [club, setClub] = useState<ClubDTO | null>(null);
  const [event, setEvent] = useState<EventDTO | null>(null);
  const [routes, setRoutes] = useState<RouteDTO[]>([]);
  const [participations, setParticipations] = useState<ParticipationDTO[]>([]);
  const [members, setMembers] = useState<MemberDTO[]>([]);
  const [nodes, setNodes] = useState<NodeDTO[]>([]);
  const [detected, setDetected] = useState<DetectedEntry[]>([]);
  /** detect-entries の取得失敗（「検出0件」と区別して表示する）。 */
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectLoading, setDetectLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showActorModal, setShowActorModal] = useState(false);
  const [showDetect, setShowDetect] = useState(true);

  const [form, setForm] = useState<PForm>(EMPTY_PFORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const memberById = useMemo(() => {
    const map = new Map<string, MemberDTO>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const pickableNodes = useMemo(() => nodes.filter((n) => n.kind !== "venue"), [nodes]);
  const venueNode = useMemo(
    () => (event?.venueNodeId ? nodes.find((n) => n.id === event.venueNodeId) : undefined),
    [event, nodes],
  );

  const driverParticipations = useMemo(
    () => participations.filter((p) => p.role === "driver"),
    [participations],
  );

  const load = async () => {
    setLoading(true);
    try {
      const [clubRes, detailRes, membersRes, nodesRes] = await Promise.all([
        fetchCarpool<{ club: ClubDTO }>(`/clubs/${slug}`),
        fetchCarpool<{
          event: EventDTO;
          routes: RouteDTO[];
          participations: ParticipationDTO[];
        }>(`/clubs/${slug}/events/${eventId}`),
        fetchCarpool<{ members: MemberDTO[] }>(`/clubs/${slug}/members`),
        fetchCarpool<{ nodes: NodeDTO[] }>(`/clubs/${slug}/nodes`),
      ]);
      setClub(clubRes.club);
      setEvent(detailRes.event);
      setRoutes(detailRes.routes);
      setParticipations(detailRes.participations);
      setMembers(membersRes.members);
      setNodes(nodesRes.nodes);

      // detect-entries は失敗しても致命的でない（失敗は detectError で別表示）
      await loadDetect();
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  /** detect-entries のみ再取得（失敗時の再試行ボタンからも呼ぶ）。 */
  const loadDetect = async () => {
    setDetectLoading(true);
    setDetectError(null);
    try {
      const det = await fetchCarpool<{ detected: DetectedEntry[] }>(
        `/clubs/${slug}/events/${eventId}/detect-entries`,
      );
      setDetected(det.detected);
    } catch (e) {
      setDetected([]);
      setDetectError(
        e instanceof Error ? e.message : "エントリー検出の取得に失敗しました",
      );
    } finally {
      setDetectLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, eventId]);

  // actor が確定したら、その人の既存参加 or 既定値をフォームに反映
  useEffect(() => {
    if (!ready || members.length === 0) return;
    const me = actorName
      ? members.find((m) => m.displayName === actorName)
      : undefined;
    if (me && !form.memberId) {
      setForm((f) => ({ ...f, memberId: me.id, role: me.hasCar ? "driver" : "rider" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, actorName, members]);

  // メンバー選択時、既存参加があればフォームに展開
  const loadParticipationIntoForm = (memberId: string) => {
    const existing = participations.find((p) => p.memberId === memberId);
    const member = memberById.get(memberId);
    if (existing) {
      setForm({
        memberId,
        role: existing.role,
        capacityOverrideSeats:
          existing.capacityOverrideSeats === null
            ? ""
            : String(existing.capacityOverrideSeats),
        willingness: existing.willingness ?? "if_needed",
        earliestDepartureOverride: existing.earliestDepartureOverride ?? "",
        pickupPrefsOverride: Array.isArray(existing.pickupPrefsOverride)
          ? (existing.pickupPrefsOverride as PickupPrefDTO[])
          : [],
        fixedDriverMemberId: existing.fixedDriverMemberId ?? "",
        notes: existing.notes ?? "",
        startTime: existing.startTime ?? "",
        className: existing.className ?? "",
      });
    } else {
      setForm({
        ...EMPTY_PFORM,
        memberId,
        role: member?.hasCar ? "driver" : "rider",
      });
    }
  };

  const prefillForMember = (memberId: string) => {
    if (ready && !actorName) {
      setShowActorModal(true);
      return;
    }
    loadParticipationIntoForm(memberId);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const togglePickup = (nodeId: string) => {
    setForm((f) => {
      const exists = f.pickupPrefsOverride.find((p) => p.nodeId === nodeId);
      if (!exists) {
        return {
          ...f,
          pickupPrefsOverride: [...f.pickupPrefsOverride, { nodeId, strength: "soft" }],
        };
      }
      return {
        ...f,
        pickupPrefsOverride: f.pickupPrefsOverride.filter((p) => p.nodeId !== nodeId),
      };
    });
  };

  const setPickupStrength = (nodeId: string, strength: "hard" | "soft") => {
    setForm((f) => ({
      ...f,
      pickupPrefsOverride: f.pickupPrefsOverride.map((p) =>
        p.nodeId === nodeId ? { ...p, strength } : p,
      ),
    }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actorName) {
      setShowActorModal(true);
      return;
    }
    if (!form.memberId) {
      setFormError("メンバーを選択してください");
      return;
    }
    setSaving(true);
    setFormError(null);

    const body: Record<string, unknown> = {
      actorName,
      memberId: form.memberId,
      role: form.role,
      entrySource: "manual",
      startTime: form.startTime || null,
      className: form.className.trim() || null,
    };

    if (form.role === "driver") {
      body.capacityOverrideSeats =
        form.capacityOverrideSeats !== "" ? Number(form.capacityOverrideSeats) : null;
      body.willingness = form.willingness;
      body.earliestDepartureOverride = form.earliestDepartureOverride || null;
      body.pickupPrefsOverride = form.pickupPrefsOverride;
    } else if (form.role === "rider") {
      body.fixedDriverMemberId = form.fixedDriverMemberId || null;
      body.notes = form.notes.trim() || null;
    }

    const exists = participations.some((p) => p.memberId === form.memberId);

    try {
      const path = `/clubs/${slug}/events/${eventId}/participations`;
      if (exists) {
        await patchCarpool(path, body);
      } else {
        await postCarpool(path, body);
      }
      toast("参加状況を登録しました", "success");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const memberName = (id: string | null): string =>
    id ? (memberById.get(id)?.displayName ?? "不明") : "—";

  // 検出されたが未登録（参加レコードが無い）メンバー
  const unregisteredDetected = useMemo(() => {
    const participatedMemberIds = new Set(participations.map((p) => p.memberId));
    return detected.filter(
      (d) => !d.memberId || !participatedMemberIds.has(d.memberId),
    );
  }, [detected, participations]);

  return (
    <div className="min-h-screen">
      {toastEl}
      <CarpoolHeader
        clubName={club?.name ?? slug}
        slug={slug}
        actorName={actorName}
        onActorChange={() => setShowActorModal(true)}
      />

      <main className="mx-auto max-w-2xl px-4 py-6">
        {loading && <p className="text-sm text-muted">読み込み中…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        {!loading && !error && event && (
          <>
            {/* イベント情報カード */}
            <section className="mb-4 rounded-xl border border-border bg-card p-4">
              <div className="mb-1 flex items-start justify-between gap-2">
                <h1 className="text-lg font-bold text-foreground">{event.name}</h1>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[event.status]}`}
                >
                  {STATUS_LABEL[event.status]}
                </span>
              </div>
              <p className="text-sm text-muted">{formatEventDate(event.eventDate)}</p>
              {venueNode && (
                <p className="mt-1 text-sm text-foreground">会場: {venueNode.name}</p>
              )}
              {event.bulletinUrl && (
                <a
                  href={event.bulletinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-sm text-accent hover:underline"
                >
                  要綱を開く
                </a>
              )}
              {routes.length > 0 && (
                <p className="mt-1 text-xs text-muted">登録ルート: {routes.length} 件</p>
              )}
            </section>

            {/* エントリー検出（失敗と0件を区別して表示） */}
            {detectError ? (
              <section className="mb-4 rounded-xl border border-red-500/40 bg-card p-4">
                <p className="text-sm text-red-400">
                  エントリー検出の取得に失敗しました: {detectError}
                </p>
                <button
                  type="button"
                  onClick={() => void loadDetect()}
                  disabled={detectLoading}
                  className="mt-2 rounded-lg bg-white/10 px-4 py-2 text-xs text-foreground hover:bg-white/15 disabled:opacity-50"
                >
                  {detectLoading ? "再取得中…" : "再試行"}
                </button>
              </section>
            ) : detected.length === 0 ? (
              <section className="mb-4 rounded-xl border border-border bg-card p-4">
                <p className="text-sm text-muted">
                  JOY エントリーからの検出はありませんでした。
                </p>
              </section>
            ) : (
              <section className="mb-4 rounded-xl border border-border bg-card p-4">
                <button
                  type="button"
                  onClick={() => setShowDetect((s) => !s)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="text-sm font-semibold text-foreground">
                    JOY エントリーで {detected.length} 名を検出しました
                  </span>
                  <span className="text-xs text-muted">{showDetect ? "閉じる" : "開く"}</span>
                </button>
                {showDetect && (
                  <ul className="mt-3 flex flex-col gap-2">
                    {detected.map((d, i) => {
                      const matched = d.memberId ? memberById.get(d.memberId) : undefined;
                      return (
                        <li
                          key={`${d.nameKey}-${i}`}
                          className="rounded-lg bg-surface p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm text-foreground">
                                {d.rawName ?? d.nameKey}
                                <span className="ml-2 text-xs text-muted">
                                  {d.className}
                                </span>
                              </p>
                              <p className="truncate text-xs text-muted">
                                {d.affiliation}
                                {d.matchedClubName ? ` → ${d.matchedClubName}` : ""}
                              </p>
                            </div>
                            {d.alreadyRegistered && (
                              <span className="shrink-0 rounded bg-green-500/20 px-2 py-0.5 text-[10px] font-medium text-green-400">
                                登録済
                              </span>
                            )}
                          </div>
                          <div className="mt-2">
                            {matched ? (
                              <button
                                type="button"
                                onClick={() => prefillForMember(matched.id)}
                                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-dark"
                              >
                                {matched.displayName} で参加登録
                              </button>
                            ) : (
                              <Link
                                href={`/carpool/${slug}/members`}
                                className="text-xs text-accent hover:underline"
                              >
                                メンバー未登録 → 登録する
                              </Link>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {/* 参加登録フォーム */}
            <form
              onSubmit={submit}
              className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
            >
              <h2 className="text-sm font-semibold text-foreground">参加登録</h2>

              <div>
                <label className="mb-1 block text-xs text-muted">参加者</label>
                <select
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                  value={form.memberId}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) loadParticipationIntoForm(id);
                    else setForm((f) => ({ ...f, memberId: "" }));
                  }}
                >
                  <option value="">選択してください</option>
                  {members
                    .filter((m) => m.active)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                </select>
              </div>

              {/* ロール 4 分割セグメント */}
              <div>
                <span className="mb-1 block text-xs text-muted">参加方法</span>
                <div className="flex overflow-hidden rounded-lg border border-border bg-surface">
                  {ROLE_SEGMENTS.map((seg) => (
                    <button
                      key={seg.value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, role: seg.value }))}
                      className={cn(
                        "flex-1 py-2 text-center text-sm font-medium",
                        form.role === seg.value
                          ? "bg-primary text-white"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {seg.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 運転手フィールド */}
              {form.role === "driver" && (
                <div className="flex flex-col gap-4 rounded-lg bg-surface p-3">
                  <div>
                    <label className="mb-1 block text-xs text-muted">
                      自分以外にあと何人乗せられますか？
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={form.capacityOverrideSeats}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, capacityOverrideSeats: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-muted">車を出す頻度</span>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-1 text-sm text-foreground">
                        <input
                          type="radio"
                          name="p-willingness"
                          checked={form.willingness === "always"}
                          onChange={() => setForm((f) => ({ ...f, willingness: "always" }))}
                        />
                        必ず
                      </label>
                      <label className="flex items-center gap-1 text-sm text-foreground">
                        <input
                          type="radio"
                          name="p-willingness"
                          checked={form.willingness === "if_needed"}
                          onChange={() =>
                            setForm((f) => ({ ...f, willingness: "if_needed" }))
                          }
                        />
                        必要なら
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted">最早出発</label>
                    <input
                      type="time"
                      className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={form.earliestDepartureOverride}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          earliestDepartureOverride: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-muted">拾える場所</span>
                    <ul className="flex flex-col gap-1">
                      {pickableNodes.map((n) => {
                        const pref = form.pickupPrefsOverride.find(
                          (p) => p.nodeId === n.id,
                        );
                        return (
                          <li
                            key={n.id}
                            className="flex items-center justify-between gap-2 rounded-lg bg-background px-2 py-1.5"
                          >
                            <label className="flex items-center gap-2 text-sm text-foreground">
                              <input
                                type="checkbox"
                                checked={!!pref}
                                onChange={() => togglePickup(n.id)}
                              />
                              {n.name}
                            </label>
                            {pref && (
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => setPickupStrength(n.id, "hard")}
                                  className={cn(
                                    "rounded-lg px-3 py-2 text-xs",
                                    pref.strength === "hard"
                                      ? "bg-primary text-white"
                                      : "bg-white/10 text-muted",
                                  )}
                                >
                                  必須
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPickupStrength(n.id, "soft")}
                                  className={cn(
                                    "rounded-lg px-3 py-2 text-xs",
                                    pref.strength === "soft"
                                      ? "bg-primary text-white"
                                      : "bg-white/10 text-muted",
                                  )}
                                >
                                  できれば
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                      {pickableNodes.length === 0 && (
                        <li className="text-xs text-muted">地点がまだありません。</li>
                      )}
                    </ul>
                  </div>
                </div>
              )}

              {/* 同乗希望フィールド */}
              {form.role === "rider" && (
                <div className="flex flex-col gap-4 rounded-lg bg-surface p-3">
                  <div>
                    <label className="mb-1 block text-xs text-muted">
                      確約する運転手（任意）
                    </label>
                    <select
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={form.fixedDriverMemberId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, fixedDriverMemberId: e.target.value }))
                      }
                    >
                      <option value="">指定なし</option>
                      {driverParticipations.map((p) => (
                        <option key={p.memberId} value={p.memberId}>
                          {memberName(p.memberId)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted">希望・コメント</label>
                    <textarea
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      rows={2}
                      value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              {/* 共通任意フィールド */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">
                    スタート時刻（わかれば）
                  </label>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    value={form.startTime}
                    onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">クラス（わかれば）</label>
                  <input
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    value={form.className}
                    onChange={(e) => setForm((f) => ({ ...f, className: e.target.value }))}
                    maxLength={40}
                  />
                </div>
              </div>

              {formError && <p className="text-sm text-red-400">{formError}</p>}

              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {saving ? "登録中…" : "この内容で登録"}
              </button>
            </form>

            {/* 参加状況一覧 */}
            <section className="flex flex-col gap-4">
              <StatusGroup
                title="運転手"
                items={participations.filter((p) => p.role === "driver")}
                render={(p) => {
                  const m = memberById.get(p.memberId);
                  const seats =
                    p.capacityOverrideSeats ?? m?.seatsAvailable ?? null;
                  return (
                    <span>
                      {memberName(p.memberId)}
                      <span className="ml-2 text-xs text-muted">
                        {seats !== null ? `+${seats}名` : "定員未設定"}
                        {p.willingness === "always"
                          ? " ・必ず"
                          : p.willingness === "if_needed"
                            ? " ・必要なら"
                            : ""}
                      </span>
                    </span>
                  );
                }}
              />
              <StatusGroup
                title="同乗希望"
                items={participations.filter((p) => p.role === "rider")}
                render={(p) => (
                  <span>
                    {memberName(p.memberId)}
                    {p.fixedDriverMemberId && (
                      <span className="ml-2 text-xs text-accent">
                        → {memberName(p.fixedDriverMemberId)}
                      </span>
                    )}
                  </span>
                )}
              />
              <StatusGroup
                title="自力で行く"
                compact
                items={participations.filter((p) => p.role === "self")}
                render={(p) => <span>{memberName(p.memberId)}</span>}
              />
              <StatusGroup
                title="不参加"
                compact
                items={participations.filter((p) => p.role === "absent")}
                render={(p) => <span>{memberName(p.memberId)}</span>}
              />

              {unregisteredDetected.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold text-muted">
                    検出済み・未登録
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {unregisteredDetected.map((d, i) => (
                      <li
                        key={`${d.nameKey}-u-${i}`}
                        className="rounded-lg bg-card/50 px-3 py-1.5 text-sm text-muted"
                      >
                        {d.memberId ? memberName(d.memberId) : (d.rawName ?? d.nameKey)}
                        <span className="ml-2 text-[10px]">未登録</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {showActorModal && (
        <ActorModal
          slug={slug}
          members={members}
          onSelect={(name) => {
            setActor(name);
            setShowActorModal(false);
          }}
          onClose={() => setShowActorModal(false)}
        />
      )}
    </div>
  );
}

function StatusGroup({
  title,
  items,
  render,
  compact,
}: {
  title: string;
  items: ParticipationDTO[];
  render: (p: ParticipationDTO) => React.ReactNode;
  compact?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold text-muted">
        {title}（{items.length}）
      </h3>
      <ul className={cn("flex", compact ? "flex-wrap gap-2" : "flex-col gap-1")}>
        {items.map((p) => (
          <li
            key={p.id}
            className={cn(
              "rounded-lg bg-card px-3 py-1.5 text-sm text-foreground",
              compact ? "" : "border border-border",
            )}
          >
            {render(p)}
          </li>
        ))}
      </ul>
    </div>
  );
}
