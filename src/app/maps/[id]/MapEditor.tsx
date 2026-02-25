"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Save, X, Image, Move, RotateCw } from "lucide-react";
import type { OrienteeringMap, TerrainType } from "@/types/map";
import { TERRAIN_LABELS } from "@/lib/utils";
import "maplibre-gl/dist/maplibre-gl.css";

interface MapEditorProps {
  map: OrienteeringMap;
  onClose: () => void;
}

const TERRAIN_OPTIONS: { value: TerrainType; label: string }[] = [
  { value: "forest", label: "森林" },
  { value: "park", label: "公園" },
  { value: "urban", label: "市街地" },
  { value: "sand", label: "砂丘" },
  { value: "mixed", label: "混合" },
];

export function MapEditor({ map, onClose }: MapEditorProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundsLayerRef = useRef<any>(null);

  const [formData, setFormData] = useState({
    name: map.name,
    prefecture: map.prefecture,
    city: map.city,
    terrain_type: map.terrain_type as TerrainType,
    scale: map.scale,
    contour_interval: map.contour_interval,
    created_year: map.created_year,
    creator: map.creator,
    description: map.description ?? "",
    tags: map.tags.join(", "),
  });

  const [bounds, setBounds] = useState({
    north: map.bounds.north,
    south: map.bounds.south,
    east: map.bounds.east,
    west: map.bounds.west,
  });

  const [overlayImage, setOverlayImage] = useState<string | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(0.6);
  const [editingBounds, setEditingBounds] = useState(false);
  const [saved, setSaved] = useState(false);

  // Init map
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
        center: [map.center.lng, map.center.lat],
        zoom: 14,
        minZoom: 4,
        maxZoom: 19,
      });

      mlMap.addControl(new maplibregl.NavigationControl(), "top-right");

      mlMap.on("load", () => {
        if (cancelled) return;

        // Draw bounds rectangle
        updateBoundsOnMap(mlMap, bounds);

        // Add draggable corner markers
        const corners = [
          { id: "nw", lat: bounds.north, lng: bounds.west },
          { id: "ne", lat: bounds.north, lng: bounds.east },
          { id: "se", lat: bounds.south, lng: bounds.east },
          { id: "sw", lat: bounds.south, lng: bounds.west },
        ];

        corners.forEach((corner) => {
          const el = document.createElement("div");
          el.style.cssText = `
            width: 12px; height: 12px; border-radius: 50%;
            background: #f97316; border: 2px solid white;
            box-shadow: 0 1px 3px rgba(0,0,0,0.4); cursor: move;
          `;
          el.dataset.corner = corner.id;

          new maplibregl.Marker({ element: el, draggable: true })
            .setLngLat([corner.lng, corner.lat])
            .addTo(mlMap)
            .on("dragend", function () {
              // @ts-expect-error marker method
              const lngLat = this.getLngLat();
              setBounds((prev) => {
                const next = { ...prev };
                if (corner.id.includes("n")) next.north = lngLat.lat;
                if (corner.id.includes("s")) next.south = lngLat.lat;
                if (corner.id.includes("e")) next.east = lngLat.lng;
                if (corner.id.includes("w")) next.west = lngLat.lng;
                updateBoundsOnMap(mlMap, next);
                return next;
              });
            });
        });
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function updateBoundsOnMap(mlMap: any, b: typeof bounds) {
    const coords = [
      [b.west, b.north],
      [b.east, b.north],
      [b.east, b.south],
      [b.west, b.south],
      [b.west, b.north],
    ];
    const data = {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Polygon" as const, coordinates: [coords] },
    };

    if (mlMap.getSource("edit-bounds")) {
      mlMap.getSource("edit-bounds").setData(data);
    } else {
      mlMap.addSource("edit-bounds", { type: "geojson", data });
      mlMap.addLayer({
        id: "edit-bounds-fill",
        type: "fill",
        source: "edit-bounds",
        paint: { "fill-color": "#f97316", "fill-opacity": 0.1 },
      });
      mlMap.addLayer({
        id: "edit-bounds-line",
        type: "line",
        source: "edit-bounds",
        paint: { "line-color": "#f97316", "line-width": 2, "line-dasharray": [3, 2] },
      });
    }

    // Update overlay image bounds if exists
    if (mlMap.getSource("omap-overlay")) {
      // MapLibre doesn't support updating image source coordinates easily,
      // so we'll handle this differently
    }
  }

  // Handle O-map image upload
  const handleImageUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setOverlayImage(dataUrl);

      const mlMap = mapRef.current;
      if (!mlMap || !mlMap.isStyleLoaded()) return;

      // Add or update image overlay
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
      }, "edit-bounds-fill");
    };
    reader.readAsDataURL(file);
  }, [bounds, overlayOpacity]);

  // Update overlay opacity
  useEffect(() => {
    const mlMap = mapRef.current;
    if (!mlMap || !mlMap.isStyleLoaded()) return;
    try {
      mlMap.setPaintProperty("omap-overlay-layer", "raster-opacity", overlayOpacity);
    } catch { /* layer may not exist */ }
  }, [overlayOpacity]);

  const handleSave = () => {
    const updatedMap = {
      ...map,
      ...formData,
      tags: formData.tags.split(",").map((t) => t.trim()).filter(Boolean),
      bounds,
      center: {
        lat: (bounds.north + bounds.south) / 2,
        lng: (bounds.east + bounds.west) / 2,
      },
    };
    // TODO: API save - for now just show success
    console.log("Saving map:", updatedMap);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-background/95 backdrop-blur">
      {/* Left: Form */}
      <div className="flex w-96 flex-col border-r border-border bg-card overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold">地図を編集</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 p-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">地図名</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          {/* Location */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">都道府県</label>
              <input
                type="text"
                value={formData.prefecture}
                onChange={(e) => setFormData({ ...formData, prefecture: e.target.value })}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">市区町村</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Terrain */}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">テレイン種別</label>
            <select
              value={formData.terrain_type}
              onChange={(e) => setFormData({ ...formData, terrain_type: e.target.value as TerrainType })}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {TERRAIN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Scale / Contour */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">縮尺</label>
              <input
                type="text"
                value={formData.scale}
                onChange={(e) => setFormData({ ...formData, scale: e.target.value })}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                placeholder="1:10000"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">等高線間隔(m)</label>
              <input
                type="number"
                value={formData.contour_interval}
                onChange={(e) => setFormData({ ...formData, contour_interval: parseInt(e.target.value) || 0 })}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Year / Creator */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">作成年</label>
              <input
                type="number"
                value={formData.created_year}
                onChange={(e) => setFormData({ ...formData, created_year: parseInt(e.target.value) || 0 })}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">作成者</label>
              <input
                type="text"
                value={formData.creator}
                onChange={(e) => setFormData({ ...formData, creator: e.target.value })}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">タグ (カンマ区切り)</label>
            <input
              type="text"
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="スプリント, 公園, 初心者向け"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">説明</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          {/* O-map Upload */}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">O-Map画像</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border bg-surface px-3 py-3 text-xs text-muted transition-colors hover:border-primary hover:text-primary">
              <Image className="h-4 w-4" />
              {overlayImage ? "画像を変更" : "O-Map画像をアップロード"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(file);
                }}
              />
            </label>
            {overlayImage && (
              <div className="mt-2">
                <label className="mb-1 block text-[10px] text-muted">透過度: {Math.round(overlayOpacity * 100)}%</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={overlayOpacity}
                  onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            )}
          </div>

          {/* Bounds Info */}
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">
              <Move className="mr-1 inline h-3 w-3" />
              範囲 (四隅をドラッグで調整)
            </label>
            <div className="grid grid-cols-2 gap-1 text-[10px] text-muted">
              <span>北: {bounds.north.toFixed(5)}</span>
              <span>東: {bounds.east.toFixed(5)}</span>
              <span>南: {bounds.south.toFixed(5)}</span>
              <span>西: {bounds.west.toFixed(5)}</span>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="border-t border-border p-4">
          <button
            onClick={handleSave}
            className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors ${
              saved ? "bg-green-600" : "bg-primary hover:bg-primary-dark"
            }`}
          >
            <Save className="h-4 w-4" />
            {saved ? "保存しました" : "保存"}
          </button>
        </div>
      </div>

      {/* Right: Map */}
      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="h-full w-full" />
        <div className="absolute top-3 left-3 z-10 rounded-lg bg-card/90 px-3 py-2 text-xs text-muted backdrop-blur shadow-lg">
          <RotateCw className="mr-1 inline h-3 w-3" />
          四隅の●をドラッグして範囲を調整。O-Map画像をアップロードして座標合わせ。
        </div>
      </div>
    </div>
  );
}
