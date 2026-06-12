"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

interface NodeMapPickerProps {
  /** フォームの緯度（文字列・空可） */
  lat: string;
  /** フォームの経度（文字列・空可） */
  lng: string;
  /** 地図操作で座標が決まったとき（6桁丸め済みの数値） */
  onPick: (lat: number, lng: number) => void;
  /** 座標未設定時の初期中心（クラブの既存ノード由来）。無ければ東京駅。 */
  fallbackCenter?: { lat: number; lng: number } | null;
}

// バンドル衛生のため、サーバ寄りモジュールを引かずローカル定数で東京駅を持つ。
const TOKYO_STATION = { lat: 35.681, lng: 139.767 };

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// 緯度経度の文字列が有効座標かを判定し、数値ペアを返す（空文字・NaN・範囲外は null）。
function parseCoords(lat: string, lng: string): { lat: number; lng: number } | null {
  if (lat === "" || lng === "") return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

export default function NodeMapPicker({ lat, lng, onPick, fallbackCenter }: NodeMapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mlRef = useRef<any>(null);
  // onPick の同一性に init effect が依存しないよう ref で持つ。
  const onPickRef = useRef(onPick);
  // フィードバックループ防止: 直近に onPick した値を覚えておき、props で戻ってきたら無視する。
  const lastPickedRef = useRef<{ lat: number; lng: number } | null>(null);

  // onPick を最新に保つ（init effect は onPickRef 経由で参照する）。
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  // 地図はマウント時に一度だけ生成し、以降の同期は [lat,lng] effect 側で行う。
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    const initial = parseCoords(lat, lng);
    const center = initial ?? fallbackCenter ?? TOKYO_STATION;
    const zoom = initial ? 14 : 11;

    import("maplibre-gl").then((mod) => {
      if (cancelled || !containerRef.current) return;
      const maplibregl = mod.default;
      mlRef.current = maplibregl;

      const mlMap = new maplibregl.Map({
        container: containerRef.current,
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
        center: [center.lng, center.lat],
        zoom,
      });

      mlMap.addControl(new maplibregl.NavigationControl(), "top-right");

      // 座標が確定したら markerRef を立て、6桁に丸めて onPick へ通知する。
      const placeMarker = (lngLat: { lng: number; lat: number }) => {
        const rLat = round6(lngLat.lat);
        const rLng = round6(lngLat.lng);
        if (!markerRef.current) {
          markerRef.current = new maplibregl.Marker({ color: "#f97316", draggable: true })
            .setLngLat([lngLat.lng, lngLat.lat])
            .addTo(mlMap)
            .on("dragend", function () {
              // @ts-expect-error marker method
              const ll = this.getLngLat();
              const dLat = round6(ll.lat);
              const dLng = round6(ll.lng);
              lastPickedRef.current = { lat: dLat, lng: dLng };
              onPickRef.current(dLat, dLng);
            });
        } else {
          markerRef.current.setLngLat([lngLat.lng, lngLat.lat]);
        }
        lastPickedRef.current = { lat: rLat, lng: rLng };
        onPickRef.current(rLat, rLng);
      };

      // 初期座標があれば最初からドラッグ可能なマーカーを置く（通知はしない＝既存値の保持）。
      if (initial) {
        markerRef.current = new maplibregl.Marker({ color: "#f97316", draggable: true })
          .setLngLat([initial.lng, initial.lat])
          .addTo(mlMap)
          .on("dragend", function () {
            // @ts-expect-error marker method
            const ll = this.getLngLat();
            const dLat = round6(ll.lat);
            const dLng = round6(ll.lng);
            lastPickedRef.current = { lat: dLat, lng: dLng };
            onPickRef.current(dLat, dLng);
          });
        lastPickedRef.current = { lat: round6(initial.lat), lng: round6(initial.lng) };
      }

      // 地図クリックでマーカーを移動（初回クリックで生成）し、座標を通知する。
      mlMap.on("click", (e: { lngLat: { lng: number; lat: number } }) => {
        placeMarker(e.lngLat);
      });

      mapRef.current = mlMap;
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // 地図はマウント時に一度だけ生成する（以降の同期は [lat,lng] effect）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // props（フォーム値）駆動の同期: 地図を作り直さずにマーカー位置だけ更新する。
  useEffect(() => {
    const coords = parseCoords(lat, lng);
    if (!coords) return;
    const mlMap = mapRef.current;
    const maplibregl = mlRef.current;
    if (!mlMap || !maplibregl) return;

    const rLat = round6(coords.lat);
    const rLng = round6(coords.lng);

    // 自分が onPick した値が props として戻ってきただけなら何もしない（ループ防止）。
    const last = lastPickedRef.current;
    if (last && Math.abs(last.lat - rLat) < 1e-6 && Math.abs(last.lng - rLng) < 1e-6) {
      return;
    }

    // マーカーが無ければ生成、あれば現在位置と十分違うときだけ動かす。
    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ color: "#f97316", draggable: true })
        .setLngLat([rLng, rLat])
        .addTo(mlMap)
        .on("dragend", function () {
          // @ts-expect-error marker method
          const ll = this.getLngLat();
          const dLat = round6(ll.lat);
          const dLng = round6(ll.lng);
          lastPickedRef.current = { lat: dLat, lng: dLng };
          onPickRef.current(dLat, dLng);
        });
      mlMap.easeTo({ center: [rLng, rLat] });
    } else {
      const cur = markerRef.current.getLngLat();
      if (Math.abs(cur.lat - rLat) >= 1e-6 || Math.abs(cur.lng - rLng) >= 1e-6) {
        markerRef.current.setLngLat([rLng, rLat]);
        mlMap.easeTo({ center: [rLng, rLat] });
      }
    }
    lastPickedRef.current = { lat: rLat, lng: rLng };
  }, [lat, lng]);

  const hasCoords = parseCoords(lat, lng) !== null;

  return (
    <div>
      <div
        ref={containerRef}
        className="h-[260px] w-full overflow-hidden rounded-lg border border-border"
      />
      <p className="mt-1 text-xs text-muted">
        {hasCoords
          ? "ピンをドラッグ、または地図をタップして位置を調整できます"
          : "地図をタップして位置を指定できます"}
      </p>
    </div>
  );
}
