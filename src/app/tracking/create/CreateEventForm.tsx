"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  MapPin, Plus, Trash2, Upload, ChevronDown, ChevronUp,
  Radio, Users, Settings, Navigation, GripVertical, AlertCircle,
} from "lucide-react";
import Link from "next/link";

// ─── Types ─────────────────────────────────────────────────────

interface ControlPointDraft {
  id: string;
  lat: number;
  lng: number;
}

interface DeviceDraft {
  imei: string;
  label: string;
}

interface ParticipantDraft {
  name: string;
  club: string;
  className: string;
  bibNumber: string;
  deviceImei: string; // mapped device IMEI
  startTimeOffset: number; // seconds from first start
}

type Step = "event" | "course" | "devices" | "participants" | "confirm";

const STEPS: { key: Step; label: string; icon: typeof Radio }[] = [
  { key: "event", label: "イベント情報", icon: Radio },
  { key: "course", label: "コース設定", icon: Navigation },
  { key: "devices", label: "GPS端末", icon: Settings },
  { key: "participants", label: "選手登録", icon: Users },
  { key: "confirm", label: "確認・配信", icon: Radio },
];

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#f43f5e", "#14b8a6",
  "#a855f7", "#6366f1", "#0ea5e9", "#84cc16", "#d946ef",
];

// ─── Component ─────────────────────────────────────────────────

export function CreateEventForm() {
  const [step, setStep] = useState<Step>("event");

  // Step 1: Event info
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [mapCenter, setMapCenter] = useState<[number, number]>([35.68, 139.76]);
  const [mapZoom, setMapZoom] = useState(14);

  // Step 2: Course
  const [controls, setControls] = useState<ControlPointDraft[]>([]);
  const [courseOrder, setCourseOrder] = useState<string[]>([]);
  const [addingControl, setAddingControl] = useState(false);

  // Step 3: Devices
  const [devices, setDevices] = useState<DeviceDraft[]>([]);
  const [newImei, setNewImei] = useState("");
  const [newDeviceLabel, setNewDeviceLabel] = useState("");
  const [serverHost] = useState("tracking.trails.jp");
  const [serverPort] = useState("5023");
  const [sendInterval, setSendInterval] = useState(5);

  // Step 4: Participants
  const [participants, setParticipants] = useState<ParticipantDraft[]>([]);

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const controlMarkersRef = useRef<Map<string, { setLngLat: (lnglat: [number, number]) => void; remove: () => void }>>(new Map());

  // ─── Map init ──────────────────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current) return;
    let cancelled = false;

    import("maplibre-gl").then((mod) => {
      if (cancelled || !mapContainerRef.current) return;
      const maplibregl = mod.default;

      const mlMap = new maplibregl.Map({
        container: mapContainerRef.current,
        style: {
          version: 8,
          sources: {
            base: {
              type: "raster",
              tiles: ["https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "&copy; 国土地理院",
            },
          },
          layers: [{ id: "base-layer", type: "raster", source: "base" }],
        },
        center: [mapCenter[1], mapCenter[0]],
        zoom: mapZoom,
        minZoom: 4,
        maxZoom: 19,
      });

      mlMap.addControl(new maplibregl.NavigationControl(), "top-right");

      mlMap.on("moveend", () => {
        const c = mlMap.getCenter();
        setMapCenter([c.lat, c.lng]);
        setMapZoom(mlMap.getZoom());
      });

      // Click to add control
      mlMap.on("click", (e: { lngLat: { lat: number; lng: number } }) => {
        // We'll check addingControl via a ref since the event listener captures closure
        const addBtn = document.getElementById("add-control-active");
        if (!addBtn) return;

        const lat = e.lngLat.lat;
        const lng = e.lngLat.lng;

        // Dispatch custom event to add the control
        window.dispatchEvent(
          new CustomEvent("map-click-control", { detail: { lat, lng } })
        );
      });

      mapRef.current = mlMap;
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for map click events
  useEffect(() => {
    const handler = (e: Event) => {
      const { lat, lng } = (e as CustomEvent).detail;
      const nextNum = controls.length + 1;
      const id = controls.length === 0 ? "S" : `${nextNum - 1}`;
      const newCtrl: ControlPointDraft = { id, lat, lng };

      setControls((prev) => [...prev, newCtrl]);
      setCourseOrder((prev) => [...prev, id]);
      setAddingControl(false);
    };
    window.addEventListener("map-click-control", handler);
    return () => window.removeEventListener("map-click-control", handler);
  }, [controls.length]);

  // Sync control markers on map
  useEffect(() => {
    const mlMap = mapRef.current;
    if (!mlMap) return;

    import("maplibre-gl").then((mod) => {
      const maplibregl = mod.default;

      // Remove old markers
      controlMarkersRef.current.forEach((m) => m.remove());
      controlMarkersRef.current.clear();

      controls.forEach((ctrl) => {
        const isSpecial = ctrl.id === "S" || ctrl.id === "F";
        const el = document.createElement("div");
        el.style.cssText = `
          width:${isSpecial ? 24 : 20}px;height:${isSpecial ? 24 : 20}px;
          border-radius:50%;
          background:${isSpecial ? "#f97316" : "white"};
          border:2.5px solid ${isSpecial ? "#ea580c" : "#333"};
          display:flex;align-items:center;justify-content:center;
          font-size:9px;font-weight:bold;color:${isSpecial ? "white" : "#333"};
          box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:grab;
        `;
        el.textContent = ctrl.id;

        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([ctrl.lng, ctrl.lat])
          .addTo(mlMap);

        marker.on("dragend", () => {
          const pos = marker.getLngLat();
          setControls((prev) =>
            prev.map((c) => (c.id === ctrl.id ? { ...c, lat: pos.lat, lng: pos.lng } : c))
          );
        });

        controlMarkersRef.current.set(ctrl.id, marker);
      });
    });
  }, [controls]);

  // ─── Device management ────────────────────────────────

  const addDevice = useCallback(() => {
    const imei = newImei.trim();
    if (!imei || devices.some((d) => d.imei === imei)) return;
    setDevices((prev) => [...prev, { imei, label: newDeviceLabel.trim() || `端末 ${prev.length + 1}` }]);
    setNewImei("");
    setNewDeviceLabel("");
  }, [newImei, newDeviceLabel, devices]);

  const removeDevice = useCallback((imei: string) => {
    setDevices((prev) => prev.filter((d) => d.imei !== imei));
    setParticipants((prev) =>
      prev.map((p) => (p.deviceImei === imei ? { ...p, deviceImei: "" } : p))
    );
  }, []);

  // ─── Participant management ───────────────────────────

  const addParticipant = useCallback(() => {
    setParticipants((prev) => [
      ...prev,
      { name: "", club: "", className: "", bibNumber: "", deviceImei: "", startTimeOffset: 0 },
    ]);
  }, []);

  const updateParticipant = useCallback((index: number, field: keyof ParticipantDraft, value: string | number) => {
    setParticipants((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  }, []);

  const removeParticipant = useCallback((index: number) => {
    setParticipants((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // CSV import
  const handleCsvImport = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text) return;
        const lines = text.split("\n").filter(Boolean);
        // Skip header if present
        const start = lines[0].includes("名前") || lines[0].includes("name") ? 1 : 0;
        const imported: ParticipantDraft[] = [];
        for (let i = start; i < lines.length; i++) {
          const cols = lines[i].split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
          if (cols.length < 1 || !cols[0]) continue;
          imported.push({
            name: cols[0] || "",
            club: cols[1] || "",
            className: cols[2] || "",
            bibNumber: cols[3] || "",
            deviceImei: cols[4] || "",
            startTimeOffset: parseInt(cols[5] || "0", 10) || 0,
          });
        }
        setParticipants((prev) => [...prev, ...imported]);
      };
      reader.readAsText(file);
    },
    []
  );

  // ─── Control point management ─────────────────────────

  const removeControl = useCallback((id: string) => {
    setControls((prev) => prev.filter((c) => c.id !== id));
    setCourseOrder((prev) => prev.filter((cid) => cid !== id));
  }, []);

  const addFinish = useCallback(() => {
    if (controls.some((c) => c.id === "F")) return;
    // Place finish near start or map center
    const start = controls.find((c) => c.id === "S");
    const lat = start ? start.lat + 0.0003 : mapCenter[0];
    const lng = start ? start.lng + 0.0003 : mapCenter[1];
    setControls((prev) => [...prev, { id: "F", lat, lng }]);
    setCourseOrder((prev) => [...prev, "F"]);
  }, [controls, mapCenter]);

  const moveOrderUp = useCallback((index: number) => {
    if (index <= 0) return;
    setCourseOrder((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const moveOrderDown = useCallback((index: number) => {
    setCourseOrder((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  // ─── Validation ───────────────────────────────────────

  const step1Valid = title.trim().length > 0 && date.length > 0;
  const step2Valid = controls.length >= 2;
  const step3Valid = devices.length > 0;
  const step4Valid = participants.length > 0 && participants.every((p) => p.name.trim());

  const canCreate = step1Valid && step2Valid && step3Valid && step4Valid;

  // Count unassigned
  const unassignedDevices = devices.filter((d) => !participants.some((p) => p.deviceImei === d.imei)).length;
  const unassignedParticipants = participants.filter((p) => !p.deviceImei).length;

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6">
        <Link href="/tracking" className="text-xs text-muted hover:text-primary">
          ← GPS追跡に戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold">ライブ追跡イベントを作成</h1>
      </div>

      {/* Step navigation */}
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1">
        {STEPS.map((s) => (
          <button
            key={s.key}
            onClick={() => setStep(s.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              step === s.key
                ? "bg-primary text-white"
                : "text-muted hover:bg-surface hover:text-foreground"
            }`}
          >
            <s.icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,400px]">
        {/* Map (always visible) */}
        <div className="order-2 lg:order-1">
          <div className="overflow-hidden rounded-lg border border-border">
            <div ref={mapContainerRef} className="h-[400px] w-full lg:h-[560px]" />
          </div>
          {step === "course" && (
            <div className="mt-2 flex items-center gap-2">
              {addingControl ? (
                <div className="flex items-center gap-2">
                  <span id="add-control-active" className="rounded bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary">
                    地図をクリックしてコントロールを配置
                  </span>
                  <button
                    onClick={() => setAddingControl(false)}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setAddingControl(true)}
                    className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-dark"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    コントロール追加
                  </button>
                  {!controls.some((c) => c.id === "F") && controls.length >= 2 && (
                    <button
                      onClick={addFinish}
                      className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      フィニッシュ追加
                    </button>
                  )}
                </>
              )}
              <span className="ml-auto text-[10px] text-muted">
                ドラッグで位置調整可
              </span>
            </div>
          )}
        </div>

        {/* Form panel */}
        <div className="order-1 lg:order-2">
          {/* ── Step 1: Event Info ── */}
          {step === "event" && (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-bold">イベント情報</h2>
              <div>
                <label className="mb-1 block text-xs text-muted">大会名 *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例: 第10回 代々木公園スプリント"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">開催日 *</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">開催地</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="例: 東京都渋谷区"
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">説明（任意）</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="大会の概要、注意事項など"
                  className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div className="rounded bg-white/5 p-3 text-[11px] text-muted">
                <div className="mb-1 font-semibold text-foreground">地図の中心・ズーム</div>
                地図をドラッグ/ズームして大会エリアを表示してください。現在の表示範囲がイベントの初期表示になります
                <div className="mt-1 font-mono text-[10px]">
                  {mapCenter[0].toFixed(5)}, {mapCenter[1].toFixed(5)} / z{mapZoom.toFixed(1)}
                </div>
              </div>
              <button
                onClick={() => setStep("course")}
                disabled={!step1Valid}
                className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
              >
                次へ: コース設定
              </button>
            </div>
          )}

          {/* ── Step 2: Course ── */}
          {step === "course" && (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-bold">コース設定</h2>
              <p className="text-xs text-muted">
                地図上をクリックしてコントロールを配置。最初のポイントがスタート(S)になります。ドラッグで位置を調整できます
              </p>

              {controls.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted">
                  「コントロール追加」をクリックしてから地図上をクリック
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="mb-2 text-[10px] font-medium text-muted">コントロール一覧</div>
                  {controls.map((ctrl) => (
                    <div key={ctrl.id} className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5 text-xs">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${
                        ctrl.id === "S" || ctrl.id === "F"
                          ? "bg-primary text-white"
                          : "bg-white/10 text-foreground"
                      }`}>
                        {ctrl.id}
                      </span>
                      <span className="flex-1 font-mono text-[10px] text-muted">
                        {ctrl.lat.toFixed(5)}, {ctrl.lng.toFixed(5)}
                      </span>
                      <button
                        onClick={() => removeControl(ctrl.id)}
                        className="text-muted hover:text-red-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {courseOrder.length > 1 && (
                <div>
                  <div className="mb-2 text-[10px] font-medium text-muted">通過順序</div>
                  <div className="space-y-1">
                    {courseOrder.map((cid, i) => (
                      <div key={cid} className="flex items-center gap-1 text-xs">
                        <GripVertical className="h-3 w-3 text-muted/40" />
                        <span className="w-8 font-mono text-muted">{i + 1}.</span>
                        <span className="font-medium">{cid}</span>
                        <div className="ml-auto flex gap-0.5">
                          <button onClick={() => moveOrderUp(i)} className="rounded p-0.5 text-muted hover:text-foreground">
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button onClick={() => moveOrderDown(i)} className="rounded p-0.5 text-muted hover:text-foreground">
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep("event")}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-muted hover:text-foreground"
                >
                  戻る
                </button>
                <button
                  onClick={() => setStep("devices")}
                  disabled={!step2Valid}
                  className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
                >
                  次へ: GPS端末
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Devices ── */}
          {step === "devices" && (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-bold">GPS端末の登録</h2>

              {/* Server settings */}
              <div className="rounded bg-white/5 p-3">
                <div className="mb-2 text-[11px] font-semibold text-foreground">端末の送信先設定</div>
                <p className="mb-2 text-[11px] text-muted">GPS端末の管理画面で以下のサーバー情報を設定してください</p>
                <div className="space-y-1.5 font-mono text-xs">
                  <div className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5">
                    <span className="text-muted">ホスト:</span>
                    <span className="font-medium text-foreground">{serverHost}</span>
                  </div>
                  <div className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5">
                    <span className="text-muted">ポート:</span>
                    <span className="font-medium text-foreground">{serverPort}</span>
                  </div>
                  <div className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5">
                    <span className="text-muted">プロトコル:</span>
                    <span className="font-medium text-foreground">TCP</span>
                  </div>
                </div>
              </div>

              {/* Send interval */}
              <div>
                <label className="mb-1 block text-xs text-muted">送信間隔（秒）</label>
                <div className="flex gap-1">
                  {[1, 3, 5, 10, 15, 30].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSendInterval(s)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        sendInterval === s
                          ? "bg-primary text-white"
                          : "border border-border text-muted hover:text-foreground"
                      }`}
                    >
                      {s}s
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-muted">
                  短いほど滑らかですがバッテリー消費とデータ通信量が増加します。推奨: 5秒
                </p>
              </div>

              {/* IMEI registration */}
              <div>
                <label className="mb-1 block text-xs text-muted">IMEI番号を登録</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newImei}
                    onChange={(e) => setNewImei(e.target.value.replace(/\D/g, ""))}
                    placeholder="IMEI (15桁)"
                    maxLength={15}
                    className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-primary"
                  />
                  <input
                    type="text"
                    value={newDeviceLabel}
                    onChange={(e) => setNewDeviceLabel(e.target.value)}
                    placeholder="ラベル"
                    className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                  <button
                    onClick={addDevice}
                    disabled={newImei.length < 15}
                    className="rounded-lg bg-primary px-3 py-2 text-sm text-white hover:bg-primary-dark disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Device list */}
              {devices.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-[10px] font-medium text-muted">登録済み端末 ({devices.length}台)</div>
                  {devices.map((d) => {
                    const assigned = participants.find((p) => p.deviceImei === d.imei);
                    return (
                      <div key={d.imei} className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5 text-xs">
                        <Settings className="h-3 w-3 flex-shrink-0 text-muted" />
                        <span className="font-mono text-[10px]">{d.imei}</span>
                        <span className="text-muted">{d.label}</span>
                        {assigned ? (
                          <span className="ml-auto rounded bg-green-500/15 px-1.5 py-0.5 text-[9px] text-green-400">
                            → {assigned.name || "未入力"}
                          </span>
                        ) : (
                          <span className="ml-auto text-[9px] text-muted">未割当</span>
                        )}
                        <button onClick={() => removeDevice(d.imei)} className="text-muted hover:text-red-400">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted">
                  GPS端末のIMEI番号を登録してください
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep("course")}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-muted hover:text-foreground"
                >
                  戻る
                </button>
                <button
                  onClick={() => setStep("participants")}
                  disabled={!step3Valid}
                  className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
                >
                  次へ: 選手登録
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Participants ── */}
          {step === "participants" && (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold">選手登録</h2>
                <div className="flex gap-2">
                  <label className="flex cursor-pointer items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted hover:text-foreground">
                    <Upload className="h-3 w-3" />
                    CSVインポート
                    <input
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleCsvImport(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    onClick={addParticipant}
                    className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-white hover:bg-primary-dark"
                  >
                    <Plus className="h-3 w-3" />
                    追加
                  </button>
                </div>
              </div>

              <div className="rounded bg-white/5 px-3 py-2 text-[10px] text-muted">
                CSV形式: 名前, クラブ, クラス, ゼッケン, IMEI, スタート秒差
              </div>

              {participants.length > 0 ? (
                <div className="max-h-[340px] space-y-2 overflow-y-auto">
                  {participants.map((p, i) => (
                    <div key={i} className="rounded-lg border border-border bg-surface p-2.5">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                            style={{ backgroundColor: COLORS[i % COLORS.length] }}
                          >
                            {i + 1}
                          </span>
                          <span className="text-xs font-medium">{p.name || "(未入力)"}</span>
                        </div>
                        <button onClick={() => removeParticipant(i)} className="text-muted hover:text-red-400">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={p.name}
                          onChange={(e) => updateParticipant(i, "name", e.target.value)}
                          placeholder="名前 *"
                          className="rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary"
                        />
                        <input
                          type="text"
                          value={p.club}
                          onChange={(e) => updateParticipant(i, "club", e.target.value)}
                          placeholder="クラブ"
                          className="rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary"
                        />
                        <input
                          type="text"
                          value={p.className}
                          onChange={(e) => updateParticipant(i, "className", e.target.value)}
                          placeholder="クラス"
                          className="rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary"
                        />
                        <input
                          type="text"
                          value={p.bibNumber}
                          onChange={(e) => updateParticipant(i, "bibNumber", e.target.value)}
                          placeholder="ゼッケン"
                          className="rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary"
                        />
                        <select
                          value={p.deviceImei}
                          onChange={(e) => updateParticipant(i, "deviceImei", e.target.value)}
                          className="rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary"
                        >
                          <option value="">GPS端末を選択</option>
                          {devices.map((d) => (
                            <option key={d.imei} value={d.imei}>
                              {d.label} ({d.imei.slice(-4)})
                            </option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={p.startTimeOffset}
                            onChange={(e) => updateParticipant(i, "startTimeOffset", parseInt(e.target.value) || 0)}
                            className="w-full rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary"
                            placeholder="0"
                          />
                          <span className="text-[10px] text-muted">秒差</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted">
                  「追加」で選手を登録、またはCSVをインポート
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep("devices")}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-muted hover:text-foreground"
                >
                  戻る
                </button>
                <button
                  onClick={() => setStep("confirm")}
                  disabled={!step4Valid}
                  className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
                >
                  次へ: 確認
                </button>
              </div>
            </div>
          )}

          {/* ── Step 5: Confirm ── */}
          {step === "confirm" && (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-bold">確認・配信開始</h2>

              <div className="space-y-3">
                {/* Summary */}
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-xs font-semibold text-foreground">{title}</div>
                  <div className="mt-1 space-y-0.5 text-[11px] text-muted">
                    <div>{date} / {location}</div>
                    {description && <div>{description}</div>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-surface p-3 text-center">
                    <div className="text-lg font-bold text-primary">{controls.length}</div>
                    <div className="text-[10px] text-muted">コントロール</div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface p-3 text-center">
                    <div className="text-lg font-bold text-primary">{devices.length}</div>
                    <div className="text-[10px] text-muted">GPS端末</div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface p-3 text-center">
                    <div className="text-lg font-bold text-primary">{participants.length}</div>
                    <div className="text-[10px] text-muted">選手</div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface p-3 text-center">
                    <div className="text-lg font-bold text-primary">{sendInterval}s</div>
                    <div className="text-[10px] text-muted">送信間隔</div>
                  </div>
                </div>

                {/* Warnings */}
                {(unassignedDevices > 0 || unassignedParticipants > 0) && (
                  <div className="space-y-1">
                    {unassignedParticipants > 0 && (
                      <div className="flex items-center gap-2 rounded bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        {unassignedParticipants}人の選手にGPS端末が未割当です
                      </div>
                    )}
                    {unassignedDevices > 0 && (
                      <div className="flex items-center gap-2 rounded bg-white/5 px-3 py-2 text-xs text-muted">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        {unassignedDevices}台のGPS端末が未使用です
                      </div>
                    )}
                  </div>
                )}

                {!canCreate && (
                  <div className="rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    すべてのステップを完了してください
                  </div>
                )}

                {/* Broadcast settings */}
                <div className="rounded bg-white/5 p-3">
                  <div className="mb-1 text-[11px] font-semibold text-foreground">配信URL（作成後に発行）</div>
                  <div className="font-mono text-[11px] text-muted">
                    https://trailsjp.vercel.app/tracking/&#123;event-id&#125;
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep("participants")}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-muted hover:text-foreground"
                >
                  戻る
                </button>
                <button
                  disabled={!canCreate}
                  className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-40"
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <Radio className="h-4 w-4" />
                    イベントを作成
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
