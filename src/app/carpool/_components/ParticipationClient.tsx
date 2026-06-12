"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchCarpool, postCarpool, patchCarpool, buildUrl } from "./carpoolFetch";
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

/** ユーザーが選べるロール（'undecided' は未回答状態であり選択肢に含めない）。 */
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

/** 検出行のキー（nameKey + index で安定化）。 */
function detKey(d: DetectedEntry, i: number): string {
  return `${d.nameKey}-${i}`;
}

export default function ParticipationClient({ slug, eventId }: ParticipationClientProps) {
  const { toast, toastEl } = useToast();

  const [club, setClub] = useState<ClubDTO | null>(null);
  const [event, setEvent] = useState<EventDTO | null>(null);
  const [routes, setRoutes] = useState<RouteDTO[]>([]);
  const [participations, setParticipations] = useState<ParticipationDTO[]>([]);
  const [members, setMembers] = useState<MemberDTO[]>([]);
  const [nodes, setNodes] = useState<NodeDTO[]>([]);
  const [detected, setDetected] = useState<DetectedEntry[]>([]);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectLoading, setDetectLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { actorName, actorMemberId, member: actorMember, ready, setActorMember } =
    useActor(slug, members);

  const [showActorModal, setShowActorModal] = useState(false);
  const [showDetect, setShowDetect] = useState(true);

  const [form, setForm] = useState<PForm>(EMPTY_PFORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 検出パネルの一括選択状態（detKey → 選択中）と未登録行の表示名入力（detKey → 値）。
  const [selectedDet, setSelectedDet] = useState<Record<string, boolean>>({});
  const [nameInputs, setNameInputs] = useState<Record<string, string>>({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

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

      await loadDetect();
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  };

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

  // actor が確定したら、その人の既定値をフォームに反映（初回のみ）。
  useEffect(() => {
    if (!ready || !actorMember) return;
    if (!form.memberId) {
      setForm((f) => ({
        ...f,
        memberId: actorMember.id,
        role: actorMember.hasCar ? "driver" : "rider",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, actorMember]);

  // メンバー選択時、既存参加があればフォームに展開。
  const loadParticipationIntoForm = (memberId: string) => {
    const existing = participations.find((p) => p.memberId === memberId);
    const member = memberById.get(memberId);
    if (existing) {
      // 'undecided'（未回答）はセグメントに無いので、回答を促す既定値に倒す。
      const initialRole: Role =
        existing.role === "undecided"
          ? member?.hasCar
            ? "driver"
            : "rider"
          : existing.role;
      setForm({
        memberId,
        role: initialRole,
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

  const scrollToForm = () => {
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

  // 既に参加行がある member（検出パネルから除外する）。
  const participatedMemberIds = useMemo(
    () => new Set(participations.map((p) => p.memberId)),
    [participations],
  );

  // 検出パネルに出す行（既に参加登録済みの member は出さない）。
  const pendingDetected = useMemo(
    () =>
      detected.filter((d) => !d.memberId || !participatedMemberIds.has(d.memberId)),
    [detected, participatedMemberIds],
  );

  const selectedKeys = useMemo(
    () => Object.keys(selectedDet).filter((k) => selectedDet[k]),
    [selectedDet],
  );

  const allSelected =
    pendingDetected.length > 0 &&
    pendingDetected.every((d, i) => selectedDet[detKey(d, i)]);

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedDet({});
    } else {
      const next: Record<string, boolean> = {};
      pendingDetected.forEach((d, i) => {
        next[detKey(d, i)] = true;
      });
      setSelectedDet(next);
    }
  };

  // 削除（誤検出・キャンセル用）。?memberId=&actorName= で DELETE。
  const deleteParticipation = async (memberId: string) => {
    if (!actorName) {
      setShowActorModal(true);
      return;
    }
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `${memberName(memberId)} の参加情報を削除しますか？`,
      );
      if (!ok) return;
    }
    try {
      const qs = `memberId=${encodeURIComponent(memberId)}&actorName=${encodeURIComponent(actorName)}`;
      const res = await fetch(
        buildUrl(`/clubs/${slug}/events/${eventId}/participations?${qs}`),
        { method: "DELETE", headers: { Accept: "application/json" } },
      );
      if (!res.ok) {
        let msg = `通信に失敗しました（${res.status}）`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          /* noop */
        }
        throw new Error(msg);
      }
      toast("参加情報を削除しました", "success");
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "削除に失敗しました", "error");
    }
  };

  // 選択した検出行をまとめて bulk 登録。
  const submitBulk = async () => {
    if (!actorName) {
      setShowActorModal(true);
      return;
    }
    if (selectedKeys.length === 0) return;
    setBulkSaving(true);
    setBulkError(null);

    const entries: Array<Record<string, unknown>> = [];
    for (let i = 0; i < pendingDetected.length; i++) {
      const d = pendingDetected[i];
      const key = detKey(d, i);
      if (!selectedDet[key]) continue;
      const className = d.className || null;
      if (d.memberId) {
        // 既存メンバー
        entries.push({ memberId: d.memberId, className });
      } else {
        // 未登録 → newMember（displayName は名前確認入力値、athleteKey は元の nameKey 不変）。
        const displayName = (nameInputs[key] ?? d.rawName ?? d.nameKey).trim();
        entries.push({
          newMember: { displayName, athleteKey: d.nameKey },
          className,
        });
      }
    }

    try {
      await postCarpool(`/clubs/${slug}/events/${eventId}/participations/bulk`, {
        actorName,
        entries,
      });
      toast(`${entries.length} 人を参加登録しました`, "success");
      setSelectedDet({});
      setNameInputs({});
      await load();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "一括登録に失敗しました");
    } finally {
      setBulkSaving(false);
    }
  };

  // 「次にやること」バナーの内容。
  const myParticipation = useMemo(
    () =>
      actorMemberId
        ? participations.find((p) => p.memberId === actorMemberId) ?? null
        : null,
    [participations, actorMemberId],
  );

  const banner = useMemo(() => {
    if (ready && !actorMemberId) {
      return {
        text: "まず自分を登録してください",
        label: "自分を登録",
        action: () => setShowActorModal(true),
      };
    }
    if (!actorMember) return null;
    if (!myParticipation) {
      return {
        text: "あなたの参加がまだ登録されていません",
        label: "参加を登録する",
        action: () => {
          loadParticipationIntoForm(actorMember.id);
          scrollToForm();
        },
      };
    }
    if (myParticipation.role === "undecided") {
      return {
        text: "あなたの役割が未回答です",
        label: "役割を答える",
        action: () => {
          loadParticipationIntoForm(actorMember.id);
          scrollToForm();
        },
      };
    }
    return {
      text: "あなたの参加は登録済みです",
      label: "内容を確認・変更",
      action: () => {
        loadParticipationIntoForm(actorMember.id);
        scrollToForm();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, actorMemberId, actorMember, myParticipation, participations]);

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

            {/* 「次にやること」バナー */}
            {banner && (
              <section className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/10 p-4">
                <p className="min-w-0 text-sm text-foreground">{banner.text}</p>
                <button
                  type="button"
                  onClick={banner.action}
                  className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-dark"
                >
                  {banner.label}
                </button>
              </section>
            )}

            {/* エントリー検出（一括登録） */}
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
            ) : pendingDetected.length === 0 ? (
              <section className="mb-4 rounded-xl border border-border bg-card p-4">
                <p className="text-sm text-muted">
                  JOY エントリーからの未登録者はありません。
                </p>
              </section>
            ) : (
              <section className="mb-4 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDetect((s) => !s)}
                    className="flex min-w-0 items-center gap-2 text-left"
                  >
                    <span className="text-sm font-semibold text-foreground">
                      JOY エントリーで {pendingDetected.length} 名（未登録）
                    </span>
                    <span className="text-xs text-muted">
                      {showDetect ? "閉じる" : "開く"}
                    </span>
                  </button>
                  {showDetect && (
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/15"
                    >
                      {allSelected ? "全解除" : "全選択"}
                    </button>
                  )}
                </div>

                {showDetect && (
                  <>
                    <ul className="mt-3 flex flex-col gap-2">
                      {pendingDetected.map((d, i) => {
                        const key = detKey(d, i);
                        const checked = !!selectedDet[key];
                        const isUnregistered = !d.memberId;
                        return (
                          <li key={key} className="rounded-lg bg-surface p-3">
                            <label className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={checked}
                                onChange={(e) =>
                                  setSelectedDet((s) => ({
                                    ...s,
                                    [key]: e.target.checked,
                                  }))
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-foreground">
                                  {d.memberId
                                    ? memberName(d.memberId)
                                    : (d.rawName ?? d.nameKey)}
                                  <span className="ml-2 text-xs text-muted">
                                    {d.className}
                                  </span>
                                </p>
                                <p className="truncate text-xs text-muted">
                                  {d.affiliation}
                                  {d.matchedClubName ? ` → ${d.matchedClubName}` : ""}
                                  {isUnregistered && (
                                    <span className="ml-2 text-[10px]">新規登録</span>
                                  )}
                                </p>
                              </div>
                            </label>

                            {/* 未登録行を選択したら、名前確認（姓 名）入力欄を出す */}
                            {isUnregistered && checked && (
                              <div className="mt-2 pl-6">
                                <label className="mb-1 block text-[10px] text-muted">
                                  登録名（姓と名の間にスペースを入れられます）
                                </label>
                                <input
                                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                                  value={nameInputs[key] ?? d.rawName ?? d.nameKey}
                                  onChange={(e) =>
                                    setNameInputs((s) => ({
                                      ...s,
                                      [key]: e.target.value,
                                    }))
                                  }
                                  maxLength={40}
                                />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {bulkError && (
                      <p className="mt-2 text-sm text-red-400">{bulkError}</p>
                    )}

                    <button
                      type="button"
                      onClick={() => void submitBulk()}
                      disabled={bulkSaving || selectedKeys.length === 0}
                      className="mt-3 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
                    >
                      {bulkSaving
                        ? "登録中…"
                        : `選択した ${selectedKeys.length} 人をまとめて参加登録`}
                    </button>
                  </>
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
                onDelete={deleteParticipation}
                render={(p) => {
                  const m = memberById.get(p.memberId);
                  const seats = p.capacityOverrideSeats ?? m?.seatsAvailable ?? null;
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
                onDelete={deleteParticipation}
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
                onDelete={deleteParticipation}
                render={(p) => <span>{memberName(p.memberId)}</span>}
              />
              <StatusGroup
                title="不参加"
                compact
                items={participations.filter((p) => p.role === "absent")}
                onDelete={deleteParticipation}
                render={(p) => <span>{memberName(p.memberId)}</span>}
              />
              <StatusGroup
                title="回答待ち"
                compact
                muted
                items={participations.filter((p) => p.role === "undecided")}
                onDelete={deleteParticipation}
                render={(p) => <span>{memberName(p.memberId)}</span>}
              />
            </section>
          </>
        )}
      </main>

      {showActorModal && (
        <ActorModal
          slug={slug}
          members={members}
          actorName={actorName}
          onSelectMember={(m) => {
            setActorMember(m);
            setMembers((prev) =>
              prev.some((x) => x.id === m.id) ? prev : [...prev, m],
            );
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
  muted,
  onDelete,
}: {
  title: string;
  items: ParticipationDTO[];
  render: (p: ParticipationDTO) => React.ReactNode;
  compact?: boolean;
  muted?: boolean;
  onDelete?: (memberId: string) => void;
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
              "flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm",
              muted
                ? "bg-white/10 text-muted"
                : "bg-card text-foreground",
              !compact && !muted ? "border border-border" : "",
            )}
          >
            <span className="min-w-0">{render(p)}</span>
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(p.memberId)}
                className="shrink-0 rounded px-2 py-0.5 text-[10px] text-muted hover:text-red-400"
                aria-label="削除"
              >
                削除
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
