#!/usr/bin/env node
/**
 * events.json の各イベントにJOY詳細ページから座標を付与する
 * Usage: node scripts/enrich-coordinates.mjs [batchSize] [delayMs]
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVENTS_PATH = resolve(__dirname, "../src/data/events.json");
const COORD_RE = /var\s+lat\s*=\s*([0-9.-]+)\s*;\s*var\s+lng\s*=\s*([0-9.-]+)\s*;/;

const batchSize = parseInt(process.argv[2] || "0", 10) || Infinity; // 0 = all
const delayMs = parseInt(process.argv[3] || "300", 10);

const events = JSON.parse(readFileSync(EVENTS_PATH, "utf-8"));
console.log(`Total events: ${events.length}`);

const needFetch = events.filter((e) => e.lat === undefined);
console.log(`Need coordinates: ${needFetch.length}`);

const batch = needFetch.slice(0, batchSize);
console.log(`Processing batch: ${batch.length} (delay: ${delayMs}ms)\n`);

let enriched = 0;
let noCoords = 0;
let failed = 0;

for (let i = 0; i < batch.length; i++) {
  const event = batch[i];
  try {
    const res = await fetch(event.joe_url, {
      headers: { "User-Agent": "trails.jp/1.0 (coordinate enrichment)" },
    });
    if (!res.ok) {
      console.log(`  [${i + 1}/${batch.length}] FAIL ${res.status} - ${event.name}`);
      failed++;
      continue;
    }
    const html = await res.text();
    const match = html.match(COORD_RE);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lng) && lat >= 20 && lat <= 50 && lng >= 120 && lng <= 155) {
        event.lat = lat;
        event.lng = lng;
        enriched++;
        console.log(`  [${i + 1}/${batch.length}] OK  ${lat.toFixed(4)}, ${lng.toFixed(4)} - ${event.name}`);
      } else {
        event.lat = null;
        event.lng = null;
        noCoords++;
        console.log(`  [${i + 1}/${batch.length}] BAD coords - ${event.name}`);
      }
    } else {
      event.lat = null;
      event.lng = null;
      noCoords++;
      console.log(`  [${i + 1}/${batch.length}] NO  coords - ${event.name}`);
    }
  } catch (err) {
    failed++;
    console.log(`  [${i + 1}/${batch.length}] ERR ${err.message} - ${event.name}`);
  }

  if (delayMs > 0 && i < batch.length - 1) {
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

console.log(`\nResults: enriched=${enriched}, noCoords=${noCoords}, failed=${failed}`);

// Save
writeFileSync(EVENTS_PATH, JSON.stringify(events, null, 2) + "\n");
console.log(`Saved to ${EVENTS_PATH}`);
