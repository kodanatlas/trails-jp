"use client";

import { useEffect, useRef, useState } from "react";
import { Layers } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { OrienteeringMap } from "@/types/map";

interface MapViewerProps {
  map: OrienteeringMap;
}

const BASE_MAPS = [
  { key: "gsi-std", label: "国土地理院", url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", attr: "&copy; 国土地理院" },
  { key: "gsi-photo", label: "航空写真", url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", attr: "&copy; 国土地理院" },
  { key: "osm", label: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: "&copy; OSM" },
];

export function MapViewer({ map }: MapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);
  const [opacity, setOpacity] = useState(0.7);
  const [loaded, setLoaded] = useState(false);
  const [baseMap, setBaseMap] = useState("gsi-std");
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    import("maplibre-gl").then((mod) => {
      if (cancelled || !containerRef.current) return;
      const maplibregl = mod.default;
      const base = BASE_MAPS.find((b) => b.key === baseMap) ?? BASE_MAPS[0];

      const mlMap = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            base: { type: "raster", tiles: [base.url], tileSize: 256, attribution: base.attr },
          },
          layers: [{ id: "base-layer", type: "raster", source: "base" }],
        },
        center: [map.center.lng, map.center.lat],
        zoom: 14,
      });

      mlMap.addControl(new maplibregl.NavigationControl(), "top-right");

      // Marker at map center
      new maplibregl.Marker({ color: "#f97316" })
        .setLngLat([map.center.lng, map.center.lat])
        .addTo(mlMap);

      mlMap.on("load", () => {
        if (!cancelled) setLoaded(true);
      });

      mapRef.current = mlMap;
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.center.lat, map.center.lng, baseMap]);

  return (
    <div className="relative">
      <div ref={containerRef} className="h-[350px] w-full sm:h-[450px]" />

      {/* Base map switcher */}
      <div className="absolute right-2 top-2 z-10">
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="rounded-lg bg-[#1a2332]/90 p-2 text-white shadow-lg backdrop-blur hover:bg-[#1a2332]"
        >
          <Layers className="h-4 w-4" />
        </button>
        {showPicker && (
          <div className="absolute right-0 top-10 w-36 rounded-lg bg-[#1a2332]/95 p-1 shadow-xl backdrop-blur">
            {BASE_MAPS.map((b) => (
              <button
                key={b.key}
                onClick={() => { setBaseMap(b.key); setShowPicker(false); }}
                className={`block w-full rounded px-2.5 py-1.5 text-left text-xs transition-colors ${
                  baseMap === b.key ? "bg-primary text-white" : "text-white/70 hover:bg-white/10"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Opacity control */}
      {loaded && (
        <div className="flex items-center gap-4 border-t border-border bg-card px-4 py-2.5">
          <label className="text-[10px] text-muted">オーバーレイ透過度</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="text-[10px] tabular-nums text-muted">{Math.round(opacity * 100)}%</span>
        </div>
      )}
    </div>
  );
}
