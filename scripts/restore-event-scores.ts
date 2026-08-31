/**
 * git に残るランキング3世代から、現行ファイルで失われた大会得点を追加専用で復元する。
 *
 * 限界: 2026-02-25 より前の記録は git にも残っていないため復元できない。
 * JOY の上位N大会集計の性質上、当時から既に落ちていた大会も取り戻せない。
 * このスクリプトができるのは「失われた分の一部を回収する」ことまでである。
 *
 * Usage:
 *   npx tsx scripts/restore-event-scores.ts          # dry-run（既定）
 *   npx tsx scripts/restore-event-scores.ts --apply  # 実際に書き戻す
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { resolveAliasName } from "../src/lib/identity/athlete-alias";

interface EventScore {
  event_name: string;
  points: number;
}

interface RankingEntry {
  athlete_name: string;
  club: string;
  event_scores: EventScore[];
  [key: string]: unknown;
}

interface RestorePlan {
  filePath: string;
  entries: RankingEntry[];
}

const HISTORY_COMMITS = ["7627819", "00de0db", "dd702b4"] as const;
const PROJECT_ROOT = path.resolve(__dirname, "..");
const RANKINGS_DIR = path.join(PROJECT_ROOT, "public/data/rankings");
const RANKINGS_GIT_DIR = "public/data/rankings";

const normalizeKey = (name: string): string => name.replace(/\s+/g, "");

function resolveEntryName(entry: Pick<RankingEntry, "athlete_name" | "club">): string {
  const result = resolveAliasName(entry.athlete_name, [entry.club]);
  return normalizeKey(result.kind === "unresolved" ? entry.athlete_name : result.name);
}

function readRankingFromGit(commit: string, fileName: string): RankingEntry[] {
  const objectName = `${commit}:${RANKINGS_GIT_DIR}/${fileName}`;
  const json = execFileSync("git", ["show", objectName], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(json) as RankingEntry[];
}

function writeRankingFileAtomic(filePath: string, entries: RankingEntry[]): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2));
    fs.renameSync(tmpPath, filePath);
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

function parseMode(args: string[]): "dry-run" | "apply" {
  const knownArgs = new Set(["--dry-run", "--apply"]);
  const unknown = args.filter((arg) => !knownArgs.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown option: ${unknown.join(", ")}`);
  }
  if (args.includes("--dry-run") && args.includes("--apply")) {
    throw new Error("--dry-run and --apply cannot be used together");
  }
  return args.includes("--apply") ? "apply" : "dry-run";
}

function main(): void {
  const mode = parseMode(process.argv.slice(2));
  const fileNames = fs.readdirSync(RANKINGS_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();

  // fileName → 解決後氏名 → event_name → score。
  // コミットは古い順に読み、履歴内で同じ大会名の値が変わった場合は新しい世代を採用する。
  const historicalScores = new Map<string, Map<string, Map<string, EventScore>>>();
  for (const commit of HISTORY_COMMITS) {
    for (const fileName of fileNames) {
      const entries = readRankingFromGit(commit, fileName);
      let scoresByName = historicalScores.get(fileName);
      if (!scoresByName) {
        scoresByName = new Map();
        historicalScores.set(fileName, scoresByName);
      }

      for (const entry of entries) {
        const resolvedName = resolveEntryName(entry);
        let scoresByEvent = scoresByName.get(resolvedName);
        if (!scoresByEvent) {
          scoresByEvent = new Map();
          scoresByName.set(resolvedName, scoresByEvent);
        }
        for (const score of entry.event_scores ?? []) {
          scoresByEvent.set(score.event_name, score);
        }
      }
    }
  }

  const restorePlans: RestorePlan[] = [];
  // 年齢別・無差別など複数ファイルに重複する同一選手・大会は、論理上の1件として数える。
  const restoredAthletes = new Set<string>();
  const restoredScores = new Set<string>();

  for (const fileName of fileNames) {
    const filePath = path.join(RANKINGS_DIR, fileName);
    const currentEntries = JSON.parse(fs.readFileSync(filePath, "utf-8")) as RankingEntry[];
    const scoresByName = historicalScores.get(fileName);

    const restoredEntries = currentEntries.map((entry) => {
      const historical = scoresByName?.get(resolveEntryName(entry));
      if (!historical || historical.size === 0) return entry;

      const currentScores = entry.event_scores ?? [];
      const currentEventNames = new Set(currentScores.map((score) => score.event_name));
      const missingScores = [...historical.values()].filter(
        (score) => !currentEventNames.has(score.event_name),
      );
      if (missingScores.length === 0) return entry;

      const entryKey = resolveEntryName(entry);
      restoredAthletes.add(entryKey);
      for (const score of missingScores) {
        restoredScores.add(`${entryKey}\0${score.event_name}`);
      }
      return {
        ...entry,
        event_scores: [...currentScores, ...missingScores],
      };
    });

    // 書き込みを始める前に、全ファイルについて追加専用の不変条件を検証する。
    for (let index = 0; index < currentEntries.length; index++) {
      const beforeCount = currentEntries[index].event_scores?.length ?? 0;
      const afterCount = restoredEntries[index].event_scores?.length ?? 0;
      if (afterCount < beforeCount) {
        throw new Error(
          `${fileName}: event_scores decreased for ${currentEntries[index].athlete_name} (${beforeCount} -> ${afterCount})`,
        );
      }
    }

    if (restoredEntries.some((entry, index) => entry !== currentEntries[index])) {
      restorePlans.push({ filePath, entries: restoredEntries });
    }
  }

  if (mode === "apply") {
    for (const plan of restorePlans) {
      writeRankingFileAtomic(plan.filePath, plan.entries);
    }
  }

  const modeLabel = mode === "apply" ? "apply" : "dry-run";
  console.log(
    `Event score restore (${modeLabel}): ${restoredAthletes.size} athletes, +${restoredScores.size} scores, ${restorePlans.length} files.`,
  );
  if (mode === "dry-run") {
    console.log("No files were written. Use --apply to write the restored scores.");
  }
}

main();
