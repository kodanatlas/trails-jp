"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { Search, X, Layers, Eye, ExternalLink, List, MapPlus } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { OrienteeringMap, TerrainType } from "@/types/map";
import { TERRAIN_LABELS } from "@/lib/utils";

interface MapBrowserProps {
  maps: OrienteeringMap[];
}

const TERRAIN_FILTERS: { key: TerrainType | ""; label: string; color?: string }[] = [
  { key: "", label: "すべて" },
  { key: "forest", label: "森林", color: "#FF00FF" },
  { key: "park", label: "公園", color: "#00FFF6" },
  { key: "urban", label: "市街地", color: "#8a8ab0" },
  { key: "sand", label: "砂丘", color: "#afcc21" },
  { key: "mixed", label: "混合", color: "#00FF18" },
];

// Polygon color by terrain type (matching trails.lt style)
function getTerrainColor(t: TerrainType): string {
  switch (t) {
    case "forest": return "#FF00FF";
    case "park": return "#00FFF6";
    case "urban": return "#8a8ab0";
    case "sand": return "#afcc21";
    case "mixed": return "#00FF18";
  }
}

const BASE_MAPS = [
  { key: "gsi-std", label: "国土地理院", url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", attribution: "&copy; 国土地理院" },
  { key: "gsi-photo", label: "航空写真", url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", attribution: "&copy; 国土地理院" },
  { key: "osm", label: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenStreetMap contributors" },
];

// Generate a simple rectangle polygon from bounds
function boundsToPolygon(bounds: OrienteeringMap["bounds"]): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[
        [bounds.west, bounds.north],
        [bounds.east, bounds.north],
        [bounds.east, bounds.south],
        [bounds.west, bounds.south],
        [bounds.west, bounds.north],
      ]],
    },
  };
}

export function MapBrowser({ maps }: MapBrowserProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  const [query, setQuery] = useState("");
  const [terrainFilter, setTerrainFilter] = useState<TerrainType | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [baseMap, setBaseMap] = useState("gsi-std");
  const [showBaseMapPicker, setShowBaseMapPicker] = useState(false);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);

  const filtered = useMemo(() => {
    return maps.filter((m) => {
      if (query) {
        const q = query.toLowerCase();
        if (
          !m.name.toLowerCase().includes(q) &&
          !m.prefecture.includes(q) &&
          !m.city.includes(q) &&
          !m.creator.includes(q)
        )
          return false;
      }
      if (terrainFilter && m.terrain_type !== terrainFilter) return false;
      return true;
    });
  }, [maps, query, terrainFilter]);

  const selectMap = useCallback((m: OrienteeringMap) => {
    setSelectedId(m.id);
    setInfoPanelOpen(true);
    const mlMap = mapInstanceRef.current;
    if (mlMap) {
      mlMap.fitBounds(
        [[m.bounds.west, m.bounds.south], [m.bounds.east, m.bounds.north]],
        { padding: 80, duration: 1200 }
      );
    }
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let cancelled = false;

    import("maplibre-gl").then((mod) => {
      if (cancelled || !mapContainerRef.current) return;
      const maplibregl = mod.default;
      const currentBase = BASE_MAPS.find((b) => b.key === baseMap) ?? BASE_MAPS[0];

      const mlMap = new maplibregl.Map({
        container: mapContainerRef.current,
        style: {
          version: 8,
          sources: {
            base: {
              type: "raster",
              tiles: [currentBase.url],
              tileSize: 256,
              attribution: currentBase.attribution,
            },
          },
          layers: [{ id: "base-layer", type: "raster", source: "base" }],
        },
        center: [137.0, 36.5],
        zoom: 5.5,
        minZoom: 4,
        maxZoom: 18,
      });

      mlMap.addControl(new maplibregl.NavigationControl(), "top-right");

      mlMap.on("load", () => {
        if (cancelled) return;

        // Add polygon outlines for each map (trails.lt style)
        maps.forEach((m) => {
          const polygon = boundsToPolygon(m.bounds);
          const color = getTerrainColor(m.terrain_type);

          mlMap.addSource(`map-polygon-${m.id}`, {
            type: "geojson",
            data: polygon,
          });

          // Outline
          mlMap.addLayer({
            id: `map-outline-${m.id}`,
            type: "line",
            source: `map-polygon-${m.id}`,
            paint: {
              "line-color": color,
              "line-width": 2,
              "line-opacity": 0.8,
            },
          });

          // Fill (nearly transparent, for click detection)
          mlMap.addLayer({
            id: `map-fill-${m.id}`,
            type: "fill",
            source: `map-polygon-${m.id}`,
            paint: {
              "fill-color": color,
              "fill-opacity": 0.05,
            },
          });

          // Highlight layer (hidden by default)
          mlMap.addLayer({
            id: `map-highlight-${m.id}`,
            type: "line",
            source: `map-polygon-${m.id}`,
            paint: {
              "line-color": "#FFFF00",
              "line-width": 3,
              "line-opacity": 0,
            },
          });

          // Click on polygon
          mlMap.on("click", `map-fill-${m.id}`, () => {
            setSelectedId(m.id);
            setInfoPanelOpen(true);
            mlMap.fitBounds(
              [[m.bounds.west, m.bounds.south], [m.bounds.east, m.bounds.north]],
              { padding: 80, duration: 800 }
            );
          });

          // Hover on polygon
          mlMap.on("mouseenter", `map-fill-${m.id}`, () => {
            mlMap.getCanvas().style.cursor = "pointer";
            mlMap.setPaintProperty(`map-highlight-${m.id}`, "line-opacity", 1);
          });
          mlMap.on("mouseleave", `map-fill-${m.id}`, () => {
            mlMap.getCanvas().style.cursor = "";
            mlMap.setPaintProperty(`map-highlight-${m.id}`, "line-opacity", 0);
          });
        });
      });

      mapInstanceRef.current = mlMap;
    });

    return () => {
      cancelled = true;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseMap]);

  // Highlight selected/hovered polygon
  useEffect(() => {
    const mlMap = mapInstanceRef.current;
    if (!mlMap || !mlMap.isStyleLoaded()) return;

    maps.forEach((m) => {
      const isSelected = m.id === selectedId;
      const isHovered = m.id === hoveredId;
      try {
        mlMap.setPaintProperty(`map-highlight-${m.id}`, "line-opacity", isSelected || isHovered ? 1 : 0);
        mlMap.setPaintProperty(`map-outline-${m.id}`, "line-width", isSelected ? 3 : 2);
      } catch {
        // Layer may not exist yet
      }
    });
  }, [selectedId, hoveredId, maps]);

  const selectedMap = maps.find((m) => m.id === selectedId);

  return (
    <div className="relative flex h-[calc(100vh-56px)] overflow-hidden">
      {/* Left Sidebar */}
      <div
        className={`absolute left-0 top-0 z-30 flex h-full flex-col bg-white text-gray-900 shadow-xl transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ width: "320px" }}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(false)}
              className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
            <span className="text-sm font-bold text-[#f97316]">trails.jp</span>
            <span className="text-[10px] text-gray-400">地図データベース</span>
          </div>
        </div>

        {/* Search */}
        <div className="border-b border-gray-200 bg-[#bbc6d2] px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="地図名・地域で検索..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 outline-none focus:border-[#f97316]"
            />
          </div>
        </div>

        {/* Terrain Filters */}
        <div className="flex flex-wrap gap-1 border-b border-gray-200 bg-[#bbc6d2] px-3 py-1.5">
          {TERRAIN_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setTerrainFilter(f.key)}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                terrainFilter === f.key
                  ? "bg-[#f97316] text-white"
                  : "bg-white/60 text-gray-600 hover:bg-white"
              }`}
            >
              {f.color && (
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: f.color }}
                />
              )}
              {f.label}
            </button>
          ))}
        </div>

        {/* Sample data notice */}
        {filtered.some((m) => m.isSample) && (
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
            現在のO-mapはサンプルデータです。「O-mapを登録する」から実データを追加できます。
          </div>
        )}

        {/* Map List */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map((m) => (
            <div
              key={m.id}
              className={`flex w-full items-center gap-2 border-b border-gray-100 px-3 py-2 text-left transition-colors hover:bg-blue-50 ${
                selectedId === m.id ? "bg-blue-100" : ""
              }`}
              onMouseEnter={() => setHoveredId(m.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Map name (clickable, zooms to map) */}
              <button
                onClick={() => selectMap(m)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full border border-white"
                    style={{ backgroundColor: getTerrainColor(m.terrain_type), boxShadow: "0 0 0 1px rgba(0,0,0,0.2)" }}
                  />
                  <span className="truncate text-sm font-medium text-blue-700 hover:underline">
                    {m.name}
                  </span>
                  {m.isSample && (
                    <span className="flex-shrink-0 rounded bg-gray-200 px-1 py-0.5 text-[9px] font-medium leading-none text-gray-500">
                      サンプル
                    </span>
                  )}
                </div>
              </button>

              {/* Year */}
              <span className="flex-shrink-0 text-xs text-gray-400">
                {m.created_year}
              </span>

              {/* Eye icon (future: toggle overlay) */}
              <button
                className="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                title="地図を表示"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>

              {/* External link to detail */}
              <Link
                href={`/maps/${m.id}`}
                className="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                title="詳細ページ"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-gray-400">
              該当する地図がありません
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 bg-gray-50 px-3 py-2">
          <Link
            href="/upload"
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[#f97316] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#ea580c]"
          >
            <MapPlus className="h-3.5 w-3.5" />
            O-mapを登録する
          </Link>
          <div className="mt-1.5 text-center text-[11px] text-gray-400">
            {filtered.length} 件のO-map
          </div>
        </div>
      </div>

      {/* Sidebar Toggle (when closed) */}
      {!sidebarOpen && (
        <div className="absolute left-0 top-36 z-20 flex flex-col gap-1">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex items-center gap-1 rounded-r-lg bg-white px-2 py-2 text-gray-600 shadow-lg hover:bg-gray-50"
            title="地図リスト"
          >
            <List className="h-4 w-4" />
          </button>
          <Link
            href="/upload"
            className="flex items-center gap-1 rounded-r-lg bg-[#f97316] px-2 py-2 text-white shadow-lg hover:bg-[#ea580c]"
            title="O-mapを登録する"
          >
            <MapPlus className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* Info Panel (slides down from top, trails.lt style) */}
      <div
        className={`absolute left-1/2 top-0 z-20 w-[600px] max-w-[calc(100%-20px)] -translate-x-1/2 overflow-hidden rounded-b-lg bg-white shadow-xl transition-all duration-500 ease-in-out sm:left-auto sm:right-4 sm:translate-x-0 sm:max-w-[500px] ${
          infoPanelOpen && selectedMap ? "max-h-[250px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        {selectedMap && (
          <div className="p-3">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-white"
                    style={{ backgroundColor: getTerrainColor(selectedMap.terrain_type), boxShadow: "0 0 0 1px rgba(0,0,0,0.15)" }}
                  />
                  <h3 className="text-sm font-bold text-gray-900">{selectedMap.name}</h3>
                  {selectedMap.isSample && (
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                      サンプル
                    </span>
                  )}
                </div>
                {selectedMap.description && (
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    {selectedMap.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => { setInfoPanelOpen(false); setSelectedId(null); }}
                className="ml-2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Details table (trails.lt style) */}
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-gray-400">
                  <th className="pb-1 text-left font-medium">場所</th>
                  <th className="pb-1 text-left font-medium">テレイン</th>
                  <th className="pb-1 text-left font-medium">縮尺</th>
                  <th className="hidden pb-1 text-left font-medium sm:table-cell">等高線</th>
                  <th className="pb-1 text-left font-medium">年</th>
                  <th className="hidden pb-1 text-left font-medium sm:table-cell">作成者</th>
                  <th className="pb-1 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-gray-700">
                  <td className="py-1.5">{selectedMap.prefecture} {selectedMap.city}</td>
                  <td className="py-1.5">{TERRAIN_LABELS[selectedMap.terrain_type]}</td>
                  <td className="py-1.5">{selectedMap.scale}</td>
                  <td className="hidden py-1.5 sm:table-cell">{selectedMap.contour_interval}m</td>
                  <td className="py-1.5">{selectedMap.created_year}</td>
                  <td className="hidden py-1.5 sm:table-cell">{selectedMap.creator}</td>
                  <td className="py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        title="地図をオーバーレイ"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <Link
                        href={`/maps/${selectedMap.id}`}
                        className="rounded p-1 text-[#f97316] hover:bg-orange-50"
                        title="詳細ページ"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Tags */}
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedMap.tags.map((tag) => (
                <span key={tag} className="rounded bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-[#f97316]">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Base Map Switcher */}
      <div className="absolute bottom-4 right-4 z-20">
        <button
          onClick={() => setShowBaseMapPicker(!showBaseMapPicker)}
          className="rounded-lg bg-white p-2 shadow-lg hover:bg-gray-50"
          title="ベースマップ切替"
        >
          <Layers className="h-5 w-5 text-gray-600" />
        </button>
        {showBaseMapPicker && (
          <div className="absolute bottom-12 right-0 w-44 rounded-lg bg-white p-1 shadow-xl">
            {BASE_MAPS.map((b) => (
              <button
                key={b.key}
                onClick={() => { setBaseMap(b.key); setShowBaseMapPicker(false); }}
                className={`block w-full rounded px-3 py-1.5 text-left text-sm transition-colors ${
                  baseMap === b.key
                    ? "bg-[#f97316] text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Full-screen Map */}
      <div ref={mapContainerRef} className="h-full w-full" />
    </div>
  );
}
