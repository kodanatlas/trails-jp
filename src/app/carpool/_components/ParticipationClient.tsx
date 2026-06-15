"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchCarpool, postCarpool, patchCarpool, buildUrl } from "./carpoolFetch";
import { useToast } from "./Toast";
import CarpoolHeader from "./CarpoolHeader";
import AddMemberModal from "./AddMemberModal";
import StartlistImport from "./StartlistImport";
import { chunkBulkEntries } from "@/lib/carpool/bulk-plan";
import { planQuickRegister, type QuickRole } from "@/lib/carpool/quick-register";
import {
  detectedDisplayName,
  matchesNameQuery,
  sortDetectedByName,
} from "@/lib/carpool/participant-filter";
import {
  toApiRole,
  participationToFormRole,
  quarterHourStep,
  summarizeForPlan,
  type FormRole,
} from "@/lib/carpool/form-ui";
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

/**
 * R4: UI のロール（'undecided' は未回答状態であり選択肢に含めない）。
 * passenger（同乗者 = 乗る車が決まっている）は UI 専用で、API では
 * role='rider' + fixedDriverMemberId に畳む（DB 変更なし・MILP の確約 hard 制約と整合）。
 */
type Willingness = "always" | "if_needed";

const ROLE_SEGMENTS: { value: FormRole; label: string }[] = [
  { value: "driver", label: "運転手" },
  { value: "passenger", label: "同乗者（乗る車が決まっている）" },
  { value: "rider", label: "同乗希望（配車を待つ）" },
  { value: "self", label: "自力" },
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
  role: FormRole;
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
  const [participations, setParticipations] = useState<ParticipationDTO[]>([]);
  const [members, setMembers] = useState<MemberDTO[]>([]);
  const [nodes, setNodes] = useState<NodeDTO[]>([]);
  const [detected, setDetected] = useState<DetectedEntry[]>([]);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectLoading, setDetectLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 調整さんモデル: 操作者概念なし。URL を開いた全員が同じデータを編集できる。
  // change_log の actorName は「編集対象メンバーの displayName」、メンバー文脈の無い
  // 一括登録は固定文字列 "guest"（memberName 経由で解決する）。
  const [showAddMember, setShowAddMember] = useState(false);
  const [showDetect, setShowDetect] = useState(true);

  const [form, setForm] = useState<PForm>(EMPTY_PFORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // R7: 乗車エリア（自宅エリア）のテキスト入力。選択メンバーの現在値をプリフィルする。
  const [homeAreaInput, setHomeAreaInput] = useState("");
  // major1: 乗車エリアを「その他（入力）」でテキスト入力中か（チップ非該当値の編集用）。
  const [areaOtherOpen, setAreaOtherOpen] = useState(false);
  // 再発防止 UX: 乗車エリアを新規作成・名前ジオコーディングした結果、入力名と解決先が
  // 違った（exact=false）ときの確認バナー。{ input, resolved }。exact=true は静か（null）。
  const [areaGeocodeNotice, setAreaGeocodeNotice] = useState<{
    input: string;
    resolved: string;
  } | null>(null);

  // 検出パネルの一括選択状態（detKey → 選択中）と未登録行の表示名入力（detKey → 値）。
  const [selectedDet, setSelectedDet] = useState<Record<string, boolean>>({});
  const [nameInputs, setNameInputs] = useState<Record<string, string>>({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  // M4: 行単位クイック登録の進行中 detKey（null = 待機）。
  const [quickSavingKey, setQuickSavingKey] = useState<string | null>(null);
  // R5: 未登録メンバーの運転手クイック登録前に同乗可能人数を聞く最小ステップ（detKey / 入力値）。
  const [seatsAskKey, setSeatsAskKey] = useState<string | null>(null);
  const [seatsAskValue, setSeatsAskValue] = useState("");
  // B: 同乗者クイック登録前に「乗る車（運転手）」を聞く最小ステップ（detKey / 選択中の運転手 member id）。
  const [driverAskKey, setDriverAskKey] = useState<string | null>(null);
  const [driverAskValue, setDriverAskValue] = useState("");

  // 参加者一覧（③）の名前検索（任意・端末に保存しない＝毎回入力）。
  // 未登録（JOY検出）サブグループと登録済み行の両方を横断フィルタする。
  const [nameQuery, setNameQuery] = useState("");

  // Phase 5.5 major3: 「詳細を編集」セクションの開閉（既定は閉じる。行タップ/行追加で自動展開）。
  const [showEdit, setShowEdit] = useState(false);

  const memberById = useMemo(() => {
    const map = new Map<string, MemberDTO>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  // 調整さんモデル: write の actorName は編集対象メンバーの displayName を使う。
  const memberName = useCallback(
    (id: string | null): string =>
      id ? (memberById.get(id)?.displayName ?? "不明") : "—",
    [memberById],
  );

  const nodeById = useMemo(() => {
    const map = new Map<string, NodeDTO>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const pickableNodes = useMemo(() => nodes.filter((n) => n.kind !== "venue"), [nodes]);
  const venueNode = useMemo(
    () => (event?.venueNodeId ? nodes.find((n) => n.id === event.venueNodeId) : undefined),
    [event, nodes],
  );

  // major1: 乗車エリアのチップ候補（場所 = area / pickup ノード名・重複排除）。
  // 0 件のクラブ（初期）はチップを出さずテキスト入力のみ。
  const areaChipNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of nodes) {
      if (n.kind !== "area" && n.kind !== "pickup") continue;
      const name = n.name.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out.sort((a, b) => a.localeCompare(b, "ja"));
  }, [nodes]);

  const driverParticipations = useMemo(
    () => participations.filter((p) => p.role === "driver"),
    [participations],
  );

  // M5: 現在 driver として参加登録されている member（確約先の事後不整合チェック用）。
  const currentDriverIds = useMemo(
    () => new Set(driverParticipations.map((p) => p.memberId)),
    [driverParticipations],
  );

  // R7: メンバー選択が変わったら乗車エリア入力を本人の現在値にプリフィルする。
  // major1: チップ非該当の既存値ならテキスト入力（その他）を開いた状態で開始する。
  useEffect(() => {
    const m = memberById.get(form.memberId);
    const name = m?.homeNodeId ? (nodeById.get(m.homeNodeId)?.name ?? "") : "";
    setHomeAreaInput(name);
    setAreaOtherOpen(false);
  }, [form.memberId, memberById, nodeById]);

  // R6: 配車計画プレースホルダのサマリ（運転手1+ かつ 同乗1+ で表示）。
  const planSummary = useMemo(() => summarizeForPlan(participations), [participations]);

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

  // 指摘3: 検出結果からメンバーのクラスを引く（自分が検出されていれば class をプリフィル）。
  const detectedClassFor = (memberId: string): string => {
    const hit = detected.find((d) => d.memberId === memberId && d.className);
    return hit?.className ?? "";
  };

  // メンバー選択時、既存参加があればフォームに展開。無ければ member の既定値をプリフィル（指摘2）。
  const loadParticipationIntoForm = (memberId: string) => {
    const existing = participations.find((p) => p.memberId === memberId);
    const member = memberById.get(memberId);
    if (existing) {
      // R4/R5: participation.role を尊重して UI ロールへ変換
      // （rider は fixedDriver の有無で 同乗者/同乗希望、undecided は hasCar で倒す）。
      const initialRole: FormRole = participationToFormRole(
        existing.role,
        existing.fixedDriverMemberId,
        member?.hasCar ?? false,
      );
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
      // 指摘2: 運転手項目を member のプロフィール既定値でプリフィルする（二重入力の解消）。
      // 既定値と異なる値だけを override として送るため、初期値は member の既定値そのものにする。
      // 指摘3: クラスは検出結果からプリフィル（検出されていれば）。
      setForm({
        ...EMPTY_PFORM,
        memberId,
        role: member?.hasCar ? "driver" : "rider",
        capacityOverrideSeats:
          member?.seatsAvailable === null || member?.seatsAvailable === undefined
            ? ""
            : String(member.seatsAvailable),
        willingness: member?.defaultWillingness ?? "if_needed",
        earliestDepartureOverride: member?.earliestDeparture ?? "",
        className: detectedClassFor(memberId),
      });
    }
  };

  const scrollToForm = () => {
    if (typeof window === "undefined") return;
    // major3: 編集フォームは下方の「詳細を編集」セクション内。展開アニメ後に位置が確定するため
    // 次フレームでアンカーへスクロールする（無ければ先頭へフォールバック）。
    requestAnimationFrame(() => {
      const el = document.getElementById("edit-section");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    });
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
    if (!form.memberId) {
      setFormError("メンバーを選択してください");
      return;
    }
    // 調整さんモデル: 編集対象メンバーの displayName を actorName に使う。
    const actorName = memberName(form.memberId);
    // R4: 同乗者（乗る車が決まっている）は確約相手（運転手）の選択が必須。
    if (form.role === "passenger" && !form.fixedDriverMemberId) {
      setFormError("乗る車（運転手）を選択してください");
      return;
    }
    // R7: 運転手/同乗者/同乗希望は乗車エリア（自宅エリア）が必須。
    // 未設定のまま登録すると配車計算で割当不能になる（plan 画面でブロックされる）。
    const needsHomeArea =
      form.role === "driver" || form.role === "passenger" || form.role === "rider";
    const homeAreaName = homeAreaInput.trim();
    if (needsHomeArea && !homeAreaName) {
      setFormError("乗車エリアが未設定です。設定しないと配車の割当ができません");
      return;
    }
    setSaving(true);
    setFormError(null);
    setAreaGeocodeNotice(null);

    const body: Record<string, unknown> = {
      actorName,
      memberId: form.memberId,
      // R4: passenger は API では rider に畳む（DB 変更なし）。
      role: toApiRole(form.role),
      entrySource: "manual",
      startTime: form.startTime || null,
      className: form.className.trim() || null,
    };

    if (form.role === "driver") {
      // 指摘2: member の既定値と同じなら override を送らない（null）。
      // フォームに変更が無ければ「プロフィールの既定値」をそのまま使い、
      // 変えたぶんだけ参加単位の override として保存する。
      const member = memberById.get(form.memberId);
      const formSeats =
        form.capacityOverrideSeats !== "" ? Number(form.capacityOverrideSeats) : null;
      const defaultSeats = member?.seatsAvailable ?? null;
      body.capacityOverrideSeats = formSeats === defaultSeats ? null : formSeats;

      const defaultWillingness = member?.defaultWillingness ?? "if_needed";
      body.willingness = form.willingness === defaultWillingness ? null : form.willingness;

      const formDep = form.earliestDepartureOverride || null;
      const defaultDep = member?.earliestDeparture ?? null;
      body.earliestDepartureOverride = formDep === defaultDep ? null : formDep;

      body.pickupPrefsOverride = form.pickupPrefsOverride;
    } else if (form.role === "passenger") {
      // R4: 同乗者 = rider + 確約運転手（必須・上で検証済み）。
      body.fixedDriverMemberId = form.fixedDriverMemberId;
      body.notes = form.notes.trim() || null;
    } else if (form.role === "rider") {
      // R4: 同乗希望 = rider で確約なし（明示 null でクリア）。
      body.fixedDriverMemberId = null;
      body.notes = form.notes.trim() || null;
    }

    const exists = participations.some((p) => p.memberId === form.memberId);

    try {
      // R7: 乗車エリアの変更を本人プロフィール（home_node_id）へ反映する。
      // members API の homeAreaName と同じ規約: 同名の kind=area ノードを再利用、
      // 無ければ作成してから PATCH /members/[id]（大会別 override は作らない）。
      if (needsHomeArea) {
        const member = memberById.get(form.memberId);
        const currentName = member?.homeNodeId
          ? (nodeById.get(member.homeNodeId)?.name ?? null)
          : null;
        if (homeAreaName !== currentName) {
          let nodeId = nodes.find(
            (n) => n.kind === "area" && n.name === homeAreaName,
          )?.id;
          if (!nodeId) {
            const created = await postCarpool<{
              node: NodeDTO;
              geocode?: { resolvedTitle: string; exact: boolean } | null;
            }>(`/clubs/${slug}/nodes`, { actorName, kind: "area", name: homeAreaName });
            nodeId = created.node.id;
            // 入力名と解決先が違ったら確認バナーを出す（exact=true は静か）。
            if (created.geocode && created.geocode.exact === false) {
              setAreaGeocodeNotice({
                input: homeAreaName,
                resolved: created.geocode.resolvedTitle,
              });
            }
          }
          await patchCarpool(`/clubs/${slug}/members/${form.memberId}`, {
            actorName,
            homeNodeId: nodeId,
          });
        }
      }

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

  // 既に参加行がある member（検出パネルから除外する）。
  const participatedMemberIds = useMemo(
    () => new Set(participations.map((p) => p.memberId)),
    [participations],
  );

  // 検出パネルに出す行（既に参加登録済みの member は出さない）。
  // ②の並びを踏襲: 検出はすべてクラブ一致のため氏名順（ja）に並び替える（自分を見つけやすく）。
  // 並び替えはこの base 配列で一度だけ行い、detKey(d, i) の index 整合を render / bulk と共有する。
  const pendingDetected = useMemo(
    () =>
      sortDetectedByName(
        detected.filter((d) => !d.memberId || !participatedMemberIds.has(d.memberId)),
      ),
    [detected, participatedMemberIds],
  );

  // 名前検索で実際に表示される行（任意絞込）。index は base(pendingDetected)のものを保持し、
  // detKey/選択/bulk の対応を崩さない。空クエリは全行表示。
  const detRowVisible = useCallback(
    (d: (typeof pendingDetected)[number]) =>
      matchesNameQuery(d.memberId ? memberName(d.memberId) : detectedDisplayName(d), nameQuery),
    [nameQuery, memberName],
  );

  // 表示中（=検索一致）の検出行だけを対象に選択・一括登録する。
  const visibleDetected = useMemo(
    () =>
      pendingDetected
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => detRowVisible(d)),
    [pendingDetected, detRowVisible],
  );

  const selectedKeys = useMemo(
    () =>
      visibleDetected
        .map(({ d, i }) => detKey(d, i))
        .filter((k) => selectedDet[k]),
    [visibleDetected, selectedDet],
  );

  const allSelected =
    visibleDetected.length > 0 &&
    visibleDetected.every(({ d, i }) => selectedDet[detKey(d, i)]);

  const toggleSelectAll = () => {
    if (allSelected) {
      // 表示中の行だけ解除（検索で隠れている選択は保持）。
      setSelectedDet((s) => {
        const next = { ...s };
        for (const { d, i } of visibleDetected) next[detKey(d, i)] = false;
        return next;
      });
    } else {
      // 表示中の行だけ全選択（検索で隠れている選択は保持）。
      setSelectedDet((s) => {
        const next = { ...s };
        for (const { d, i } of visibleDetected) next[detKey(d, i)] = true;
        return next;
      });
    }
  };

  // 削除（誤検出・キャンセル用）。?memberId=&actorName= で DELETE。
  const deleteParticipation = async (memberId: string) => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `${memberName(memberId)} の参加情報を削除しますか？`,
      );
      if (!ok) return;
    }
    // 調整さんモデル: 削除対象メンバーの displayName を actorName に使う。
    const actorName = memberName(memberId);
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
    if (selectedKeys.length === 0) return;
    // 調整さんモデル: 一括登録は複数メンバーをまたぐためメンバー文脈がない → "guest"。
    const actorName = "guest";
    setBulkSaving(true);
    setBulkError(null);

    // 表示中（検索一致）かつ選択中の行だけを対象にする（selectedKeys と件数を一致させる）。
    const entries: Array<Record<string, unknown>> = [];
    for (const { d, i } of visibleDetected) {
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

    // m2: bulk API は 1 リクエスト 30 件上限。31 件以上の選択は無言で切り捨てず、
    // 30 件ずつのチャンクに分割して順次送信する（サーバ変更なし）。失敗は集約表示。
    try {
      const chunks = chunkBulkEntries(entries);
      let okCount = 0;
      const failures: string[] = [];
      for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c];
        try {
          await postCarpool(`/clubs/${slug}/events/${eventId}/participations/bulk`, {
            actorName,
            entries: chunk,
          });
          okCount += chunk.length;
        } catch (err) {
          failures.push(
            `${c + 1}組目（${chunk.length}人）: ${err instanceof Error ? err.message : "失敗"}`,
          );
        }
      }

      if (failures.length === 0) {
        toast(`${okCount} 人を参加登録しました`, "success");
      } else {
        if (okCount > 0) toast(`${okCount} 人は登録できました`, "success");
        setBulkError(`一部の一括登録に失敗しました — ${failures.join(" ／ ")}`);
      }
      // 成功分は再読込で検出パネルから消えるため、選択状態は常にリセットする
      // （行 index ベースのキーが再読込でずれるのを防ぐ。失敗分は再選択して再試行）。
      setSelectedDet({});
      setNameInputs({});
      await load();
    } finally {
      setBulkSaving(false);
    }
  };

  // M4: 検出行の単独クイック登録（運転手/同乗希望）。本人以外による代理操作を想定し、
  // actor_name は操作者のまま change_log に残る（既存設計どおり）。
  // 未登録メンバーは member 作成（athleteKey=検出 nameKey）込みで participation upsert する。
  const quickRegister = async (
    d: DetectedEntry,
    i: number,
    role: QuickRole,
    seatsInput?: string,
    fixedDriverMemberId?: string,
  ) => {
    const key = detKey(d, i);
    setQuickSavingKey(key);
    setSeatsAskKey(null);
    setDriverAskKey(null);
    setBulkError(null);
    try {
      const plan = planQuickRegister(
        {
          memberId: d.memberId,
          nameKey: d.nameKey,
          rawName: d.rawName ?? null,
          className: d.className || null,
          displayNameInput: nameInputs[key] ?? null,
          // R5: 運転手登録時の同乗可能人数（最小ステップの入力。未入力なら付与しない）。
          seatsInput: seatsInput ?? null,
          // B: 同乗者登録時の確約運転手 member id（最小ステップで選択）。
          fixedDriverMemberId: fixedDriverMemberId ?? null,
        },
        role,
      );

      // 調整さんモデル: 登録される本人の displayName を actorName に使う
      // （新規作成なら memberBody.displayName、既存メンバーなら memberName）。
      const actorName = plan.memberBody?.displayName ?? memberName(d.memberId);

      let memberId = d.memberId;
      let displayName = d.memberId ? memberName(d.memberId) : "";
      if (plan.memberBody) {
        const created = await postCarpool<{ member: MemberDTO }>(
          `/clubs/${slug}/members`,
          { actorName, ...plan.memberBody },
        );
        memberId = created.member.id;
        displayName = created.member.displayName;
      }

      await postCarpool(`/clubs/${slug}/events/${eventId}/participations`, {
        actorName,
        memberId,
        role: plan.role,
        className: plan.className,
        entrySource: "auto",
        // B: passenger のみ確約運転手を付帯（driver/rider では plan.fixedDriverMemberId は undefined）。
        ...(plan.fixedDriverMemberId !== undefined
          ? { fixedDriverMemberId: plan.fixedDriverMemberId }
          : {}),
      });

      toast(
        `${displayName} さんを${
          role === "driver"
            ? "運転手"
            : role === "passenger"
              ? "同乗者"
              : "同乗希望"
        }で登録しました`,
        "success",
      );
      // 行 index ベースの選択キーが再読込でずれるため、選択状態はリセットする。
      setSelectedDet({});
      setNameInputs({});
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "登録に失敗しました", "error");
    } finally {
      setQuickSavingKey(null);
    }
  };

  // M4: 登録状況一覧の行タップ → その人をフォームへ読込（代理編集の導線）。
  // major3: 「詳細を編集」セクションを自動展開してからスクロールする。
  const editParticipant = (memberId: string) => {
    loadParticipationIntoForm(memberId);
    setShowEdit(true);
    scrollToForm();
  };

  // 調整さんモデル: 「次にやること」は個人ではなく大会全体の状況案内に簡素化する。
  // 未回答（役割未設定）人数と未登録の検出者数を出し、誰でも対応できることを示す。
  const undecidedCount = useMemo(
    () => participations.filter((p) => p.role === "undecided").length,
    [participations],
  );

  const bannerEl =
    undecidedCount > 0 ? (
      <section className="mb-4 rounded-xl border border-primary/40 bg-primary/10 p-4">
        <p className="text-sm text-foreground">
          役割が未回答の人が {undecidedCount} 人います。下の一覧から名前をタップして役割を設定できます。
        </p>
      </section>
    ) : null;

  // 名前検索は登録済み行（StatusGroup）も横断フィルタする。空クエリは全件。
  const filterRegistered = useCallback(
    (items: ParticipationDTO[]): ParticipationDTO[] =>
      nameQuery.trim()
        ? items.filter((p) => matchesNameQuery(memberName(p.memberId), nameQuery))
        : items,
    [nameQuery, memberName],
  );

  return (
    <div className="min-h-screen">
      {toastEl}
      <CarpoolHeader clubName={club?.name ?? slug} slug={slug} breadcrumbs={[{label: "イベント一覧", href: `/carpool/${slug}`}]} currentPage={event?.name ?? "参加登録"} />

      <main className="mx-auto max-w-2xl px-4 py-6">
        {loading && <p className="text-sm text-muted">読み込み中…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        {!loading && !error && event && (
          <>
            {/* ① イベント情報（major3: 1〜2行のコンパクトヘッダー） */}
            <section className="mb-4 rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="text-base font-bold text-foreground">{event.name}</h1>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[event.status]}`}
                >
                  {STATUS_LABEL[event.status]}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {formatEventDate(event.eventDate)}
                {venueNode ? ` ・ ${venueNode.name}` : ""}
                {event.bulletinUrl && (
                  <>
                    {" ・ "}
                    <a
                      href={event.bulletinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      要綱
                    </a>
                  </>
                )}
              </p>
            </section>

            {/* 大会全体の状況案内バナー（major3: 上部だが視覚的に副次） */}
            {bannerEl}

            {/* ② 参加者（検出者＋登録者を統合した1つの一覧。最上部の主要コンテンツ。
                 旧「あなたはどれ？」カードを廃止し、その名前検索を本一覧の先頭に畳み込んだ。
                 1カード・サブヘッダ区切り＝全体ビュー） */}
            <section className="rounded-xl border border-primary/40 bg-card p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="text-base font-bold text-foreground">
                  参加者（{participations.length}）
                </h2>
                {/* 行を追加: 新しいメンバーを作成してそのままフォームに読み込む。 */}
                <button
                  type="button"
                  onClick={() => setShowAddMember(true)}
                  className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/15"
                >
                  ＋行を追加（新メンバー）
                </button>
              </div>
              <p className="mb-3 text-xs text-muted">
                自分の行のボタンをタップして役割を登録できます（誰の行でも編集できます）。
              </p>

              {/* 名前検索（任意・即時絞込。未登録=JOY検出と登録済みの両方を横断フィルタ。
                  小規模クラブはスクロールで足りるため autoFocus しない＝キーボードを出さない）。 */}
              <input
                className="mb-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="名前で探す（任意）"
                maxLength={40}
              />

              <div className="flex flex-col gap-4">
                {/* 未登録（JOY検出）サブグループ。同一リスト内の先頭に置く（FEATURE B 完全保持）。 */}
                {/* m3: joeEventId の無い手動作成イベントは「JOY 連携なし」案内に出し分け（検出0件と区別）。 */}
                {event.joeEventId === null ? null : detectError ? (
                  <div className="rounded-lg border border-red-500/40 bg-surface p-3">
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
                  </div>
                ) : pendingDetected.length === 0 ? null : (
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDetect((s) => !s)}
                        className="flex min-w-0 items-center gap-2 text-left"
                      >
                        <span className="text-xs font-semibold text-muted">
                          未登録（JOY検出）（{visibleDetected.length}）
                        </span>
                        <span className="text-[10px] text-muted">
                          {showDetect ? "閉じる" : "開く"}
                        </span>
                      </button>
                      {showDetect && (
                        <button
                          type="button"
                          onClick={toggleSelectAll}
                          className="shrink-0 rounded-lg bg-white/10 px-3 py-1 text-[10px] text-foreground hover:bg-white/15"
                        >
                          {allSelected ? "全解除" : "全選択"}
                        </button>
                      )}
                    </div>

                    {showDetect && (
                      <>
                        <ul className="flex flex-col gap-2">
                          {pendingDetected.map((d, i) => {
                            // 名前検索で隠れる行はスキップ（index は base のまま保持）。
                            if (!detRowVisible(d)) return null;
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
                                      {d.className && (
                                        <span className="ml-2 text-xs text-muted">
                                          {d.className}
                                        </span>
                                      )}
                                      {isUnregistered && (
                                        <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-muted">
                                          未登録
                                        </span>
                                      )}
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

                                {/* M4: 行単位クイック登録（本人以外の代理操作。未登録は member 作成込み） */}
                                <div className="mt-2 flex flex-wrap gap-2 pl-6">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // R5: 未登録メンバーは同乗可能人数を聞く最小ステップを挟む。
                                      // B: 同乗者の最小ステップが開いていたら閉じる（同時に1つだけ開く）。
                                      setDriverAskKey(null);
                                      if (isUnregistered) {
                                        setSeatsAskKey((k) => (k === key ? null : key));
                                        setSeatsAskValue("");
                                      } else {
                                        void quickRegister(d, i, "driver");
                                      }
                                    }}
                                    disabled={quickSavingKey !== null || bulkSaving}
                                    className="rounded bg-white/10 px-2 py-1 text-[10px] text-foreground hover:bg-white/15 disabled:opacity-50"
                                  >
                                    {quickSavingKey === key ? "登録中…" : "運転手として登録"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void quickRegister(d, i, "rider")}
                                    disabled={quickSavingKey !== null || bulkSaving}
                                    className="rounded bg-white/10 px-2 py-1 text-[10px] text-foreground hover:bg-white/15 disabled:opacity-50"
                                  >
                                    {quickSavingKey === key ? "登録中…" : "同乗希望として登録"}
                                  </button>
                                  {/* B: 同乗者（乗る車が決まっている）。運転手を選ぶ最小ステップを開く。 */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // B: 運転手の最小ステップ（同乗可能人数）が開いていたら閉じる（同時に1つだけ）。
                                      setSeatsAskKey(null);
                                      setDriverAskKey((k) => (k === key ? null : key));
                                      setDriverAskValue("");
                                    }}
                                    disabled={quickSavingKey !== null || bulkSaving}
                                    className="rounded bg-white/10 px-2 py-1 text-[10px] text-foreground hover:bg-white/15 disabled:opacity-50"
                                  >
                                    {quickSavingKey === key ? "登録中…" : "同乗者として登録"}
                                  </button>
                                </div>

                                {/* R5: 運転手クイック登録の最小ステップ（同乗可能人数） */}
                                {seatsAskKey === key && (
                                  <div className="mt-2 flex items-end gap-2 pl-6">
                                    <div className="min-w-0">
                                      <label className="mb-1 block text-[10px] text-muted">
                                        自分以外にあと何人乗せられますか？（空欄可）
                                      </label>
                                      <input
                                        type="number"
                                        min={0}
                                        max={20}
                                        className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                                        value={seatsAskValue}
                                        onChange={(e) => setSeatsAskValue(e.target.value)}
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => void quickRegister(d, i, "driver", seatsAskValue)}
                                      disabled={quickSavingKey !== null || bulkSaving}
                                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-dark disabled:opacity-50"
                                    >
                                      運転手で登録
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setSeatsAskKey(null)}
                                      className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/15"
                                    >
                                      キャンセル
                                    </button>
                                  </div>
                                )}

                                {/* B: 同乗者クイック登録の最小ステップ（乗る車＝運転手を選択） */}
                                {driverAskKey === key && (
                                  <div className="mt-2 flex items-end gap-2 pl-6">
                                    <div className="min-w-0 flex-1">
                                      <label className="mb-1 block text-[10px] text-muted">
                                        乗る車（運転手）を選択
                                      </label>
                                      <select
                                        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
                                        value={driverAskValue}
                                        onChange={(e) => setDriverAskValue(e.target.value)}
                                        disabled={driverParticipations.length === 0}
                                      >
                                        <option value="">選択してください</option>
                                        {driverParticipations.map((p) => (
                                          <option key={p.memberId} value={p.memberId}>
                                            {memberName(p.memberId)}
                                          </option>
                                        ))}
                                      </select>
                                      {driverParticipations.length === 0 && (
                                        <p className="mt-1 text-[10px] text-muted">
                                          先に運転手を登録してください
                                        </p>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void quickRegister(
                                          d,
                                          i,
                                          "passenger",
                                          undefined,
                                          driverAskValue,
                                        )
                                      }
                                      disabled={
                                        quickSavingKey !== null ||
                                        bulkSaving ||
                                        !driverAskValue
                                      }
                                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-dark disabled:opacity-50"
                                    >
                                      同乗者で登録
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDriverAskKey(null)}
                                      className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/15"
                                    >
                                      キャンセル
                                    </button>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>

                        {/* 検索で未登録行が全部隠れたときの案内（pendingDetected はあるが一致0）。 */}
                        {visibleDetected.length === 0 && (
                          <p className="text-xs text-muted">
                            「{nameQuery}」に一致する未登録の人はいません。
                          </p>
                        )}

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
                  </div>
                )}

                {/* 登録済みの参加者（役割グループをサブヘッダとして同一カード内に表示） */}
                <StatusGroup
                  title="運転手"
                  items={filterRegistered(
                    participations.filter((p) => p.role === "driver"),
                  )}
                  onDelete={deleteParticipation}
                  onEdit={editParticipant}
                  render={(p) => {
                    const m = memberById.get(p.memberId);
                    const seats = p.capacityOverrideSeats ?? m?.seatsAvailable ?? null;
                    return (
                      <span>
                        {memberName(p.memberId)}
                        {p.className && (
                          <span className="ml-2 text-xs text-accent">{p.className}</span>
                        )}
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
                {/* R4: 同乗者（確約あり）と同乗希望（確約なし）を別グループ表示 */}
                <StatusGroup
                  title="同乗者（乗る車が決まっている）"
                  items={filterRegistered(
                    participations.filter(
                      (p) => p.role === "rider" && p.fixedDriverMemberId,
                    ),
                  )}
                  onDelete={deleteParticipation}
                  onEdit={editParticipant}
                  render={(p) => (
                    <span>
                      {memberName(p.memberId)}
                      {p.className && (
                        <span className="ml-2 text-xs text-accent">{p.className}</span>
                      )}
                      <span className="ml-2 text-xs text-accent">
                        → {memberName(p.fixedDriverMemberId)} の車
                      </span>
                      {/* M5: 確約先が現在 driver でない（役割変更等の事後不整合）場合の警告 */}
                      {p.fixedDriverMemberId &&
                        !currentDriverIds.has(p.fixedDriverMemberId) && (
                          <span className="ml-2 text-xs text-red-400">
                            ⚠ 確約先が運転手ではありません
                          </span>
                        )}
                    </span>
                  )}
                />
                <StatusGroup
                  title="同乗希望"
                  items={filterRegistered(
                    participations.filter(
                      (p) => p.role === "rider" && !p.fixedDriverMemberId,
                    ),
                  )}
                  onDelete={deleteParticipation}
                  onEdit={editParticipant}
                  render={(p) => (
                    <span>
                      {memberName(p.memberId)}
                      {p.className && (
                        <span className="ml-2 text-xs text-accent">{p.className}</span>
                      )}
                    </span>
                  )}
                />
                <StatusGroup
                  title="自力で行く"
                  compact
                  items={filterRegistered(
                    participations.filter((p) => p.role === "self"),
                  )}
                  onDelete={deleteParticipation}
                  onEdit={editParticipant}
                  render={(p) => <span>{memberName(p.memberId)}</span>}
                />
                <StatusGroup
                  title="不参加"
                  compact
                  items={filterRegistered(
                    participations.filter((p) => p.role === "absent"),
                  )}
                  onDelete={deleteParticipation}
                  onEdit={editParticipant}
                  render={(p) => <span>{memberName(p.memberId)}</span>}
                />
                <StatusGroup
                  title="回答待ち"
                  compact
                  muted
                  items={filterRegistered(
                    participations.filter((p) => p.role === "undecided"),
                  )}
                  onDelete={deleteParticipation}
                  onEdit={editParticipant}
                  editLabel="役割を設定"
                  render={(p) => (
                    <span>
                      {memberName(p.memberId)}
                      {p.className && (
                        <span className="ml-2 text-xs text-accent">{p.className}</span>
                      )}
                    </span>
                  )}
                />

                {/* 統合一覧が空（登録者も検出未登録者もいない）の場合の案内 */}
                {participations.length === 0 &&
                  (event.joeEventId === null || pendingDetected.length === 0) && (
                    <p className="text-sm text-muted">
                      {event.joeEventId === null
                        ? "まだ参加者がいません。「＋行を追加」から参加者を登録してください。"
                        : "まだ参加者がいません。JOY エントリーからの未登録者もありません。"}
                    </p>
                  )}
              </div>
            </section>

            {/* ③ 詳細を編集（major3: 既定は閉じる。行タップ/行追加で自動展開） */}
            <section id="edit-section" className="mb-6 mt-6">
              <button
                type="button"
                onClick={() => setShowEdit((s) => !s)}
                className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left"
                aria-expanded={showEdit}
              >
                <span className="text-sm font-semibold text-foreground">
                  詳細を編集（座席数・出発時刻・拾える場所など）
                </span>
                <span className="text-xs text-muted">{showEdit ? "閉じる" : "開く"}</span>
              </button>

              {showEdit && (
            <form
              onSubmit={submit}
              className="mt-3 flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {form.memberId
                    ? `${memberName(form.memberId)} さんの参加を登録`
                    : "参加登録"}
                </h2>
              </div>

              <div className="flex flex-col gap-4">
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

              {/* ロール 5 分割セグメント（R4: 同乗者を追加） */}
              <div>
                <span className="mb-1 block text-xs text-muted">参加方法</span>
                <div className="flex overflow-hidden rounded-lg border border-border bg-surface">
                  {ROLE_SEGMENTS.map((seg) => (
                    <button
                      key={seg.value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, role: seg.value }))}
                      className={cn(
                        "flex-1 px-1 py-2 text-center text-xs font-medium",
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

              {/* R7: 乗車エリア（運転手・同乗者・同乗希望に必須。配車割当の起点） */}
              {(form.role === "driver" ||
                form.role === "passenger" ||
                form.role === "rider") && (
                <div className="rounded-lg bg-surface p-3">
                  <label className="mb-1 block text-xs text-muted">
                    乗車エリア（自宅の最寄り駅・地区など）※必須
                  </label>
                  {form.memberId &&
                    !memberById.get(form.memberId)?.homeNodeId &&
                    !homeAreaInput.trim() && (
                      <p className="mb-1 rounded-md bg-red-500/10 px-2 py-1 text-[11px] text-red-400">
                        乗車エリアが未設定です。設定しないと配車の割当ができません
                      </p>
                    )}

                  {/* major1: 登録済みの場所（area / pickup ノード名）をチップで選ぶ。
                      該当チップが無いときだけ「その他（入力）」でテキスト入力にフォールバックする。
                      クラブに場所が 0 件（初期）ならチップを出さずテキスト入力のみ。 */}
                  {areaChipNames.length > 0 && !areaOtherOpen ? (
                    <div className="flex flex-wrap gap-2">
                      {areaChipNames.map((name) => {
                        const selected = homeAreaInput.trim() === name;
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => setHomeAreaInput(name)}
                            className={cn(
                              "rounded-full px-3 py-1.5 text-xs",
                              selected
                                ? "bg-primary text-white"
                                : "bg-background text-foreground hover:bg-white/10",
                            )}
                          >
                            {name}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          setAreaOtherOpen(true);
                          // チップ該当値だった場合はクリアして入力を促す。
                          if (areaChipNames.includes(homeAreaInput.trim())) {
                            setHomeAreaInput("");
                          }
                        }}
                        className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                      >
                        その他（入力）
                      </button>
                    </div>
                  ) : (
                    <div>
                      <input
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                        value={homeAreaInput}
                        onChange={(e) => setHomeAreaInput(e.target.value)}
                        placeholder="例: 八王子駅"
                        maxLength={80}
                      />
                      {areaChipNames.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setAreaOtherOpen(false)}
                          className="mt-1 text-[10px] text-accent hover:underline"
                        >
                          一覧から選ぶ
                        </button>
                      )}
                    </div>
                  )}

                  <p className="mt-1 text-[10px] text-muted">
                    {form.role === "driver"
                      ? "出発地として配車計算に使われます。"
                      : "ここを起点に乗車地点・迎えが割り当てられます。"}
                    変更すると本人のプロフィール（自宅エリア）も更新されます。
                  </p>
                  {/* 再発防止 UX: 入力名と解決先が違う（exact=false）ときの小さな確認バナー。
                      toast に warning レベルが無いため、赤(error)と区別した amber ボックスで出す。 */}
                  {areaGeocodeNotice && (
                    <div className="mt-2 rounded-md border border-yellow-400/50 bg-yellow-400/10 px-2 py-1.5 text-[11px] text-yellow-200">
                      「
                      <span className="font-semibold">{areaGeocodeNotice.input}</span>
                      」→「
                      <span className="font-semibold">
                        {areaGeocodeNotice.resolved || "別の地点"}
                      </span>
                      」に設定しました。違う場合は
                      <a
                        href={`/carpool/${slug}/masters`}
                        className="underline hover:text-white"
                      >
                        マスタの「場所」
                      </a>
                      で地図調整できます。
                    </div>
                  )}
                </div>
              )}

              {/* 運転手フィールド */}
              {form.role === "driver" && (
                <div className="flex flex-col gap-4 rounded-lg bg-surface p-3">
                  <p className="text-[11px] text-muted">
                    プロフィールの既定値を表示しています。この大会だけ変えたいときは上書きしてください（未変更ならプロフィールの値が使われます）。
                  </p>
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
                    <label className="mb-1 block text-xs text-muted">
                      最早出発（15分きざみ）
                    </label>
                    <input
                      type="time"
                      // R3: 15分刻み。既存の15分外の値は step を緩めて壊さない。
                      step={quarterHourStep(form.earliestDepartureOverride)}
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
                    <span className="mb-1 block text-xs text-muted">
                      同乗者を拾える場所（運転手として立ち寄れる地点）
                    </span>
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

              {/* 同乗者フィールド（R4: 乗る車が決まっている人。運転手の選択が必須） */}
              {form.role === "passenger" && (
                <div className="flex flex-col gap-4 rounded-lg bg-surface p-3">
                  <div>
                    <label className="mb-1 block text-xs text-muted">
                      乗る車（運転手）※必須
                    </label>
                    <select
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={form.fixedDriverMemberId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, fixedDriverMemberId: e.target.value }))
                      }
                    >
                      <option value="">選択してください</option>
                      {driverParticipations.map((p) => (
                        <option key={p.memberId} value={p.memberId}>
                          {memberName(p.memberId)}
                        </option>
                      ))}
                    </select>
                    {driverParticipations.length === 0 && (
                      <p className="mt-1 text-[10px] text-muted">
                        まだ運転手がいません。運転手の登録後に選択できます。
                      </p>
                    )}
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

              {/* 同乗希望フィールド（R4: 確約なし。配車割り当てを待つ） */}
              {form.role === "rider" && (
                <div className="flex flex-col gap-4 rounded-lg bg-surface p-3">
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
              {/*
                スタート時刻は Phase 4（スタートリスト PDF 取込）までは手入力のまま。
                クラスは検出結果からプリフィルされる（指摘3）が、スタート時刻の自動補完は対象外。
              */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">
                    スタート時刻（わかれば）
                  </label>
                  <input
                    type="time"
                    // R3: 手入力は15分刻み。自動設定（Phase 4 予定）の分単位値は step を緩めて保持。
                    step={quarterHourStep(form.startTime)}
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
              </div>
            </form>
              )}
            </section>

            {/* ④ 配車係向け（major3: 取込・配車計画・公開などの主催者向けツールをまとめる） */}
            <section className="mt-6 rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">配車係向け</h2>
              <p className="mt-1 text-xs text-muted">
                参加者の取込や配車計画の作成・公開を行います（普段の役割登録は上の「参加者」一覧から）。
              </p>

              {/* スタートリスト取込（発行書類 / URL / テキスト → 参加へ反映） */}
              <div className="mt-3">
                <StartlistImport
                  slug={slug}
                  eventId={eventId}
                  actorName="guest"
                  members={members}
                  onApplied={() => void load()}
                />
              </div>

              {/* 次のステップ: 配車計画（Phase 3 実装済み） */}
              {planSummary.ready && (
                <div className="mt-4 rounded-lg border border-primary/40 bg-surface p-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    次のステップ: 配車計画の作成
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    確定参加 {planSummary.participantCount} 人・運転手{" "}
                    {planSummary.driverCount} 台が揃っています。
                    最適化を実行して配車案を作り、公開すると全員が結果ページで見られます。
                  </p>
                  <Link
                    href={`/carpool/${slug}/${eventId}/plan`}
                    className="mt-3 block w-full rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-white hover:bg-primary-dark"
                  >
                    配車計画を作成・調整する
                  </Link>
                  <Link
                    href={`/carpool/${slug}/${eventId}/result`}
                    className="mt-2 block w-full rounded-lg bg-white/10 px-4 py-2 text-center text-sm text-foreground hover:bg-white/15"
                  >
                    配車結果を見る（公開後）
                  </Link>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {showAddMember && (
        <AddMemberModal
          slug={slug}
          onCreated={(m) => {
            // 作成したメンバーを一覧に足し、そのままフォームに読み込む（行追加の導線）。
            setMembers((prev) =>
              prev.some((x) => x.id === m.id) ? prev : [...prev, m],
            );
            loadParticipationIntoForm(m.id);
            scrollToForm();
            setShowAddMember(false);
          }}
          onClose={() => setShowAddMember(false)}
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
  onEdit,
  editLabel,
}: {
  title: string;
  items: ParticipationDTO[];
  render: (p: ParticipationDTO) => React.ReactNode;
  compact?: boolean;
  muted?: boolean;
  onDelete?: (memberId: string) => void;
  /** M4: 行タップでその人をフォームへ読込（代理編集の導線）。 */
  onEdit?: (memberId: string) => void;
  /** M4: 編集ボタンを明示したいとき（例: 回答待ちの「役割を設定」）。 */
  editLabel?: string;
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
            {onEdit ? (
              <button
                type="button"
                onClick={() => onEdit(p.memberId)}
                className="min-w-0 flex-1 text-left"
                title="タップしてフォームに読み込む"
              >
                {render(p)}
              </button>
            ) : (
              <span className="min-w-0">{render(p)}</span>
            )}
            <span className="flex shrink-0 items-center gap-1">
              {onEdit && editLabel && (
                <button
                  type="button"
                  onClick={() => onEdit(p.memberId)}
                  className="rounded bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/30"
                >
                  {editLabel}
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(p.memberId)}
                  className="rounded px-2 py-0.5 text-[10px] text-muted hover:text-red-400"
                  aria-label="削除"
                >
                  削除
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
