import aliasData from "@/data/athlete-aliases.json";
import { normalizeClubName, splitAffiliations } from "@/lib/club-normalize";

/** 改名解決の結果 */
export type AliasResult =
  | { kind: "unchanged"; name: string }
  | { kind: "renamed"; name: string }
  | { kind: "unresolved" };

interface AliasIdentity {
  displayName: string;
  clubs: string[];
}

interface LcOverride {
  lcEventId: number;
  lcClassId: number;
  runnerIndex?: number;
  displayName: string;
}

interface AthleteAlias {
  sourceName: string;
  identities: AliasIdentity[];
  lcOverrides: LcOverride[];
}

const aliases = aliasData.aliases as AthleteAlias[];

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "");
}

function normalizeClubs(clubs: string[]): string[] {
  return clubs
    .flatMap((club) => splitAffiliations(club))
    .map((club) => normalizeClubName(club))
    .filter(Boolean);
}

function findAlias(sourceName: string): AthleteAlias | undefined {
  const normalized = normalizeName(sourceName);
  return aliases.find((alias) => normalizeName(alias.sourceName) === normalized);
}

/** 旧名または改名後の表示名が alias 表に載っているか */
export function isAliasedName(sourceName: string): boolean {
  const normalized = normalizeName(sourceName);
  return aliases.some(
    (alias) =>
      normalizeName(alias.sourceName) === normalized ||
      alias.identities.some((identity) => normalizeName(identity.displayName) === normalized),
  );
}

function resolveByClubs(clubs: string[], alias: AthleteAlias): AliasResult {
  const normalizedClubs = normalizeClubs(clubs);
  if (normalizedClubs.length === 0) return { kind: "unresolved" };

  const matches = alias.identities.filter((identity) => {
    const identityClubs = normalizeClubs(identity.clubs);
    return normalizedClubs.some((club) =>
      identityClubs.some(
        (identityClub) =>
          club === identityClub || club.includes(identityClub) || identityClub.includes(club),
      ),
    );
  });

  if (matches.length !== 1) return { kind: "unresolved" };
  return { kind: "renamed", name: matches[0].displayName };
}

export function resolveAliasName(sourceName: string, clubs: string[]): AliasResult {
  const alias = findAlias(sourceName);
  if (!alias) return { kind: "unchanged", name: sourceName };
  return resolveByClubs(clubs, alias);
}

export function resolveAliasNameForLc(
  sourceName: string,
  clubs: string[],
  lcEventId: number,
  lcClassId: number,
  runnerIndex?: number,
): AliasResult {
  const alias = findAlias(sourceName);
  if (!alias) return { kind: "unchanged", name: sourceName };

  const override = alias.lcOverrides.find(
    (candidate) =>
      candidate.lcEventId === lcEventId &&
      candidate.lcClassId === lcClassId &&
      (candidate.runnerIndex == null || candidate.runnerIndex === runnerIndex),
  );
  if (override) return { kind: "renamed", name: override.displayName };

  return resolveByClubs(clubs, alias);
}
