"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { fetchCarpool, postCarpool, patchCarpool, putCarpool } from "./carpoolFetch";
import { useToast } from "./Toast";
import CarpoolHeader from "./CarpoolHeader";
import NodeMapPicker from "./NodeMapPicker";
import { cn } from "@/lib/utils";
import type {
  ClubDTO,
  NodeDTO,
  TravelTimeDTO,
} from "@/lib/carpool/api/mappers";

interface MastersClientProps {
  slug: string;
  // P5.5: plan からの座標未取得ジャンプ（?focus=missing-coords）。
  // 受け取ると「場所」タブを開き、座標なしの行をハイライトしてスクロールする。
  focus?: "missing-coords";
}

type Tab = "nodes" | "times" | "settings";
type NodeKind = "area" | "pickup" | "venue";

/**
 * 調整さんモデル: マスタ（場所・移動時間・クラブ設定）はメンバー文脈を持たないため、
 * change_log の actorName は固定文字列 "guest"。誰でも編集できる。
 */
const GUEST = "guest";

const KIND_LABEL: Record<NodeKind, string> = {
  area: "自宅エリア（最寄り駅など）",
  pickup: "集合・乗車場所",
  venue: "会場・駐車場",
};

export default function MastersClient({ slug, focus }: MastersClientProps) {
  const { toast, toastEl } = useToast();
  // P5.5: focus=missing-coords のときは「場所」タブを開く（既定も nodes だが明示する）。
  const [tab, setTab] = useState<Tab>(focus === "missing-coords" ? "nodes" : "nodes");
  const [club, setClub] = useState<ClubDTO | null>(null);
  const [nodes, setNodes] = useState<NodeDTO[]>([]);
  const [travelTimes, setTravelTimes] = useState<TravelTimeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [clubRes, nodesRes, ttRes] = await Promise.all([
        fetchCarpool<{ club: ClubDTO }>(`/clubs/${slug}`),
        fetchCarpool<{ nodes: NodeDTO[] }>(`/clubs/${slug}/nodes`),
        fetchCarpool<{ travelTimes: TravelTimeDTO[] }>(`/clubs/${slug}/travel-times`),
      ]);
      setClub(clubRes.club);
      setNodes(nodesRes.nodes);
      setTravelTimes(ttRes.travelTimes);
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

  return (
    <div className="min-h-screen">
      {toastEl}
      <CarpoolHeader clubName={club?.name ?? slug} slug={slug} />

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
                onChanged={load}
                toast={toast}
                focusMissingCoords={focus === "missing-coords"}
              />
            )}
            {tab === "times" && (
              <TravelTimesTab
                slug={slug}
                nodes={nodes}
                travelTimes={travelTimes}
                onChanged={load}
                toast={toast}
              />
            )}
            {tab === "settings" && club && (
              <SettingsTab
                slug={slug}
                club={club}
                onChanged={load}
                toast={toast}
              />
            )}
          </>
        )}
      </main>
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

// P5.5: 座標未取得（lat か lng が null）の判定。
const isMissingCoords = (n: NodeDTO): boolean => n.lat == null || n.lng == null;

function NodesTab({
  slug,
  nodes,
  onChanged,
  toast,
  focusMissingCoords,
}: {
  slug: string;
  nodes: NodeDTO[];
  onChanged: () => Promise<void>;
  toast: ToastFn;
  // P5.5: plan からの座標未取得ジャンプで開かれたか。座標なし行を強調しスクロールする。
  focusMissingCoords: boolean;
}) {
  // P5.5: focus 時は最初に座標なしのノードを含む種別を開く（無ければ area）。
  const initialSubKind = useMemo<NodeKind>(() => {
    if (!focusMissingCoords) return "area";
    const firstMissing = nodes.find(isMissingCoords);
    return (firstMissing?.kind as NodeKind | undefined) ?? "area";
    // マウント時の初期値のみ（focus と nodes の初期スナップショットで決める）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [subKind, setSubKind] = useState<NodeKind>(initialSubKind);
  const [editing, setEditing] = useState<string | null>(null); // "new" | id | null
  const [form, setForm] = useState<NodeForm>(EMPTY_NODE_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // C: 座標再取得（ジオコーディング）の進行中ノード id（null = 待機）。
  const [geocodingId, setGeocodingId] = useState<string | null>(null);
  // 再発防止 UX: 入力名と解決先名が違う（exact=false）とき、編集フォーム内に出す警告。
  // nodeId は対象ノード、input=入力した場所名、resolved=GSI が返した解決先名。
  // null = 警告なし。次の「再取得」成功（exact=true）や保存・キャンセルでクリアする。
  const [geocodeWarning, setGeocodeWarning] = useState<{
    nodeId: string;
    input: string;
    resolved: string;
  } | null>(null);

  // P5.5: 最初の座標なし行への ref（マウント後に一度だけ scrollIntoView する）。
  const firstMissingRef = useRef<HTMLLIElement | null>(null);
  const didScrollRef = useRef(false);
  // 再発防止 UX: exact=false 警告時に編集フォーム（地図ピッカー）へ確実にスクロールする ref。
  const editFormRef = useRef<HTMLFormElement | null>(null);

  const filtered = useMemo(
    () => nodes.filter((n) => n.kind === subKind),
    [nodes, subKind],
  );

  // 地図ピッカーの初期中心: 既存ノードから venue を優先、無ければ座標ありの最初のノード、それも無ければ null。
  const mapFallbackCenter = useMemo<{ lat: number; lng: number } | null>(() => {
    const hasCoord = (n: NodeDTO) => n.lat != null && n.lng != null;
    const venue = nodes.find((n) => n.kind === "venue" && hasCoord(n));
    const pick = venue ?? nodes.find(hasCoord);
    return pick ? { lat: Number(pick.lat), lng: Number(pick.lng) } : null;
  }, [nodes]);

  // P5.5: focus 時、表示中の種別で最初の座標なし行を画面中央へ寄せる（一度きり）。
  useEffect(() => {
    if (!focusMissingCoords || didScrollRef.current) return;
    const el = firstMissingRef.current;
    if (el) {
      didScrollRef.current = true;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focusMissingCoords, filtered]);

  // P5.5: 表示中リストで最初に座標なしになる行（ハイライト＆スクロール対象）。
  const firstMissingId = useMemo(
    () => (focusMissingCoords ? filtered.find(isMissingCoords)?.id ?? null : null),
    [focusMissingCoords, filtered],
  );

  // C: 住所/名称から座標を再取得（サーバ側ジオコーディング）。
  // geocoded:true → 取得成功。さらに exact=false（入力名と解決先が違う＝目黒駅→中目黒駅の
  // ような誤解決の疑い）なら、編集フォームを開いて地図ピッカーへスクロールし、amber 警告で
  // ピン調整を促す（黙って保存して地図で初めて気づく事故の再発防止）。exact=true は静かに成功。
  // geocoded:false → サーバの message を案内表示。
  const geocode = async (n: NodeDTO) => {
    setGeocodingId(n.id);
    try {
      const res = await postCarpool<{
        node: NodeDTO;
        geocoded: boolean;
        message?: string;
        resolvedTitle?: string | null;
        exact?: boolean | null;
      }>(`/clubs/${slug}/nodes/${n.id}/geocode`, { actorName: GUEST });
      if (res.geocoded) {
        await onChanged();
        if (res.exact === false) {
          // 誤解決の疑い: 編集フォームを開き（地図ピッカーが出る）、警告＋スクロール。
          openEdit(res.node);
          setGeocodeWarning({
            nodeId: res.node.id,
            input: res.node.name,
            resolved: res.resolvedTitle ?? "",
          });
          // フォーム描画後に地図ピッカーへ寄せる（次フレーム）。
          requestAnimationFrame(() => {
            editFormRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
          });
        } else {
          setGeocodeWarning(null);
          toast("座標を取得しました", "success");
        }
      } else {
        toast(res.message ?? "座標を取得できませんでした", "success");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "座標の取得に失敗しました", "error");
    } finally {
      setGeocodingId(null);
    }
  };

  const openNew = () => {
    setForm(EMPTY_NODE_FORM);
    setEditing("new");
    setFormError(null);
    setGeocodeWarning(null);
  };

  const openEdit = (n: NodeDTO) => {
    setForm({
      name: n.name,
      lat: n.lat === null ? "" : String(n.lat),
      lng: n.lng === null ? "" : String(n.lng),
      parking: n.parking,
      note: n.note ?? "",
    });
    setEditing(n.id);
    setFormError(null);
    // 別ノードを開いたら前ノードの誤解決警告は消す（同一ノードを開く geocode 経路では
    // 呼び出し側が setGeocodeWarning を上書きするので、ここで消えても問題ない）。
    setGeocodeWarning((w) => (w && w.nodeId === n.id ? w : null));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError("名前を入力してください");
      return;
    }
    setSaving(true);
    setFormError(null);
    const body: Record<string, unknown> = {
      actorName: GUEST,
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
        toast("場所を追加しました", "success");
      } else if (editing) {
        await patchCarpool(`/clubs/${slug}/nodes/${editing}`, body);
        toast("場所を更新しました", "success");
      }
      setEditing(null);
      setGeocodeWarning(null);
      await onChanged();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  // P5.5: focus 時のみ、座標なしが残る種別にバッジを出して横断的に気づけるようにする。
  const missingByKind = useMemo(() => {
    const m: Record<NodeKind, number> = { area: 0, pickup: 0, venue: 0 };
    if (focusMissingCoords) {
      for (const n of nodes) if (isMissingCoords(n)) m[n.kind as NodeKind] += 1;
    }
    return m;
  }, [focusMissingCoords, nodes]);
  const totalMissing = missingByKind.area + missingByKind.pickup + missingByKind.venue;

  return (
    <div>
      {focusMissingCoords && totalMissing > 0 && (
        <div className="mb-3 rounded-lg border border-yellow-400/50 bg-yellow-400/10 p-3 text-xs text-yellow-300">
          配車プランから「座標未取得」の場所へ移動しました。下の
          <span className="font-semibold">⚠ 座標未取得</span>
          の行で「再取得」を押すか、緯度・経度を入力してください（残り {totalMissing} 件）。
        </div>
      )}
      <div className="mb-3 flex gap-2">
        {(["area", "pickup", "venue"] as NodeKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setSubKind(k);
              setEditing(null);
              setGeocodeWarning(null);
            }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm",
              subKind === k
                ? "bg-primary text-white"
                : "bg-white/10 text-muted hover:text-foreground",
            )}
          >
            {KIND_LABEL[k]}
            {/* P5.5: focus 時、その種別に残る座標なし件数を小バッジで示す。 */}
            {focusMissingCoords && missingByKind[k] > 0 && (
              <span className="ml-1.5 rounded-full bg-yellow-400/30 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-200">
                ⚠ {missingByKind[k]}
              </span>
            )}
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
        {filtered.map((n) => {
          const hasCoord = n.lat != null && n.lng != null;
          // P5.5: focus 時、座標なし行はリング強調。最初の1件にスクロール用 ref を付ける。
          const highlight = focusMissingCoords && !hasCoord;
          const isFirstMissing = focusMissingCoords && n.id === firstMissingId;
          return (
            <li
              key={n.id}
              ref={isFirstMissing ? firstMissingRef : undefined}
              className={cn(
                "flex items-stretch gap-2 rounded-xl border bg-card",
                highlight
                  ? "border-yellow-400/70 ring-2 ring-yellow-400/40"
                  : "border-border",
              )}
            >
              <button
                type="button"
                onClick={() => openEdit(n)}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-l-xl p-3 text-left hover:bg-card-hover"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{n.name}</p>
                  {/* C: 座標の取得状況。取得済みは緯度経度を小数4桁で表示。 */}
                  {hasCoord ? (
                    <p className="truncate text-xs text-muted">
                      📍 取得済 ({n.lat!.toFixed(4)}, {n.lng!.toFixed(4)})
                    </p>
                  ) : (
                    <p
                      className={cn(
                        "truncate text-xs",
                        highlight
                          ? "font-semibold text-yellow-300"
                          : "text-yellow-400",
                      )}
                    >
                      {highlight ? "⚠ 座標未取得" : "座標なし"}
                    </p>
                  )}
                  {n.note && <p className="truncate text-xs text-muted">{n.note}</p>}
                </div>
                {n.kind === "venue" && n.parking && (
                  <span className="shrink-0 rounded bg-accent/20 px-2 py-0.5 text-[10px] text-accent">
                    駐車場あり
                  </span>
                )}
              </button>
              {/* C: 名称/住所から座標を再取得（サーバ側ジオコーディング）。 */}
              <button
                type="button"
                onClick={() => void geocode(n)}
                disabled={geocodingId !== null}
                className="shrink-0 self-center rounded-lg bg-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/15 disabled:opacity-50"
              >
                {geocodingId === n.id ? "取得中…" : "再取得"}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="text-sm text-muted">{KIND_LABEL[subKind]}がまだありません。</li>
        )}
      </ul>

      {editing !== null && (
        <form
          ref={editFormRef}
          onSubmit={submit}
          className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
        >
          <h3 className="text-sm font-semibold text-foreground">
            {editing === "new" ? `${KIND_LABEL[subKind]}を追加` : `${KIND_LABEL[subKind]}を編集`}
          </h3>
          {/* 再発防止 UX: 入力名と解決先が違う（exact=false）ときの目立つ amber 警告。
              toast に warning レベルが無いため、赤(error)と区別したインライン amber ボックスで出す。
              直下の地図ピッカーでピンを調整させる導線。 */}
          {geocodeWarning && editing === geocodeWarning.nodeId && (
            <div className="rounded-lg border border-yellow-400/60 bg-yellow-400/10 p-3 text-xs text-yellow-200">
              <p className="font-semibold">⚠ 解決先が入力と違う可能性があります</p>
              <p className="mt-1 leading-relaxed">
                「<span className="font-semibold">{geocodeWarning.input}</span>」を検索→「
                <span className="font-semibold">{geocodeWarning.resolved || "別の地点"}</span>
                」が見つかりました。違う場合は下の地図でピンを調整してください。
              </p>
            </div>
          )}
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
          {/* 地図ピッカー: タップ／ドラッグで座標を直接指定・微修正できる。 */}
          <NodeMapPicker
            lat={form.lat}
            lng={form.lng}
            onPick={(lat, lng) => setForm((f) => ({ ...f, lat: String(lat), lng: String(lng) }))}
            fallbackCenter={mapFallbackCenter}
          />
          <p className="text-xs text-muted">
            「再取得」の結果がずれている場合は、地図のピンをドラッグして修正できます
          </p>
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
              onClick={() => {
                setEditing(null);
                setGeocodeWarning(null);
              }}
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
  onChanged,
  toast,
}: {
  slug: string;
  nodes: NodeDTO[];
  travelTimes: TravelTimeDTO[];
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
    if (!newRow.fromNodeId || !newRow.toNodeId || newRow.minutes === "") {
      setRowError("出発地・到着地・分を入力してください");
      return;
    }
    setSaving(true);
    setRowError(null);
    try {
      await putCarpool(`/clubs/${slug}/travel-times`, {
        actorName: GUEST,
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
    if (editMinutes === "") return;
    try {
      await putCarpool(`/clubs/${slug}/travel-times`, {
        actorName: GUEST,
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
        移動時間は配車計画ページの『自動計算する』で自動取得できます（ここでは手修正）
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
                  {/* MINOR2: car で 600 分超は座標エラー由来の異常値の疑い。⚠ を前置。 */}
                  {t.mode === "car" && t.minutes > 600 && (
                    <span
                      className="mr-1 text-yellow-400"
                      title="移動時間が異常値です（座標を確認してください）"
                      aria-label="移動時間が異常値です（座標を確認してください）"
                    >
                      ⚠
                    </span>
                  )}
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
  onChanged,
  toast,
}: {
  slug: string;
  club: ClubDTO;
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
        actorName: GUEST,
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
