"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  Play, Pause, SkipBack, SkipForward, Eye, EyeOff,
  ChevronRight, ChevronLeft, Clock, Users, MapPin, Radio,
  Upload, BarChart3,
} from "lucide-react";
import type { TrackingEvent, TrackPoint } from "@/lib/tracking/types";
import { parseGpx } from "@/lib/tracking/gpx-parser";

const SPEEDS = [1, 2, 3, 5, 10, 20, 50, 100, 200];

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getPositionAtTime(track: TrackPoint[], t: number): { lat: number; lng: number } | null {
  if (t < 0 || track.length === 0) return null;
  if (t <= track[0].time) return { lat: track[0].lat, lng: track[0].lng };
  if (t >= track[track.length - 1].time) return { lat: track[track.length - 1].lat, lng: track[track.length - 1].lng };

  for (let i = 1; i < track.length; i++) {
    if (track[i].time >= t) {
      const prev = track[i - 1];
      const next = track[i];
      const dt = next.time - prev.time;
      const ratio = dt === 0 ? 0 : (t - prev.time) / dt;
      return {
        lat: prev.lat + (next.lat - prev.lat) * ratio,
        lng: prev.lng + (next.lng - prev.lng) * ratio,
      };
    }
  }
  return null;
}

function getTrailUpToTime(track: TrackPoint[], t: number): [number, number][] {
  const coords: [number, number][] = [];
  for (const p of track) {
    if (p.time > t) break;
    coords.push([p.lng, p.lat]);
  }
  // Add interpolated current position
  const pos = getPositionAtTime(track, t);
  if (pos && coords.length > 0) {
    coords.push([pos.lng, pos.lat]);
  }
  return coords;
}

// Placement color
function placeColor(place: number): string {
  if (place === 1) return "#FFD700";
  if (place === 2) return "#C0C0C0";
  if (place === 3) return "#CD7F32";
  return "#8a9bb0";
}

interface Props {
  event: TrackingEvent;
}

export function TrackingView({ event }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, { setLngLat: (lnglat: [number, number]) => void; getElement: () => HTMLElement }>>(new Map());
  const animRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const currentTimeRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [currentTime, setCurrentTime] = useState(0);
  const [visible, setVisible] = useState<Set<string>>(() => new Set(event.participants.map((p) => p.id)));
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [splitsPanelOpen, setSplitsPanelOpen] = useState(false);
  const [showFullTrail, setShowFullTrail] = useState(false);
  const [massStart, setMassStart] = useState(false);

  // 一斉スタート時は startTime を無視して全員 0 扱い
  const getEffectiveStart = useCallback(
    (p: { startTime: number }) => (massStart ? 0 : p.startTime),
    [massStart]
  );

  const maxTime = useMemo(() => {
    return Math.max(
      ...event.participants.map((p) => getEffectiveStart(p) + p.raceTime),
      1
    );
  }, [event.participants, getEffectiveStart]);

  // Toggle visibility
  const toggleVisible = useCallback((id: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Init MapLibre
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
        center: [event.center[1], event.center[0]],
        zoom: event.zoom,
        minZoom: 4,
        maxZoom: 19,
      });

      mlMap.addControl(new maplibregl.NavigationControl(), "top-right");

      mlMap.on("load", () => {
        if (cancelled) return;

        // Add control point markers
        event.controls.forEach((ctrl) => {
          const el = document.createElement("div");
          const isStartFinish = ctrl.id === "S" || ctrl.id === "F";
          el.style.cssText = `
            width: ${isStartFinish ? "20px" : "16px"};
            height: ${isStartFinish ? "20px" : "16px"};
            border-radius: 50%;
            background: ${isStartFinish ? "#f97316" : "rgba(255,255,255,0.9)"};
            border: 2px solid ${isStartFinish ? "#ea580c" : "rgba(0,0,0,0.6)"};
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 8px;
            font-weight: bold;
            color: ${isStartFinish ? "white" : "#333"};
            box-shadow: 0 1px 3px rgba(0,0,0,0.4);
            cursor: default;
          `;
          el.textContent = ctrl.id;
          el.title = `Control ${ctrl.id}`;

          new maplibregl.Marker({ element: el })
            .setLngLat([ctrl.lng, ctrl.lat])
            .addTo(mlMap);
        });

        // Add route line sources for each participant
        event.participants.forEach((p) => {
          mlMap.addSource(`trail-${p.id}`, {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } },
          });
          mlMap.addLayer({
            id: `trail-line-${p.id}`,
            type: "line",
            source: `trail-${p.id}`,
            paint: {
              "line-color": p.color,
              "line-width": 3,
              "line-opacity": 0.85,
            },
          });

          // Full trail (low opacity)
          const fullCoords = p.track.map((pt) => [pt.lng, pt.lat]);
          mlMap.addSource(`full-trail-${p.id}`, {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: fullCoords } },
          });
          mlMap.addLayer({
            id: `full-trail-line-${p.id}`,
            type: "line",
            source: `full-trail-${p.id}`,
            paint: {
              "line-color": p.color,
              "line-width": 1.5,
              "line-opacity": 0,
              "line-dasharray": [2, 2],
            },
          });

          // Participant circle marker with name
          const dotEl = document.createElement("div");
          dotEl.style.cssText = `
            display: flex;
            align-items: center;
            gap: 2px;
            transition: opacity 0.2s;
            pointer-events: none;
          `;
          const circle = document.createElement("div");
          circle.style.cssText = `
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: ${p.color};
            border: 2.5px solid white;
            box-shadow: 0 2px 6px rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 9px;
            font-weight: bold;
            color: white;
            flex-shrink: 0;
          `;
          circle.textContent = p.name.charAt(0);
          const label = document.createElement("div");
          label.style.cssText = `
            background: rgba(0,0,0,0.7);
            color: white;
            font-size: 9px;
            font-weight: 600;
            padding: 1px 5px;
            border-radius: 3px;
            white-space: nowrap;
            line-height: 1.4;
          `;
          label.textContent = p.name.split(" ")[0];
          dotEl.appendChild(circle);
          dotEl.appendChild(label);
          const marker = new maplibregl.Marker({ element: dotEl, anchor: "left" })
            .setLngLat([event.center[1], event.center[0]])
            .addTo(mlMap);
          markersRef.current.set(p.id, marker);
        });
      });

      mapRef.current = mlMap;
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update map on visibility / showFullTrail changes
  useEffect(() => {
    const mlMap = mapRef.current;
    if (!mlMap || !mlMap.isStyleLoaded()) return;

    event.participants.forEach((p) => {
      const isVisible = visible.has(p.id);
      try {
        mlMap.setLayoutProperty(`trail-line-${p.id}`, "visibility", isVisible ? "visible" : "none");
        mlMap.setLayoutProperty(`full-trail-line-${p.id}`, "visibility", isVisible ? "visible" : "none");
        mlMap.setPaintProperty(`full-trail-line-${p.id}`, "line-opacity", showFullTrail && isVisible ? 0.3 : 0);
      } catch { /* layer not ready */ }

      const marker = markersRef.current.get(p.id);
      if (marker) {
        marker.getElement().style.opacity = isVisible ? "1" : "0";
      }
    });
  }, [visible, showFullTrail, event.participants]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying) {
      lastFrameRef.current = 0;
      return;
    }

    const tick = (timestamp: number) => {
      if (!lastFrameRef.current) lastFrameRef.current = timestamp;
      const delta = (timestamp - lastFrameRef.current) / 1000;
      lastFrameRef.current = timestamp;

      currentTimeRef.current = Math.min(currentTimeRef.current + delta * speed, maxTime);
      if (currentTimeRef.current >= maxTime) {
        setIsPlaying(false);
      }

      // Update map
      updateMapRoutes(currentTimeRef.current);

      // Update React state at ~15fps for UI
      setCurrentTime(currentTimeRef.current);

      if (currentTimeRef.current < maxTime) {
        animRef.current = requestAnimationFrame(tick);
      }
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, speed, maxTime]);

  // Also update when currentTime changes via seek
  const updateMapRoutes = useCallback(
    (time: number) => {
      const mlMap = mapRef.current;
      if (!mlMap || !mlMap.isStyleLoaded()) return;

      event.participants.forEach((p) => {
        if (!visible.has(p.id)) return;

        const participantTime = time - getEffectiveStart(p);
        const coords = getTrailUpToTime(p.track, participantTime);

        try {
          const src = mlMap.getSource(`trail-${p.id}`);
          if (src) {
            src.setData({
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: coords.length >= 2 ? coords : [] },
            });
          }
        } catch { /* */ }

        const pos = getPositionAtTime(p.track, participantTime);
        const marker = markersRef.current.get(p.id);
        if (marker && pos) {
          marker.setLngLat([pos.lng, pos.lat]);
          marker.getElement().style.display = participantTime >= 0 ? "block" : "none";
        } else if (marker) {
          marker.getElement().style.display = "none";
        }
      });
    },
    [event.participants, visible, getEffectiveStart]
  );

  // Seek handler
  const handleSeek = useCallback(
    (newTime: number) => {
      currentTimeRef.current = newTime;
      setCurrentTime(newTime);
      updateMapRoutes(newTime);
    },
    [updateMapRoutes]
  );

  // GPX upload
  const handleGpxUpload = useCallback(
    async (file: File) => {
      const text = await file.text();
      const track = parseGpx(text);
      if (track.length === 0) return;
      // Add as new participant (runtime only)
      const newParticipant = {
        id: `gpx-${Date.now()}`,
        name: file.name.replace(/\.gpx$/i, ""),
        club: "GPXアップロード",
        color: "#FF1493",
        className: "GPX",
        startTime: 0,
        raceTime: track[track.length - 1].time,
        track,
      };
      event.participants.push(newParticipant);
      setVisible((prev) => new Set([...prev, newParticipant.id]));

      // Add to map
      const mlMap = mapRef.current;
      if (mlMap && mlMap.isStyleLoaded()) {
        mlMap.addSource(`trail-${newParticipant.id}`, {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } },
        });
        mlMap.addLayer({
          id: `trail-line-${newParticipant.id}`,
          type: "line",
          source: `trail-${newParticipant.id}`,
          paint: { "line-color": newParticipant.color, "line-width": 3, "line-opacity": 0.85 },
        });

        const fullCoords = track.map((pt) => [pt.lng, pt.lat]);
        mlMap.addSource(`full-trail-${newParticipant.id}`, {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: fullCoords } },
        });
        mlMap.addLayer({
          id: `full-trail-line-${newParticipant.id}`,
          type: "line",
          source: `full-trail-${newParticipant.id}`,
          paint: { "line-color": newParticipant.color, "line-width": 1.5, "line-opacity": showFullTrail ? 0.3 : 0, "line-dasharray": [2, 2] },
        });

        const mod = await import("maplibre-gl");
        const dotEl = document.createElement("div");
        dotEl.style.cssText = `width:14px;height:14px;border-radius:50%;background:${newParticipant.color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);`;
        const marker = new mod.default.Marker({ element: dotEl })
          .setLngLat([event.center[1], event.center[0]])
          .addTo(mlMap);
        markersRef.current.set(newParticipant.id, marker);
      }
    },
    [event, showFullTrail]
  );

  // Split data for current event
  const splitsByControl = useMemo(() => {
    const map = new Map<string, typeof event.splits>();
    event.courseOrder.forEach((cid) => {
      map.set(cid, event.splits.filter((s) => s.controlId === cid));
    });
    return map;
  }, [event.splits, event.courseOrder]);

  return (
    <div className="relative flex h-[calc(100vh-56px)] overflow-hidden bg-background">
      {/* Left Sidebar - Participants */}
      <div
        className={`absolute left-0 top-0 z-30 flex h-full w-72 flex-col border-r border-border bg-card transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">参加者</span>
            <span className="text-[10px] text-muted">{event.participants.length}人</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="rounded p-1 text-muted hover:bg-surface hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {/* Participant List */}
        <div className="flex-1 overflow-y-auto">
          {event.participants.map((p) => {
            const isVis = visible.has(p.id);
            const participantTime = currentTime - getEffectiveStart(p);
            const hasStarted = participantTime >= 0;
            const hasFinished = participantTime >= p.raceTime;

            return (
              <div
                key={p.id}
                className={`flex items-center gap-2 border-b border-border/50 px-3 py-2 transition-colors hover:bg-surface ${
                  !isVis ? "opacity-40" : ""
                }`}
              >
                <button onClick={() => toggleVisible(p.id)} className="flex-shrink-0">
                  {isVis
                    ? <Eye className="h-3.5 w-3.5 text-muted" />
                    : <EyeOff className="h-3.5 w-3.5 text-muted" />
                  }
                </button>
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-full border border-white/20"
                  style={{ backgroundColor: p.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{p.name}</div>
                  <div className="text-[10px] text-muted">{p.club} · {p.className}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[11px] font-bold" style={{ color: p.color }}>
                    {hasStarted
                      ? hasFinished
                        ? formatTime(p.raceTime)
                        : formatTime(participantTime)
                      : "—"
                    }
                  </div>
                  {hasFinished && (
                    <div className="text-[9px] text-green-400">完走</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* GPX Upload */}
        <div className="border-t border-border p-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border bg-surface px-3 py-2 text-xs text-muted transition-colors hover:border-primary hover:text-primary">
            <Upload className="h-3.5 w-3.5" />
            GPXファイルをアップロード
            <input
              type="file"
              accept=".gpx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleGpxUpload(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {/* Sidebar Toggle */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute left-0 top-4 z-20 rounded-r-lg bg-card px-1.5 py-2 text-muted shadow-lg hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      {/* Map */}
      <div ref={mapContainerRef} className="h-full w-full" />

      {/* Event Info Badge */}
      <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-full bg-card/90 px-4 py-1.5 shadow-lg backdrop-blur">
          {event.status === "live" && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-red-400">
              <Radio className="h-3 w-3 animate-pulse" /> LIVE
            </span>
          )}
          <span className="text-sm font-bold">{event.title}</span>
          <span className="text-[10px] text-muted">{event.date}</span>
        </div>
      </div>

      {/* Splits Panel Toggle */}
      <button
        onClick={() => setSplitsPanelOpen(!splitsPanelOpen)}
        className="absolute right-3 top-16 z-20 flex items-center gap-1 rounded-lg bg-card/90 px-3 py-1.5 text-xs font-medium text-muted shadow-lg backdrop-blur hover:text-foreground"
      >
        <BarChart3 className="h-3.5 w-3.5" />
        スプリット
      </button>

      {/* Splits Panel */}
      {splitsPanelOpen && (
        <div className="absolute right-3 top-28 z-20 max-h-[60vh] w-80 overflow-y-auto rounded-lg border border-border bg-card/95 shadow-xl backdrop-blur">
          <div className="sticky top-0 border-b border-border bg-card px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold">スプリット分析</span>
              <button onClick={() => setSplitsPanelOpen(false)} className="text-muted hover:text-foreground">✕</button>
            </div>
          </div>
          <div className="p-2">
            {event.courseOrder.filter((c) => c !== "S").map((controlId) => {
              const entries = splitsByControl.get(controlId) ?? [];
              const sorted = [...entries].sort((a, b) => a.place - b.place);
              return (
                <div key={controlId} className="mb-2">
                  <div className="mb-1 flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-primary" />
                    <span className="text-[11px] font-bold">{controlId}</span>
                  </div>
                  {sorted.map((entry) => {
                    const participant = event.participants.find((p) => p.id === entry.participantId);
                    if (!participant) return null;
                    return (
                      <div key={entry.participantId} className="flex items-center gap-2 rounded px-2 py-0.5 text-[10px]">
                        <span className="w-4 font-bold" style={{ color: placeColor(entry.place) }}>
                          {entry.place}
                        </span>
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: participant.color }} />
                        <span className="flex-1 truncate">{participant.name}</span>
                        <span className="font-mono text-muted">{formatTime(entry.time)}</span>
                        {entry.leg > 0 && (
                          <span className="font-mono text-[9px] text-muted/60">({formatTime(entry.leg)})</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Map control buttons */}
      <div className="absolute bottom-24 right-3 z-20 flex flex-col gap-1.5">
        <button
          onClick={() => {
            setMassStart(!massStart);
            handleSeek(0);
            setIsPlaying(false);
          }}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur transition-colors ${
            massStart
              ? "bg-primary text-white"
              : "bg-card/90 text-muted hover:text-foreground"
          }`}
        >
          一斉スタート{massStart ? " ON" : " OFF"}
        </button>
        <button
          onClick={() => setShowFullTrail(!showFullTrail)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur transition-colors ${
            showFullTrail
              ? "bg-primary text-white"
              : "bg-card/90 text-muted hover:text-foreground"
          }`}
        >
          全ルート{showFullTrail ? "非表示" : "表示"}
        </button>
      </div>

      {/* Playback Controls */}
      <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-border bg-card/95 backdrop-blur">
        {/* Progress Bar */}
        <div className="px-4 pt-2">
          <input
            type="range"
            min={0}
            max={maxTime}
            step={1}
            value={currentTime}
            onChange={(e) => handleSeek(parseFloat(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-primary
              [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow"
          />
        </div>

        {/* Controls Row */}
        <div className="flex items-center gap-3 px-4 py-2">
          {/* Play/Pause */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => { handleSeek(0); setIsPlaying(false); }}
              className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground"
              title="最初に戻る"
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                if (currentTime >= maxTime) {
                  handleSeek(0);
                }
                setIsPlaying(!isPlaying);
              }}
              className="rounded-full bg-primary p-2 text-white shadow-lg hover:bg-primary-dark"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button
              onClick={() => handleSeek(maxTime)}
              className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground"
              title="最後まで"
            >
              <SkipForward className="h-4 w-4" />
            </button>
          </div>

          {/* Time Display */}
          <div className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-muted" />
            <span className="font-mono text-sm font-bold text-primary">
              {formatTime(currentTime)}
            </span>
            <span className="text-xs text-muted">/ {formatTime(maxTime)}</span>
          </div>

          {/* Speed Selector */}
          <div className="ml-auto flex items-center gap-1">
            <span className="text-[10px] text-muted">速度:</span>
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  speed === s
                    ? "bg-primary text-white"
                    : "text-muted hover:bg-surface hover:text-foreground"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
