"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchCarpool, postCarpool, patchCarpool, putCarpool } from "./carpoolFetch";
import { useActor } from "./useActor";
import { useToast } from "./Toast";
import ActorModal from "./ActorModal";
import CarpoolHeader from "./CarpoolHeader";
import { cn } from "@/lib/utils";
import type {
  ClubDTO,
  MemberDTO,
  NodeDTO,
  TravelTimeDTO,
} from "@/lib/carpool/api/mappers";

interface MastersClientProps {
  slug: string;
}

type Tab = "nodes" | "times" | "settings";
type NodeKind = "area" | "pickup" | "venue";

const KIND_LABEL: Record<NodeKind, string> = {
  area: "自宅エリア（最寄り駅など）",
  pickup: "集合・乗車場所",
  venue: "会場・駐車場",
};

export default function MastersClient({ slug }: MastersClientProps) {
  const { toast, toastEl } = useToast();
  const [tab, setTab] = useState<Tab>("nodes");
  const [club, setClub] = useState<ClubDTO | null>(null);
  const [nodes, setNodes] = useState<NodeDTO[]>([]);
  const [travelTimes, setTravelTimes] = useState<TravelTimeDTO[]>([]);
  const [members, setMembers] = useState<MemberDTO[]>([]);
  const { actorName, ready, setActorMember } = useActor(slug, members);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showActorModal, setShowActorModal] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [clubRes, nodesRes, ttRes, membersRes] = await Promise.all([
        fetchCarpool<{ club: ClubDTO }>(`/clubs/${slug}`),
        fetchCarpool<{ nodes: NodeDTO[] }>(`/clubs/${slug}/nodes`),
        fetchCarpool<{ travelTimes: TravelTimeDTO[] }>(`/clubs/${slug}/travel-times`),
        fetchCarpool<{ members: MemberDTO[] }>(`/clubs/${slug}/members`),
      ]);
      setClub(clubRes.club);
      setNodes(nodesRes.nodes);
      setTravelTimes(ttRes.travelTimes);
      setMembers(membersRes.members);
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
        <h1 className="mb-3 text-lg font-bold text-foreground">場所・時間の設定</h1>

        <div className="mb-4 flex overflow-hidden rounded-lg border border-border bg-surface">
          {(
            [
              { value: "nodes", label: "場所" },
              { value: "times", label: "場所どうしの移動時間" },
              { value: "settings", label: "クラブ設定" },
            ] as { value: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={cn(
                "flex-1 py-2 text-center text-sm font-medium",
                tab === t.value
                  ? "bg-primary text-white"
                  : "text-muted hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-muted">読み込み中…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        {!loading && !error && (
          <>
            {tab === "nodes" && (
              <NodesTab
                slug={slug}
                nodes={nodes}
                actorName={actorName}
                requireActor={requireActor}
                onChanged={load}
                toast={toast}
              />
            )}
            {tab === "times" && (
              <TravelTimesTab
                slug={slug}
                nodes={nodes}
                travelTimes={travelTimes}
                actorName={actorName}
                requireActor={requireActor}
                onChanged={load}
                toast={toast}
              />
            )}
            {tab === "settings" && club && (
              <SettingsTab
                slug={slug}
                club={club}
                actorName={actorName}
                requireActor={requireActor}
                onChanged={load}
                toast={toast}
              />
            )}
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
            void load();
            setShowActorModal(false);
          }}
          onClose={() => setShowActorModal(false)}
        />
      )}
    </div>
  );
}

type ToastFn = (message: string, type?: "success" | "error") => void;

// ---------------------------------------------------------------------------
// Tab 1: ノード管理
// ---------------------------------------------------------------------------

interface NodeForm {
  name: string;
  lat: string;
  lng: string;
  parking: boolean;
  note: string;
}

const EMPTY_NODE_FORM: NodeForm = { name: "", lat: "", lng: "", parking: false, note: "" };

function NodesTab({
  slug,
  nodes,
  actorName,
  requireActor,
  onChanged,
  toast,
}: {
  slug: string;
  nodes: NodeDTO[];
  actorName: string | null;
  requireActor: () => boolean;
  onChanged: () => Promise<void>;
  toast: ToastFn;
}) {
  const [subKind, setSubKind] = useState<NodeKind>("area");
  const [editing, setEditing] = useState<string | null>(null); // "new" | id | null
  const [form, setForm] = useState<NodeForm>(EMPTY_NODE_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = useMemo(
    () => nodes.filter((n) => n.kind === subKind),
    [nodes, subKind],
  );

  const openNew = () => {
    if (!requireActor()) return;
    setForm(EMPTY_NODE_FORM);
    setEditing("new");
    setFormError(null);
  };

  const openEdit = (n: NodeDTO) => {
    if (!requireActor()) return;
    setForm({
      name: n.name,
      lat: n.lat === null ? "" : String(n.lat),
      lng: n.lng === null ? "" : String(n.lng),
      parking: n.parking,
      note: n.note ?? "",
    });
    setEditing(n.id);
    setFormError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actorName) return;
    if (!form.name.trim()) {
      setFormError("名前を入力してください");
      return;
    }
    setSaving(true);
    setFormError(null);
    const body: Record<string, unknown> = {
      actorName,
      kind: subKind,
      name: form.name.trim(),
      lat: form.lat !== "" ? Number(form.lat) : null,
      lng: form.lng !== "" ? Number(form.lng) : null,
      parking: subKind === "venue" ? form.parking : false,
      note: form.note.trim() || null,
    };
    try {
      if (editing === "new") {
        await postCarpool(`/clubs/${slug}/nodes`, body);
        toast("ノードを追加しました", "success");
      } else if (editing) {
        await patchCarpool(`/clubs/${slug}/nodes/${editing}`, body);
        toast("ノードを更新しました", "success");
      }
      setEditing(null);
      await onChanged();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {(["area", "pickup", "venue"] as NodeKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setSubKind(k);
              setEditing(null);
            }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm",
              subKind === k
                ? "bg-primary text-white"
                : "bg-white/10 text-muted hover:text-foreground",
            )}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={openNew}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15"
        >
          ＋追加
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {filtered.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => openEdit(n)}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-left hover:bg-card-hover"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{n.name}</p>
                {n.note && <p className="truncate text-xs text-muted">{n.note}</p>}
              </div>
              {n.kind === "venue" && n.parking && (
                <span className="shrink-0 rounded bg-accent/20 px-2 py-0.5 text-[10px] text-accent">
                  駐車場あり
                </span>
              )}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="text-sm text-muted">{KIND_LABEL[subKind]}がまだありません。</li>
        )}
      </ul>

      {editing !== null && (
        <form
          onSubmit={submit}
          className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
        >
          <h3 className="text-sm font-semibold text-foreground">
            {editing === "new" ? `${KIND_LABEL[subKind]}を追加` : `${KIND_LABEL[subKind]}を編集`}
          </h3>
          <div>
            <label className="mb-1 block text-xs text-muted">名前</label>
            <input
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              maxLength={80}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted">緯度（任意）</label>
              <input
                type="number"
                step="any"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                value={form.lat}
                onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">経度（任意）</label>
              <input
                type="number"
                step="any"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
                value={form.lng}
                onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
              />
            </div>
          </div>
          {subKind === "venue" && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.parking}
                onChange={(e) => setForm((f) => ({ ...f, parking: e.target.checked }))}
              />
              駐車場あり
            </label>
          )}
          <div>
            <label className="mb-1 block text-xs text-muted">メモ（任意）</label>
            <textarea
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
              rows={2}
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              maxLength={500}
            />
          </div>
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
              onClick={() => setEditing(null)}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm text-foreground hover:bg-white/15"
            >
              キャンセル
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: 移動時間（Phase 3 で動的算出予定）
// ---------------------------------------------------------------------------

interface NewTimeRow {
  fromNodeId: string;
  toNodeId: string;
  mode: "car" | "transit";
  minutes: string;
}

function TravelTimesTab({
  slug,
  nodes,
  travelTimes,
  actorName,
  requireActor,
  onChanged,
  toast,
}: {
  slug: string;
  nodes: NodeDTO[];
  travelTimes: TravelTimeDTO[];
  actorName: string | null;
  requireActor: () => boolean;
  onChanged: () => Promise<void>;
  toast: ToastFn;
}) {
  const [newRow, setNewRow] = useState<NewTimeRow>({
    fromNodeId: "",
    toNodeId: "",
    mode: "car",
    minutes: "",
  });
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  // インライン編集: "from|to|mode" => 分（文字列）
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editMinutes, setEditMinutes] = useState("");

  const nodeName = (id: string): string => nodes.find((n) => n.id === id)?.name ?? "不明";
  const rowKey = (t: TravelTimeDTO) => `${t.fromNodeId}|${t.toNodeId}|${t.mode}`;

  const addRow = async () => {
    if (!requireActor()) return;
    if (!actorName) return;
    if (!newRow.fromNodeId || !newRow.toNodeId || newRow.minutes === "") {
      setRowError("出発地・到着地・分を入力してください");
      return;
    }
    setSaving(true);
    setRowError(null);
    try {
      await putCarpool(`/clubs/${slug}/travel-times`, {
        actorName,
        entries: [
          {
            fromNodeId: newRow.fromNodeId,
            toNodeId: newRow.toNodeId,
            mode: newRow.mode,
            minutes: Number(newRow.minutes),
            source: "manual",
          },
        ],
      });
      toast("移動時間を保存しました", "success");
      setNewRow({ fromNodeId: "", toNodeId: "", mode: "car", minutes: "" });
      await onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (t: TravelTimeDTO) => {
    if (!actorName) {
      requireActor();
      return;
    }
    if (editMinutes === "") return;
    try {
      await putCarpool(`/clubs/${slug}/travel-times`, {
        actorName,
        entries: [
          {
            fromNodeId: t.fromNodeId,
            toNodeId: t.toNodeId,
            mode: t.mode,
            minutes: Number(editMinutes),
            source: "manual",
          },
        ],
      });
      toast("更新しました", "success");
      setEditKey(null);
      await onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "更新に失敗しました", "error");
    }
  };

  return (
    <div>
      <p className="mb-3 rounded-lg bg-surface p-2 text-xs text-muted">
        {/* Phase 3 comment */}
        必要ペアの動的算出は Phase 3 で実装予定。現在は手動入力のみ。
      </p>

      <ul className="mb-4 flex flex-col gap-2">
        {travelTimes.map((t) => {
          const key = rowKey(t);
          const editing = editKey === key;
          return (
            <li
              key={key}
              className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">
                  {nodeName(t.fromNodeId)} → {nodeName(t.toNodeId)}
                </p>
                <p className="text-xs text-muted">
                  {t.mode === "car" ? "車" : "公共交通"} ・ {t.source}
                </p>
              </div>
              {editing ? (
                <div className="flex shrink-0 items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    className="w-16 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground"
                    value={editMinutes}
                    onChange={(e) => setEditMinutes(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => saveEdit(t)}
                    className="rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white hover:bg-primary-dark"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditKey(null)}
                    className="rounded-lg bg-white/10 px-2 py-1 text-xs text-foreground"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (!requireActor()) return;
                    setEditKey(key);
                    setEditMinutes(String(t.minutes));
                  }}
                  className="shrink-0 rounded-lg bg-white/10 px-3 py-1 text-sm text-foreground hover:bg-white/15"
                >
                  {t.minutes} 分
                </button>
              )}
            </li>
          );
        })}
        {travelTimes.length === 0 && (
          <li className="text-sm text-muted">移動時間がまだありません。</li>
        )}
      </ul>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">移動時間を追加</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted">出発地</label>
            <select
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
              value={newRow.fromNodeId}
              onChange={(e) => setNewRow((r) => ({ ...r, fromNodeId: e.target.value }))}
            >
              <option value="">選択</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">到着地</label>
            <select
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
              value={newRow.toNodeId}
              onChange={(e) => setNewRow((r) => ({ ...r, toNodeId: e.target.value }))}
            >
              <option value="">選択</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <span className="mb-1 block text-xs text-muted">手段</span>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 text-sm text-foreground">
                <input
                  type="radio"
                  name="tt-mode"
                  checked={newRow.mode === "car"}
                  onChange={() => setNewRow((r) => ({ ...r, mode: "car" }))}
                />
                車
              </label>
              <label className="flex items-center gap-1 text-sm text-foreground">
                <input
                  type="radio"
                  name="tt-mode"
                  checked={newRow.mode === "transit"}
                  onChange={() => setNewRow((r) => ({ ...r, mode: "transit" }))}
                />
                公共交通
              </label>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">分</label>
            <input
              type="number"
              min={0}
              className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
              value={newRow.minutes}
              onChange={(e) => setNewRow((r) => ({ ...r, minutes: e.target.value }))}
            />
          </div>
        </div>
        {rowError && <p className="text-sm text-red-400">{rowError}</p>}
        <button
          type="button"
          onClick={addRow}
          disabled={saving}
          className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
        >
          {saving ? "保存中…" : "追加"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: クラブ設定
// ---------------------------------------------------------------------------

function numFromSettings(settings: Record<string, unknown>, key: string): string {
  const v = settings[key];
  return typeof v === "number" ? String(v) : "";
}

function SettingsTab({
  slug,
  club,
  actorName,
  requireActor,
  onChanged,
  toast,
}: {
  slug: string;
  club: ClubDTO;
  actorName: string | null;
  requireActor: () => boolean;
  onChanged: () => Promise<void>;
  toast: ToastFn;
}) {
  const [fuelPrice, setFuelPrice] = useState(
    numFromSettings(club.settings, "fuel_price_per_liter"),
  );
  const [fuelEff, setFuelEff] = useState(
    numFromSettings(club.settings, "fuel_efficiency_km_per_liter"),
  );
  const [driverCoef, setDriverCoef] = useState(
    numFromSettings(club.settings, "driver_coefficient") || "0.5",
  );
  const [bufferMin, setBufferMin] = useState(
    numFromSettings(club.settings, "default_buffer_min"),
  );
  const [roundingUnit, setRoundingUnit] = useState(
    numFromSettings(club.settings, "rounding_unit_yen"),
  );
  const [joeNames, setJoeNames] = useState(club.joeClubNames.join("\n"));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!requireActor()) return;
    if (!actorName) return;
    setSaving(true);
    setFormError(null);

    const settings: Record<string, unknown> = {};
    if (fuelPrice !== "") settings.fuel_price_per_liter = Number(fuelPrice);
    if (fuelEff !== "") settings.fuel_efficiency_km_per_liter = Number(fuelEff);
    settings.driver_coefficient = Number(driverCoef);
    if (bufferMin !== "") settings.default_buffer_min = Number(bufferMin);
    if (roundingUnit !== "") settings.rounding_unit_yen = Number(roundingUnit);

    const joeClubNames = joeNames
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    try {
      await patchCarpool(`/clubs/${slug}`, {
        actorName,
        settings,
        joeClubNames,
      });
      toast("クラブ設定を保存しました", "success");
      await onChanged();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted">燃料単価（円/L）</label>
          <input
            type="number"
            step="any"
            min={0}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            value={fuelPrice}
            onChange={(e) => setFuelPrice(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">燃費（km/L）</label>
          <input
            type="number"
            step="any"
            min={0}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            value={fuelEff}
            onChange={(e) => setFuelEff(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted">運転手係数</label>
        <select
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
          value={driverCoef}
          onChange={(e) => setDriverCoef(e.target.value)}
        >
          <option value="0">0</option>
          <option value="0.5">0.5</option>
          <option value="1">1</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted">既定バッファ（分）</label>
          <input
            type="number"
            min={0}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            value={bufferMin}
            onChange={(e) => setBufferMin(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">丸め単位（円）</label>
          <input
            type="number"
            min={1}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
            value={roundingUnit}
            onChange={(e) => setRoundingUnit(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted">JOY クラブ表記名</label>
        <textarea
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
          rows={3}
          value={joeNames}
          onChange={(e) => setJoeNames(e.target.value)}
          placeholder="1 行に 1 つ（カンマ区切りも可）"
        />
      </div>

      {formError && <p className="text-sm text-red-400">{formError}</p>}

      <button
        type="submit"
        disabled={saving}
        className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
      >
        {saving ? "保存中…" : "保存"}
      </button>
    </form>
  );
}
