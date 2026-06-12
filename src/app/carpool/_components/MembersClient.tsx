"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchCarpool, postCarpool, patchCarpool } from "./carpoolFetch";
import { useActor } from "./useActor";
import { useToast } from "./Toast";
import ActorModal from "./ActorModal";
import CarpoolHeader from "./CarpoolHeader";
import { useAthleteSuggest } from "./useAthleteSuggest";
import { athleteSelectionToFields } from "@/lib/carpool/suggest";
import { normalizeNameKey } from "@/lib/name-key";
import type {
  ClubDTO,
  MemberDTO,
  NodeDTO,
  PickupPrefDTO,
} from "@/lib/carpool/api/mappers";
import type { AthleteSuggestion } from "./carpoolTypes";

interface MembersClientProps {
  slug: string;
}

type Willingness = "always" | "if_needed";

interface MemberForm {
  displayName: string;
  homeNodeId: string | null;
  hasCar: boolean;
  seatsAvailable: string; // 入力中は文字列
  defaultWillingness: Willingness;
  earliestDeparture: string; // HH:MM or ""
  luggageInCar: boolean;
  pickupPrefs: PickupPrefDTO[];
  athleteKey: string | null;
  active: boolean;
}

const EMPTY_FORM: MemberForm = {
  displayName: "",
  homeNodeId: null,
  hasCar: false,
  seatsAvailable: "",
  defaultWillingness: "if_needed",
  earliestDeparture: "",
  // 既定 true（02 §carpool_members の DB 既定に合わせる）
  luggageInCar: true,
  pickupPrefs: [],
  athleteKey: null,
  active: true,
};

function memberToForm(m: MemberDTO): MemberForm {
  return {
    displayName: m.displayName,
    homeNodeId: m.homeNodeId,
    hasCar: m.hasCar,
    seatsAvailable: m.seatsAvailable === null ? "" : String(m.seatsAvailable),
    defaultWillingness: m.defaultWillingness,
    earliestDeparture: m.earliestDeparture ?? "",
    luggageInCar: m.luggageInCar,
    pickupPrefs: m.pickupPrefs ?? [],
    athleteKey: m.athleteKey,
    active: m.active,
  };
}

export default function MembersClient({ slug }: MembersClientProps) {
  const { toast, toastEl } = useToast();

  const [club, setClub] = useState<ClubDTO | null>(null);
  const [members, setMembers] = useState<MemberDTO[]>([]);
  const [nodes, setNodes] = useState<NodeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showActorModal, setShowActorModal] = useState(false);

  const { actorName, ready, setActorMember } = useActor(slug, members);

  // 編集状態: null=非表示, "new"=追加, それ以外=メンバー id
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<MemberForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 新エリア inline 追加
  const [addingArea, setAddingArea] = useState(false);
  const [newAreaName, setNewAreaName] = useState("");

  // 選手検索
  const [athleteQuery, setAthleteQuery] = useState("");
  const [athleteResults, setAthleteResults] = useState<AthleteSuggestion[]>([]);
  const [athleteSearching, setAthleteSearching] = useState(false);
  const [athleteError, setAthleteError] = useState<string | null>(null);

  // 指摘4: 表示名のインクリメンタル正規候補サジェスト（debounce 付き）。
  // 候補選択で displayName=正規氏名・athleteKey=normalizeNameKey(正規氏名) を同時設定。
  const nameSuggest = useAthleteSuggest();

  const pickNameCandidate = (canonicalName: string) => {
    const fields = athleteSelectionToFields(canonicalName);
    setForm((f) => ({
      ...f,
      displayName: fields.displayName,
      athleteKey: fields.athleteKey,
    }));
    nameSuggest.dismiss();
  };

  const areaNodes = useMemo(() => nodes.filter((n) => n.kind === "area"), [nodes]);
  const pickableNodes = useMemo(() => nodes.filter((n) => n.kind !== "venue"), [nodes]);
  const nodeName = (id: string | null): string | null =>
    id ? (nodes.find((n) => n.id === id)?.name ?? null) : null;

  const load = async () => {
    setLoading(true);
    try {
      const [clubRes, membersRes, nodesRes] = await Promise.all([
        fetchCarpool<{ club: ClubDTO }>(`/clubs/${slug}`),
        fetchCarpool<{ members: MemberDTO[] }>(`/clubs/${slug}/members`),
        fetchCarpool<{ nodes: NodeDTO[] }>(`/clubs/${slug}/nodes`),
      ]);
      setClub(clubRes.club);
      setMembers(membersRes.members);
      setNodes(nodesRes.nodes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const requireActor = (): boolean => {
    if (ready && !actorName) {
      setShowActorModal(true);
      return false;
    }
    return true;
  };

  const openNew = () => {
    if (!requireActor()) return;
    setForm(EMPTY_FORM);
    setEditing("new");
    setFormError(null);
    setAddingArea(false);
    setAthleteQuery("");
    setAthleteResults([]);
    nameSuggest.clear();
  };

  const openEdit = (m: MemberDTO) => {
    if (!requireActor()) return;
    setForm(memberToForm(m));
    setEditing(m.id);
    setFormError(null);
    setAddingArea(false);
    setAthleteQuery("");
    setAthleteResults([]);
    nameSuggest.clear();
  };

  const closeForm = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const togglePickupPref = (nodeId: string) => {
    setForm((f) => {
      const exists = f.pickupPrefs.find((p) => p.nodeId === nodeId);
      if (!exists) {
        return { ...f, pickupPrefs: [...f.pickupPrefs, { nodeId, strength: "soft" }] };
      }
      return { ...f, pickupPrefs: f.pickupPrefs.filter((p) => p.nodeId !== nodeId) };
    });
  };

  const setPickupStrength = (nodeId: string, strength: "hard" | "soft") => {
    setForm((f) => ({
      ...f,
      pickupPrefs: f.pickupPrefs.map((p) =>
        p.nodeId === nodeId ? { ...p, strength } : p,
      ),
    }));
  };

  const addArea = async () => {
    if (!actorName) {
      setShowActorModal(true);
      return;
    }
    const name = newAreaName.trim();
    if (!name) return;
    try {
      const data = await postCarpool<{ node: NodeDTO }>(`/clubs/${slug}/nodes`, {
        actorName,
        kind: "area",
        name,
      });
      setNodes((prev) => [...prev, data.node]);
      setForm((f) => ({ ...f, homeNodeId: data.node.id }));
      setNewAreaName("");
      setAddingArea(false);
      toast("エリアを追加しました", "success");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "エリア追加に失敗しました");
    }
  };

  const runAthleteSearch = async () => {
    const q = athleteQuery.trim();
    if (q.length < 2) return;
    setAthleteSearching(true);
    setAthleteError(null);
    try {
      // trails.jp 既存 API（/api/athletes/search）。carpool 配下ではないため
      // fetchCarpool（/api/carpool 前置）は使わず素の fetch で呼ぶ。
      const res = await fetch(`/api/athletes/search?q=${encodeURIComponent(q)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`選手検索に失敗しました（HTTP ${res.status}）`);
      }
      const data = (await res.json()) as { athletes: AthleteSuggestion[] };
      setAthleteResults(data.athletes ?? []);
    } catch (e) {
      setAthleteResults([]);
      setAthleteError(
        e instanceof Error ? e.message : "選手検索に失敗しました。再試行してください。",
      );
    } finally {
      setAthleteSearching(false);
    }
  };

  const selectAthlete = (a: AthleteSuggestion) => {
    setForm((f) => ({ ...f, athleteKey: normalizeNameKey(a.name) }));
    setAthleteQuery(a.name);
    setAthleteResults([]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actorName) {
      setShowActorModal(true);
      return;
    }
    if (!form.displayName.trim()) {
      setFormError("表示名を入力してください");
      return;
    }
    setSaving(true);
    setFormError(null);

    const seats =
      form.hasCar && form.seatsAvailable !== ""
        ? Number(form.seatsAvailable)
        : null;

    const body: Record<string, unknown> = {
      actorName,
      displayName: form.displayName.trim(),
      homeNodeId: form.homeNodeId,
      hasCar: form.hasCar,
      athleteKey: form.athleteKey,
      active: form.active,
    };
    if (form.hasCar) {
      body.seatsAvailable = seats;
      body.defaultWillingness = form.defaultWillingness;
      body.earliestDeparture = form.earliestDeparture || null;
      body.luggageInCar = form.luggageInCar;
      body.pickupPrefs = form.pickupPrefs;
    } else {
      // 非ドライバ時はドライバ系をクリア
      body.seatsAvailable = null;
      body.earliestDeparture = null;
      body.luggageInCar = false;
      body.pickupPrefs = [];
    }

    try {
      if (editing === "new") {
        await postCarpool(`/clubs/${slug}/members`, body);
        toast("メンバーを追加しました", "success");
      } else if (editing) {
        await patchCarpool(`/clubs/${slug}/members/${editing}`, body);
        toast("メンバーを更新しました", "success");
      }
      closeForm();
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

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
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-foreground">メンバー</h1>
          <button
            type="button"
            onClick={openNew}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            ＋メンバー追加
          </button>
        </div>

        {loading && <p className="text-sm text-muted">読み込み中…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        {!loading && !error && (
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => openEdit(m)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-left hover:bg-card-hover ${
                    m.active ? "" : "opacity-50"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {m.displayName}
                      {!m.active && (
                        <span className="ml-2 text-[10px] text-muted">非表示</span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {nodeName(m.homeNodeId) ?? "エリア未設定"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {m.hasCar && (
                      <span className="rounded bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                        車あり{m.seatsAvailable !== null ? ` +${m.seatsAvailable}` : ""}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
            {members.length === 0 && (
              <li className="text-sm text-muted">メンバーがまだいません。</li>
            )}
          </ul>
        )}

        {editing !== null && (
          <form
            onSubmit={submit}
            className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
          >
            <h2 className="text-sm font-semibold text-foreground">
              {editing === "new" ? "メンバー追加" : "メンバー編集"}
            </h2>

            <div>
              <label className="mb-1 block text-xs text-muted">表示名</label>
              <input
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                value={form.displayName}
                onChange={(e) => {
                  setForm((f) => ({ ...f, displayName: e.target.value }));
                  nameSuggest.setQuery(e.target.value);
                }}
                maxLength={40}
                required
              />
              {nameSuggest.results.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1 rounded-lg bg-surface p-1">
                  {nameSuggest.results.map((a) => (
                    <li key={a.name}>
                      <button
                        type="button"
                        onClick={() => pickNameCandidate(a.name)}
                        className="w-full rounded px-2 py-1 text-left text-sm text-foreground hover:bg-card-hover"
                      >
                        {a.name}
                        {a.clubs.length > 0 && (
                          <span className="ml-2 text-xs text-muted">
                            {a.clubs.join(", ")}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[10px] text-muted">
                候補から選ぶと JOY エントリーの自動検出が確実になります（一覧に無ければそのまま入力でOK）。
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted">自宅エリア</label>
              <select
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                value={addingArea ? "__new__" : (form.homeNodeId ?? "")}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setAddingArea(true);
                  } else {
                    setAddingArea(false);
                    setForm((f) => ({ ...f, homeNodeId: e.target.value || null }));
                  }
                }}
              >
                <option value="">未設定</option>
                {areaNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
                <option value="__new__">新しいエリアを追加...</option>
              </select>
              {addingArea && (
                <div className="mt-2 flex gap-2">
                  <input
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    placeholder="エリア名"
                    value={newAreaName}
                    onChange={(e) => setNewAreaName(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={addArea}
                    className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary-dark"
                  >
                    追加
                  </button>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.hasCar}
                onChange={(e) => setForm((f) => ({ ...f, hasCar: e.target.checked }))}
              />
              車を出せる（運転手になりうる）
            </label>

            {form.hasCar && (
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
                    value={form.seatsAvailable}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, seatsAvailable: e.target.value }))
                    }
                  />
                </div>

                <div>
                  <span className="mb-1 block text-xs text-muted">車を出す頻度</span>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1 text-sm text-foreground">
                      <input
                        type="radio"
                        name="willingness"
                        checked={form.defaultWillingness === "always"}
                        onChange={() =>
                          setForm((f) => ({ ...f, defaultWillingness: "always" }))
                        }
                      />
                      必ず出す
                    </label>
                    <label className="flex items-center gap-1 text-sm text-foreground">
                      <input
                        type="radio"
                        name="willingness"
                        checked={form.defaultWillingness === "if_needed"}
                        onChange={() =>
                          setForm((f) => ({ ...f, defaultWillingness: "if_needed" }))
                        }
                      />
                      必要なら出す
                    </label>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-muted">最早出発</label>
                  <input
                    type="time"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.earliestDeparture}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, earliestDeparture: e.target.value }))
                    }
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={form.luggageInCar}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, luggageInCar: e.target.checked }))
                    }
                  />
                  帰りも同じ車（荷物を置く）
                </label>

                <div>
                  <span className="mb-1 block text-xs text-muted">
                    拾える場所（同乗希望者を乗せられる地点）
                  </span>
                  <ul className="flex flex-col gap-1">
                    {pickableNodes.map((n) => {
                      const pref = form.pickupPrefs.find((p) => p.nodeId === n.id);
                      return (
                        <li
                          key={n.id}
                          className="flex items-center justify-between gap-2 rounded-lg bg-background px-2 py-1.5"
                        >
                          <label className="flex items-center gap-2 text-sm text-foreground">
                            <input
                              type="checkbox"
                              checked={!!pref}
                              onChange={() => togglePickupPref(n.id)}
                            />
                            {n.name}
                          </label>
                          {pref && (
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => setPickupStrength(n.id, "hard")}
                                className={`rounded-lg px-3 py-2 text-xs ${
                                  pref.strength === "hard"
                                    ? "bg-primary text-white"
                                    : "bg-white/10 text-muted"
                                }`}
                              >
                                必須
                              </button>
                              <button
                                type="button"
                                onClick={() => setPickupStrength(n.id, "soft")}
                                className={`rounded-lg px-3 py-2 text-xs ${
                                  pref.strength === "soft"
                                    ? "bg-primary text-white"
                                    : "bg-white/10 text-muted"
                                }`}
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

            <div>
              <label className="mb-1 block text-xs text-muted">
                選手キー（成績データとの紐付け・任意）
              </label>
              <div className="flex gap-2">
                <input
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                  placeholder="氏名で検索"
                  value={athleteQuery}
                  onChange={(e) => setAthleteQuery(e.target.value)}
                />
                <button
                  type="button"
                  onClick={runAthleteSearch}
                  disabled={athleteSearching || athleteQuery.trim().length < 2}
                  className="shrink-0 rounded-lg bg-white/10 px-3 py-2 text-xs text-foreground hover:bg-white/15 disabled:opacity-50"
                >
                  検索
                </button>
              </div>
              {athleteError && (
                <p className="mt-1 text-xs text-red-400">{athleteError}</p>
              )}
              {form.athleteKey && (
                <p className="mt-1 text-xs text-accent">
                  紐付け: {form.athleteKey}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, athleteKey: null }))}
                    className="ml-2 text-muted hover:text-foreground"
                  >
                    解除
                  </button>
                </p>
              )}
              {athleteResults.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1 rounded-lg bg-surface p-1">
                  {athleteResults.map((a) => (
                    <li key={a.name}>
                      <button
                        type="button"
                        onClick={() => selectAthlete(a)}
                        className="w-full rounded px-2 py-1 text-left text-sm text-foreground hover:bg-card-hover"
                      >
                        {a.name}
                        {a.clubs.length > 0 && (
                          <span className="ml-2 text-xs text-muted">
                            {a.clubs.join(", ")}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              一覧に表示する（オフで非表示）
            </label>

            {formError && <p className="text-sm text-red-400">{formError}</p>}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {saving ? "保存中…" : "保存"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15"
              >
                キャンセル
              </button>
            </div>
          </form>
        )}
      </main>

      {showActorModal && (
        <ActorModal
          slug={slug}
          members={members}
          actorName={actorName}
          onSelectMember={(m) => {
            setActorMember(m);
            void load();
            setShowActorModal(false);
          }}
          onClose={() => setShowActorModal(false)}
        />
      )}
    </div>
  );
}
