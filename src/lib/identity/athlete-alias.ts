import aliasData from "@/data/athlete-aliases.json";
import { normalizeClubName, splitAffiliations } from "@/lib/club-normalize";

/** 改名解決の結果 */
export type AliasResult =
  | { kind: "unchanged"; name: string }
  | { kind: "renamed"; name: string }
  | { kind: "unresolved" };

export interface AliasIdentity {
  displayName: string;
  clubs: string[];
}

export interface LcOverride {
  lcEventId: number;
  lcClassId: number;
  runnerIndex: number;
  displayName: string;
}

export interface AthleteAlias {
  sourceName: string;
  identities: AliasIdentity[];
  lcOverrides: LcOverride[];
}

export interface AliasEntry {
  athlete_name: string;
  club: string;
}

export interface AliasEntryResolution<T extends AliasEntry> {
  entries: T[];
  renamed: number;
  passthrough: number;
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "");
}

function normalizeClubs(clubs: string[]): string[] {
  return clubs
    .flatMap((club) => splitAffiliations(club))
    .map((club) => normalizeClubName(club))
    .filter(Boolean);
}

/**
 * 対応表の不変条件を検証する。テスト用の固定表にも使える純関数。
 * lookup が空白を無視するため、氏名の一意性も同じ正規化後で判定する。
 */
export function validateAliases(aliases: readonly AthleteAlias[]): void {
  const sourceNames = new Set<string>();
  const displayNames = new Set<string>();
  const overrideKeys = new Set<string>();

  for (const alias of aliases) {
    const sourceName = normalizeName(alias.sourceName);
    if (sourceNames.has(sourceName)) {
      throw new Error(`Duplicate athlete alias sourceName: ${alias.sourceName}`);
    }
    sourceNames.add(sourceName);

    if (alias.identities.length < 2) {
      throw new Error(`Athlete alias must have at least two identities: ${alias.sourceName}`);
    }

    const identityClubSets = alias.identities.map((identity) => {
      const displayName = normalizeName(identity.displayName);
      if (displayNames.has(displayName)) {
        throw new Error(`Duplicate athlete alias displayName: ${identity.displayName}`);
      }
      displayNames.add(displayName);
      return new Set(normalizeClubs(identity.clubs));
    });

    for (let i = 0; i < identityClubSets.length; i++) {
      for (let j = i + 1; j < identityClubSets.length; j++) {
        const overlap = [...identityClubSets[i]].find((club) => identityClubSets[j].has(club));
        if (overlap) {
          throw new Error(`Overlapping athlete alias club: ${alias.sourceName} (${overlap})`);
        }
      }
    }

    const aliasDisplayNames = new Set(alias.identities.map((identity) => identity.displayName));
    for (const override of alias.lcOverrides) {
      if (!Number.isInteger(override.runnerIndex)) {
        throw new Error(
          `Athlete alias LC override requires runnerIndex: ${alias.sourceName} event=${override.lcEventId} class=${override.lcClassId}`,
        );
      }
      const key = `${override.lcEventId}:${override.lcClassId}:${override.runnerIndex}`;
      if (overrideKeys.has(key)) {
        throw new Error(`Duplicate athlete alias LC override: ${key}`);
      }
      overrideKeys.add(key);
      if (!aliasDisplayNames.has(override.displayName)) {
        throw new Error(
          `Unknown athlete alias LC override displayName: ${alias.sourceName} (${override.displayName})`,
        );
      }
    }
  }
}

const aliases = aliasData.aliases as unknown as AthleteAlias[];
validateAliases(aliases);

function findAlias(
  aliasTable: readonly AthleteAlias[],
  sourceName: string,
): AthleteAlias | undefined {
  const normalized = normalizeName(sourceName);
  return aliasTable.find((alias) => normalizeName(alias.sourceName) === normalized);
}

/** 旧名または改名後の表示名が指定の alias 表に載っているか */
export function isAliasedNameWith(
  aliasTable: readonly AthleteAlias[],
  sourceName: string,
): boolean {
  const normalized = normalizeName(sourceName);
  return aliasTable.some(
    (alias) =>
      normalizeName(alias.sourceName) === normalized ||
      alias.identities.some((identity) => normalizeName(identity.displayName) === normalized),
  );
}

/** 旧名または改名後の表示名が alias 表に載っているか */
export function isAliasedName(sourceName: string): boolean {
  return isAliasedNameWith(aliases, sourceName);
}

function resolveByClubs(clubs: string[], alias: AthleteAlias): AliasResult {
  // normalizeClubName("金沢") は市・県協会の意味まで大学へ広げるため、明示列挙の無い
  // この短縮形だけは大学所属の根拠にしない。大学+末尾数字等の正規化は従来どおり使う。
  const eligibleClubs = clubs.filter((club) => club.trim() !== "金沢");
  const normalizedClubs = normalizeClubs(eligibleClubs);
  if (normalizedClubs.length === 0) return { kind: "unresolved" };

  const matches = alias.identities.filter((identity) => {
    const identityClubs = new Set(normalizeClubs(identity.clubs));
    return normalizedClubs.some((club) => identityClubs.has(club));
  });

  if (matches.length !== 1) return { kind: "unresolved" };
  return { kind: "renamed", name: matches[0].displayName };
}

/** 指定の対応表だけを使って氏名を解決する純関数 */
export function resolveAliasNameWith(
  aliasTable: readonly AthleteAlias[],
  sourceName: string,
  clubs: string[],
): AliasResult {
  const alias = findAlias(aliasTable, sourceName);
  if (!alias) return { kind: "unchanged", name: sourceName };
  return resolveByClubs(clubs, alias);
}

export function resolveAliasName(sourceName: string, clubs: string[]): AliasResult {
  return resolveAliasNameWith(aliases, sourceName, clubs);
}

/** 指定の対応表だけを使って LapCenter の氏名を解決する純関数 */
export function resolveAliasNameForLcWith(
  aliasTable: readonly AthleteAlias[],
  sourceName: string,
  clubs: string[],
  lcEventId: number,
  lcClassId: number,
  runnerIndex?: number,
): AliasResult {
  const alias = findAlias(aliasTable, sourceName);
  if (!alias) return { kind: "unchanged", name: sourceName };

  const override = alias.lcOverrides.find(
    (candidate) =>
      candidate.lcEventId === lcEventId &&
      candidate.lcClassId === lcClassId &&
      candidate.runnerIndex === runnerIndex,
  );
  if (override) return { kind: "renamed", name: override.displayName };

  return resolveByClubs(clubs, alias);
}

export function resolveAliasNameForLc(
  sourceName: string,
  clubs: string[],
  lcEventId: number,
  lcClassId: number,
  runnerIndex?: number,
): AliasResult {
  return resolveAliasNameForLcWith(
    aliases,
    sourceName,
    clubs,
    lcEventId,
    lcClassId,
    runnerIndex,
  );
}

/** 指定の対応表でランキング行を改名し、未解決行は元の氏名のまま残す純関数 */
export function resolveEntryAliasesWith<T extends AliasEntry>(
  aliasTable: readonly AthleteAlias[],
  entries: readonly T[],
): AliasEntryResolution<T> {
  const resolved: T[] = [];
  let renamed = 0;
  let passthrough = 0;

  for (const entry of entries) {
    const result = resolveAliasNameWith(aliasTable, entry.athlete_name, [entry.club]);
    if (result.kind === "unresolved") {
      passthrough++;
      resolved.push(entry);
      continue;
    }
    if (result.kind === "renamed") {
      renamed++;
      resolved.push({ ...entry, athlete_name: result.name });
      continue;
    }
    resolved.push(entry);
  }

  return { entries: resolved, renamed, passthrough };
}

/** ランキング行を改名し、未解決行は元の氏名のまま残す */
export function resolveEntryAliases<T extends AliasEntry>(
  entries: readonly T[],
): AliasEntryResolution<T> {
  return resolveEntryAliasesWith(aliases, entries);
}
