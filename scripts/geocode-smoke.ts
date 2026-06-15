/**
 * ジオコーディング実データ・スモーク（再発防止ゲート）。
 *
 * 目的: 国土地理院(GSI)の **実レスポンス** に対して pickBestLatLng が
 * 難所の地名（同名近接・同名遠地）を正しく解決するかを検証する。
 * 単体テストは GSI をモックするため、実APIの揺れ（中目黒駅 が上位に来る等）は捕捉できない。
 * 座標・ジオコーディング関連を変更したら **デプロイ前に必ず実行**すること:
 *   npx tsx scripts/geocode-smoke.ts   （WSL node 上）
 *
 * 期待座標から ASSERT_KM 以内ならパス。全件パスで exit 0、1件でも外れたら exit 1。
 */
import { pickBestLatLng, haversineKm, TOKYO_STATION } from "../src/lib/carpool/geocode";

const ASSERT_KM = 2; // この距離以内なら正解とみなす

// query → 期待座標（実在地点）。ref は東京近辺のクラブを想定し東京駅。
const CASES: { query: string; expect: { lat: number; lng: number }; note: string }[] = [
  { query: "目黒駅", expect: { lat: 35.6329, lng: 139.7161 }, note: "中目黒駅(35.644,139.699)に誤解決しないこと" },
  { query: "中目黒駅", expect: { lat: 35.6442, lng: 139.6992 }, note: "中目黒は中目黒に" },
  { query: "練馬駅", expect: { lat: 35.7357, lng: 139.6518 }, note: "" },
  { query: "八王子駅", expect: { lat: 35.6559, lng: 139.3389 }, note: "" },
  { query: "新宿駅", expect: { lat: 35.6900, lng: 139.7004 }, note: "" },
];

async function fetchGsi(q: string): Promise<unknown> {
  const url = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(q);
  const res = await fetch(url, { headers: { "User-Agent": "trails.jp/1.0 (geocode smoke)" } });
  return res.json();
}

async function main() {
  let failed = 0;
  for (const c of CASES) {
    const features = await fetchGsi(c.query);
    const got = pickBestLatLng(features, TOKYO_STATION, c.query);
    if (!got) {
      console.log(`✗ ${c.query}: 解決できず（候補0）`);
      failed++;
      continue;
    }
    const d = haversineKm(got, c.expect);
    const ok = d <= ASSERT_KM;
    if (!ok) failed++;
    console.log(
      `${ok ? "✓" : "✗"} ${c.query} → (${got.lat.toFixed(4)}, ${got.lng.toFixed(4)}) ` +
        `期待(${c.expect.lat}, ${c.expect.lng}) ずれ ${d.toFixed(2)}km` +
        (c.note ? `  [${c.note}]` : ""),
    );
    await new Promise((r) => setTimeout(r, 300)); // GSI 負荷配慮
  }
  console.log(failed === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failed}件)`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
