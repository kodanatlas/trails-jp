/**
 * ミスの傾向ドリルダウンの選手別ファイルを public/data/leg-fp/<gen>/<選手キー>.json に書き出す。
 * docs/plans/2026-09-30_miss-trend-drilldown.md
 *
 * leg-fp/ はビルド生成物（.gitignore 済み）。書き出し前に leg-fp/ ごと消して、常に1世代だけ置く。
 * 明細と集計の一致検証（verifyFingerprintDetails）は呼び出し側で書き出しより前に済ませること。
 */
import * as fs from "fs";
import * as path from "path";
import {
  FingerprintInvariantError,
  LEG_FP_DIR,
  isSafeShardKey,
  type AthleteDetailShard,
  type FingerprintDetails,
} from "../src/lib/analysis/leg-fingerprint-details";

/**
 * DB 取得後の集計・検証・書き出しの失敗（実装バグやディスク障害）。ビルドを落とす。
 * DB 取得の一時失敗はこれに包まない（従来どおりビルド継続）。
 */
export class LegFpPublishError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(`leg-fingerprint の生成・公開に失敗: ${message}`, options);
    this.name = "LegFpPublishError";
  }
}

/** 一時ファイルに書いてから rename（書き込み途中で止まっても壊れたファイルを残さない） */
export function writeFileAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

export interface LegFpShardStats {
  files: number;
  totalBytes: number;
  maxBytes: number;
  maxKey: string | null;
}

/**
 * 全選手分を書き出す。ファイル名にできない選手キーが1つでもあれば、何も書かずに
 * FingerprintInvariantError（明細が欠けた選手を黙って出さない＝ビルドを落とす）。
 */
export function writeLegFpShards(outputDir: string, gen: string, details: FingerprintDetails): LegFpShardStats {
  const unsafe = Object.keys(details).filter((key) => !isSafeShardKey(key));
  if (unsafe.length > 0) {
    throw new FingerprintInvariantError(`ファイル名にできない選手キー: ${unsafe.join(", ")}`);
  }
  const root = path.join(outputDir, LEG_FP_DIR);
  fs.rmSync(root, { recursive: true, force: true });
  const genDir = path.join(root, gen);
  fs.mkdirSync(genDir, { recursive: true });

  const stats: LegFpShardStats = { files: 0, totalBytes: 0, maxBytes: 0, maxKey: null };
  for (const [key, detail] of Object.entries(details)) {
    const shard: AthleteDetailShard = { gen, ...detail };
    const json = JSON.stringify(shard);
    fs.writeFileSync(path.join(genDir, `${key}.json`), json);
    const bytes = Buffer.byteLength(json);
    stats.files++;
    stats.totalBytes += bytes;
    if (bytes > stats.maxBytes) {
      stats.maxBytes = bytes;
      stats.maxKey = key;
    }
  }
  return stats;
}
