"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  MapPin, Plus, Trash2, Upload, ChevronDown, ChevronUp,
  Radio, Users, Settings, Image, GripVertical, AlertCircle,
  Wand2, Eye, Loader2,
} from "lucide-react";
import Link from "next/link";
import {
  detectControls,
  pixelToGeo,
  type DetectedControl,
  type ImageBounds,
} from "@/lib/tracking/detect-controls";

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
  deviceImei: string;
  startTimeOffset: number;
}

type Step = "event" | "omap" | "devices" | "participants" | "confirm";

const STEPS: { key: Step; label: string; icon: typeof Radio }[] = [
  { key: "event", label: "イベント情報", icon: Radio },
  { key: "omap", label: "O-map & コース", icon: Image },
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

  // Step 2: O-map & course
  const [omapImage, setOmapImage] = useState<string | null>(null);
  const [omapSize, setOmapSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [overlayOpacity, setOverlayOpacity] = useState(0.65);
  const [imageBounds, setImageBounds] = useState<ImageBounds>({
    north: 35.685, south: 35.675, east: 139.765, west: 139.755,
  });
  const [controls, setControls] = useState<ControlPointDraft[]>([]);
  const [courseOrder, setCourseOrder] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detectedRaw, setDetectedRaw] = useState<DetectedControl[]>([]);
  const [addingManual, setAddingManual] = useState(false);

  // Step 3: Devices
  const [devices, setDevices] = useState<DeviceDraft[]>([]);
  const [newImei, setNewImei] = useState("");
  const [newDeviceLabel, setNewDeviceLabel] = useState("");
  const [sendInterval, setSendInterval] = useState(5);

  // Step 4: Participants
  const [participants, setParticipants] = useState<ParticipantDraft[]>([]);

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const controlMarkersRef = useRef<Map<string, { setLngLat: (c: [number, number]) => void; remove: () => void }>>(new Map());

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

      // Click to add manual control
      mlMap.on("click", (e: { lngLat: { lat: number; lng: number } }) => {
        window.dispatchEvent(
          new CustomEvent("map-click-control", { detail: { lat: e.lngLat.lat, lng: e.lngLat.lng } })
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

  // Map click handler for manual control addition
  useEffect(() => {
    const handler = (e: Event) => {
      if (!addingManual) return;
      const { lat, lng } = (e as CustomEvent).detail;
      const nextNum = controls.length + 1;
      const id = controls.length === 0 ? "S" : `${nextNum - 1}`;
      setControls((prev) => [...prev, { id, lat, lng }]);
      setCourseOrder((prev) => [...prev, id]);
      setAddingManual(false);
    };
    window.addEventListener("map-click-control", handler);
    return () => window.removeEventListener("map-click-control", handler);
  }, [addingManual, controls.length]);

  // Sync control markers
  useEffect(() => {
    const mlMap = mapRef.current;
    if (!mlMap) return;

    import("maplibre-gl").then((mod) => {
      const maplibregl = mod.default;
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

  // ─── O-map overlay ────────────────────────────────────

  const updateOverlay = useCallback(
    (dataUrl: string, bounds: ImageBounds) => {
      const mlMap = mapRef.current;
      if (!mlMap || !mlMap.isStyleLoaded()) return;

      if (mlMap.getSource("omap-overlay")) {
        mlMap.removeLayer("omap-overlay-layer");
        mlMap.removeSource("omap-overlay");
      }

      mlMap.addSource("omap-overlay", {
        type: "image",
        url: dataUrl,
        coordinates: [
          [bounds.west, bounds.north],
          [bounds.east, bounds.north],
          [bounds.east, bounds.south],
          [bounds.west, bounds.south],
        ],
      });
      mlMap.addLayer({
        id: "omap-overlay-layer",
        type: "raster",
        source: "omap-overlay",
        paint: { "raster-opacity": overlayOpacity },
      });
    },
    [overlayOpacity]
  );

  const handleOmapUpload = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setOmapImage(dataUrl);

        // Get image dimensions
        const img = new window.Image();
        img.onload = () => {
          setOmapSize({ w: img.width, h: img.height });

          // Set initial bounds based on current map view
          const mlMap = mapRef.current;
          if (mlMap) {
            const mapBounds = mlMap.getBounds();
            const b: ImageBounds = {
              north: mapBounds.getNorth(),
              south: mapBounds.getSouth(),
              east: mapBounds.getEast(),
              west: mapBounds.getWest(),
            };
            // Shrink to ~70% of view for initial placement
            const latPad = (b.north - b.south) * 0.15;
            const lngPad = (b.east - b.west) * 0.15;
            const shrunk: ImageBounds = {
              north: b.north - latPad,
              south: b.south + latPad,
              east: b.east - lngPad,
              west: b.west + lngPad,
            };
            setImageBounds(shrunk);
            updateOverlay(dataUrl, shrunk);
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    },
    [updateOverlay]
  );

  // Update overlay opacity
  useEffect(() => {
    const mlMap = mapRef.current;
    if (!mlMap) return;
    try {
      mlMap.setPaintProperty("omap-overlay-layer", "raster-opacity", overlayOpacity);
    } catch { /* */ }
  }, [overlayOpacity]);

  // Refresh overlay when bounds change
  useEffect(() => {
    if (omapImage) {
      updateOverlay(omapImage, imageBounds);
    }
  }, [imageBounds, omapImage, updateOverlay]);

  // ─── Auto-detect controls ─────────────────────────────

  const runDetection = useCallback(() => {
    if (!omapImage) return;
    setDetecting(true);

    const img = new window.Image();
    img.onload = () => {
      // Draw to canvas
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { setDetecting(false); return; }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);

      // Scale-adaptive radius range
      // Typical control circle is 5-6mm diameter on printed map
      // At 300 DPI, that's ~60px; at 150 DPI, ~30px; at 72 DPI, ~15px
      const scale = Math.max(img.width, img.height);
      const minR = Math.max(6, Math.round(scale * 0.003));
      const maxR = Math.max(30, Math.round(scale * 0.03));

      const detected = detectControls(imageData, minR, maxR);
      setDetectedRaw(detected);

      // Convert to geo controls
      const newControls: ControlPointDraft[] = detected.map((d, i) => {
        const geo = pixelToGeo(d.px, d.py, img.width, img.height, imageBounds);
        const id = i === 0 ? "S" : i === detected.length - 1 && detected.length > 2 ? "F" : `${i}`;
        return { id, lat: geo.lat, lng: geo.lng };
      });

      setControls(newControls);
      setCourseOrder(newControls.map((c) => c.id));
      setDetecting(false);
    };
    img.src = omapImage;
  }, [omapImage, imageBounds]);

  // ─── Control management ───────────────────────────────

  const removeControl = useCallback((id: string) => {
    setControls((prev) => prev.filter((c) => c.id !== id));
    setCourseOrder((prev) => prev.filter((cid) => cid !== id));
  }, []);

  const addFinish = useCallback(() => {
    if (controls.some((c) => c.id === "F")) return;
    const start = controls.find((c) => c.id === "S");
    const lat = start ? start.lat + 0.0003 : mapCenter[0];
    const lng = start ? start.lng + 0.0003 : mapCenter[1];
    setControls((prev) => [...prev, { id: "F", lat, lng }]);
    setCourseOrder((prev) => [...prev, "F"]);
  }, [controls, mapCenter]);

  const moveOrderUp = useCallback((i: number) => {
    if (i <= 0) return;
    setCourseOrder((prev) => {
      const n = [...prev]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n;
    });
  }, []);

  const moveOrderDown = useCallback((i: number) => {
    setCourseOrder((prev) => {
      if (i >= prev.length - 1) return prev;
      const n = [...prev]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n;
    });
  }, []);

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

  const handleCsvImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;
      const lines = text.split("\n").filter(Boolean);
      const start = lines[0].includes("名前") || lines[0].includes("name") ? 1 : 0;
      const imported: ParticipantDraft[] = [];
      for (let i = start; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
        if (!cols[0]) continue;
        imported.push({
          name: cols[0], club: cols[1] || "", className: cols[2] || "",
          bibNumber: cols[3] || "", deviceImei: cols[4] || "",
          startTimeOffset: parseInt(cols[5] || "0", 10) || 0,
        });
      }
      setParticipants((prev) => [...prev, ...imported]);
    };
    reader.readAsText(file);
  }, []);

  // ─── Validation ───────────────────────────────────────

  const step1Valid = title.trim().length > 0 && date.length > 0;
  const step2Valid = controls.length >= 2;
  const step3Valid = devices.length > 0;
  const step4Valid = participants.length > 0 && participants.every((p) => p.name.trim());
  const canCreate = step1Valid && step2Valid && step3Valid && step4Valid;

  const unassignedDevices = devices.filter((d) => !participants.some((p) => p.deviceImei === d.imei)).length;
  const unassignedParticipants = participants.filter((p) => !p.deviceImei).length;

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6">
        <Link href="/tracking" className="text-xs text-muted hover:text-primary">← GPS追跡に戻る</Link>
        <h1 className="mt-2 text-2xl font-bold">ライブ追跡イベントを作成</h1>
      </div>

      {/* Step navigation */}
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1">
        {STEPS.map((s) => (
          <button
            key={s.key}
            onClick={() => setStep(s.key)}
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              step === s.key ? "bg-primary text-white" : "text-muted hover:bg-surface hover:text-foreground"
            }`}
          >
            <s.icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,400px]">
        {/* Map */}
        <div className="order-2 lg:order-1">
          <div className="overflow-hidden rounded-lg border border-border">
            <div ref={mapContainerRef} className="h-[400px] w-full lg:h-[560px]" />
          </div>
          {step === "omap" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {addingManual ? (
                <>
                  <span id="add-control-active" className="rounded bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary">
                    地図をクリックしてコントロールを配置
                  </span>
                  <button onClick={() => setAddingManual(false)} className="text-xs text-muted hover:text-foreground">
                    キャンセル
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setAddingManual(true)}
                    className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    手動追加
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
                  <span className="ml-auto text-[10px] text-muted">ドラッグで位置調整可</span>
                </>
              )}
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
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder="例: 第10回 代々木公園スプリント"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">開催日 *</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">開催地</label>
                  <input type="text" value={location} onChange={(e) => setLocation(e.target.value)}
                    placeholder="例: 東京都渋谷区"
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">説明（任意）</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                  placeholder="大会の概要、注意事項など"
                  className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div className="rounded bg-white/5 p-3 text-[11px] text-muted">
                <div className="mb-1 font-semibold text-foreground">地図の中心</div>
                地図をドラッグして大会エリアを表示してください
                <div className="mt-1 font-mono text-[10px]">
                  {mapCenter[0].toFixed(5)}, {mapCenter[1].toFixed(5)} / z{mapZoom.toFixed(1)}
                </div>
              </div>
              <button onClick={() => setStep("omap")} disabled={!step1Valid}
                className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40">
                次へ: O-map & コース
              </button>
            </div>
          )}

          {/* ── Step 2: O-map & Course ── */}
          {step === "omap" && (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-bold">O-map & コース設定</h2>

              {/* O-map upload */}
              {!omapImage ? (
                <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border bg-surface py-8 text-xs text-muted transition-colors hover:border-primary hover:text-primary">
                  <Image className="h-8 w-8" />
                  <span className="font-medium">O-map画像をアップロード</span>
                  <span className="text-[10px]">JPG / PNG 対応</span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOmapUpload(f); }} />
                </label>
              ) : (
                <div className="space-y-3">
                  {/* Overlay controls */}
                  <div className="flex items-center gap-2">
                    <Eye className="h-3.5 w-3.5 text-muted" />
                    <span className="text-[10px] text-muted">透過度</span>
                    <input type="range" min={0} max={1} step={0.05} value={overlayOpacity}
                      onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                      className="flex-1 accent-primary" />
                    <span className="w-8 text-right text-[10px] text-muted">{Math.round(overlayOpacity * 100)}%</span>
                  </div>

                  {/* Bounds adjustment */}
                  <div className="rounded bg-white/5 p-3">
                    <div className="mb-2 text-[11px] font-semibold text-foreground">座標合わせ</div>
                    <p className="mb-2 text-[10px] text-muted">
                      O-mapが実際の地形と重なるよう四隅の座標を調整してください
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {(["north", "south", "east", "west"] as const).map((dir) => (
                        <div key={dir} className="flex items-center gap-1">
                          <span className="w-6 text-[10px] text-muted">
                            {{ north: "北", south: "南", east: "東", west: "西" }[dir]}
                          </span>
                          <input type="number" step="0.0001"
                            value={imageBounds[dir]}
                            onChange={(e) => setImageBounds((prev) => ({ ...prev, [dir]: parseFloat(e.target.value) || 0 }))}
                            className="w-full rounded border border-border bg-surface px-1.5 py-1 font-mono text-[10px] outline-none focus:border-primary"
                          />
                        </div>
                      ))}
                    </div>
                    <label className="mt-2 flex cursor-pointer items-center gap-1 text-[10px] text-primary hover:underline">
                      <Image className="h-3 w-3" />
                      画像を変更
                      <input type="file" accept="image/*" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOmapUpload(f); }} />
                    </label>
                  </div>

                  {/* Auto detection */}
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <div className="mb-2 flex items-center gap-1.5">
                      <Wand2 className="h-4 w-4 text-primary" />
                      <span className="text-xs font-semibold text-foreground">コントロール自動検出</span>
                    </div>
                    <p className="mb-2 text-[10px] text-muted">
                      O-map上の紫色のコントロール円をAIで自動検出します。座標合わせを先に完了してください
                    </p>
                    <button
                      onClick={runDetection}
                      disabled={detecting}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-xs font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
                    >
                      {detecting ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin" />検出中...</>
                      ) : (
                        <><Wand2 className="h-3.5 w-3.5" />コントロールを自動検出</>
                      )}
                    </button>
                    {detectedRaw.length > 0 && (
                      <p className="mt-2 text-[10px] text-green-400">
                        {detectedRaw.length} 個のコントロール候補を検出しました
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Controls list */}
              {controls.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] font-medium text-muted">
                    コントロール一覧 ({controls.length}個)
                  </div>
                  <div className="max-h-[200px] space-y-1 overflow-y-auto">
                    {controls.map((ctrl) => (
                      <div key={ctrl.id} className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5 text-xs">
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${
                          ctrl.id === "S" || ctrl.id === "F" ? "bg-primary text-white" : "bg-white/10 text-foreground"
                        }`}>{ctrl.id}</span>
                        <span className="flex-1 font-mono text-[10px] text-muted">
                          {ctrl.lat.toFixed(5)}, {ctrl.lng.toFixed(5)}
                        </span>
                        <button onClick={() => removeControl(ctrl.id)} className="text-muted hover:text-red-400">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Course order */}
              {courseOrder.length > 1 && (
                <div>
                  <div className="mb-2 text-[10px] font-medium text-muted">通過順序</div>
                  <div className="max-h-[160px] space-y-1 overflow-y-auto">
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
                <button onClick={() => setStep("event")}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-muted hover:text-foreground">
                  戻る
                </button>
                <button onClick={() => setStep("devices")} disabled={!step2Valid}
                  className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40">
                  次へ: GPS端末
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Devices ── */}
          {step === "devices" && (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-bold">GPS端末の登録</h2>

              <div className="rounded bg-white/5 p-3">
                <div className="mb-2 text-[11px] font-semibold text-foreground">端末の送信先設定</div>
                <p className="mb-2 text-[11px] text-muted">GPS端末の管理画面で以下を設定してください</p>
                <div className="space-y-1.5 font-mono text-xs">
                  <div className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5">
                    <span className="text-muted">ホスト:</span>
                    <span className="font-medium text-foreground">tracking.trails.jp</span>
                  </div>
                  <div className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5">
                    <span className="text-muted">ポート:</span>
                    <span className="font-medium text-foreground">5023</span>
                  </div>
                  <div className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5">
                    <span className="text-muted">プロトコル:</span>
                    <span className="font-medium text-foreground">TCP</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted">送信間隔</label>
                <div className="flex gap-1">
                  {[1, 3, 5, 10, 15, 30].map((s) => (
                    <button key={s} onClick={() => setSendInterval(s)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        sendInterval === s ? "bg-primary text-white" : "border border-border text-muted hover:text-foreground"
                      }`}>{s}s</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted">IMEI番号を登録</label>
                <div className="flex gap-2">
                  <input type="text" value={newImei} onChange={(e) => setNewImei(e.target.value.replace(/\D/g, ""))}
                    placeholder="IMEI (15桁)" maxLength={15}
                    className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-primary" />
                  <input type="text" value={newDeviceLabel} onChange={(e) => setNewDeviceLabel(e.target.value)}
                    placeholder="ラベル"
                    className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
                  <button onClick={addDevice} disabled={newImei.length < 15}
                    className="rounded-lg bg-primary px-3 py-2 text-sm text-white hover:bg-primary-dark disabled:opacity-40">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {devices.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-[10px] font-medium text-muted">登録済み ({devices.length}台)</div>
                  {devices.map((d) => {
                    const assigned = participants.find((p) => p.deviceImei === d.imei);
                    return (
                      <div key={d.imei} className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5 text-xs">
                        <Settings className="h-3 w-3 flex-shrink-0 text-muted" />
                        <span className="font-mono text-[10px]">{d.imei}</span>
                        <span className="text-muted">{d.label}</span>
                        {assigned ? (
                          <span className="ml-auto rounded bg-green-500/15 px-1.5 py-0.5 text-[9px] text-green-400">→ {assigned.name || "未入力"}</span>
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
                <button onClick={() => setStep("omap")}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-muted hover:text-foreground">戻る</button>
                <button onClick={() => setStep("participants")} disabled={!step3Valid}
                  className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40">
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
                    <Upload className="h-3 w-3" />CSVインポート
                    <input type="file" accept=".csv" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvImport(f); e.target.value = ""; }} />
                  </label>
                  <button onClick={addParticipant}
                    className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-white hover:bg-primary-dark">
                    <Plus className="h-3 w-3" />追加
                  </button>
                </div>
              </div>

              <div className="rounded bg-white/5 px-3 py-2 text-[10px] text-muted">
                CSV: 名前, クラブ, クラス, ゼッケン, IMEI, スタート秒差
              </div>

              {participants.length > 0 ? (
                <div className="max-h-[340px] space-y-2 overflow-y-auto">
                  {participants.map((p, i) => (
                    <div key={i} className="rounded-lg border border-border bg-surface p-2.5">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                            style={{ backgroundColor: COLORS[i % COLORS.length] }}>{i + 1}</span>
                          <span className="text-xs font-medium">{p.name || "(未入力)"}</span>
                        </div>
                        <button onClick={() => removeParticipant(i)} className="text-muted hover:text-red-400">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" value={p.name} onChange={(e) => updateParticipant(i, "name", e.target.value)}
                          placeholder="名前 *" className="rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary" />
                        <input type="text" value={p.club} onChange={(e) => updateParticipant(i, "club", e.target.value)}
                          placeholder="クラブ" className="rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary" />
                        <input type="text" value={p.className} onChange={(e) => updateParticipant(i, "className", e.target.value)}
                          placeholder="クラス" className="rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary" />
                        <input type="text" value={p.bibNumber} onChange={(e) => updateParticipant(i, "bibNumber", e.target.value)}
                          placeholder="ゼッケン" className="rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary" />
                        <select value={p.deviceImei} onChange={(e) => updateParticipant(i, "deviceImei", e.target.value)}
                          className="rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary">
                          <option value="">GPS端末を選択</option>
                          {devices.map((d) => (
                            <option key={d.imei} value={d.imei}>{d.label} ({d.imei.slice(-4)})</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1">
                          <input type="number" value={p.startTimeOffset}
                            onChange={(e) => updateParticipant(i, "startTimeOffset", parseInt(e.target.value) || 0)}
                            className="w-full rounded border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary" placeholder="0" />
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
                <button onClick={() => setStep("devices")}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-muted hover:text-foreground">戻る</button>
                <button onClick={() => setStep("confirm")} disabled={!step4Valid}
                  className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40">
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
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="text-xs font-semibold text-foreground">{title}</div>
                  <div className="mt-1 space-y-0.5 text-[11px] text-muted">
                    <div>{date} / {location}</div>
                    {description && <div>{description}</div>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { v: controls.length, l: "コントロール" },
                    { v: devices.length, l: "GPS端末" },
                    { v: participants.length, l: "選手" },
                    { v: `${sendInterval}s`, l: "送信間隔" },
                  ].map((s) => (
                    <div key={s.l} className="rounded-lg border border-border bg-surface p-3 text-center">
                      <div className="text-lg font-bold text-primary">{s.v}</div>
                      <div className="text-[10px] text-muted">{s.l}</div>
                    </div>
                  ))}
                </div>
                {omapImage && (
                  <div className="flex items-center gap-2 rounded bg-green-500/10 px-3 py-2 text-xs text-green-400">
                    <Image className="h-3.5 w-3.5" /> O-map画像設定済み ({omapSize.w}x{omapSize.h}px)
                  </div>
                )}
                {(unassignedDevices > 0 || unassignedParticipants > 0) && (
                  <div className="space-y-1">
                    {unassignedParticipants > 0 && (
                      <div className="flex items-center gap-2 rounded bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />{unassignedParticipants}人にGPS端末が未割当
                      </div>
                    )}
                    {unassignedDevices > 0 && (
                      <div className="flex items-center gap-2 rounded bg-white/5 px-3 py-2 text-xs text-muted">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />{unassignedDevices}台が未使用
                      </div>
                    )}
                  </div>
                )}
                {!canCreate && (
                  <div className="rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">すべてのステップを完了してください</div>
                )}
                <div className="rounded bg-white/5 p-3">
                  <div className="mb-1 text-[11px] font-semibold text-foreground">配信URL（作成後に発行）</div>
                  <div className="font-mono text-[11px] text-muted">https://trailsjp.vercel.app/tracking/&#123;event-id&#125;</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep("participants")}
                  className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-muted hover:text-foreground">戻る</button>
                <button disabled={!canCreate}
                  className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-40">
                  <span className="flex items-center justify-center gap-1.5">
                    <Radio className="h-4 w-4" />イベントを作成
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
