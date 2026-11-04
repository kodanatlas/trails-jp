/**
 * 同姓同名（別人が同じ氏名で1人に合算されている）の候補をランキング JSON から検出する。
 * 自動で分離はしない。候補は /admin/cron-status に表示し、人が確認して athlete-aliases.json に登録する。
 *
 * 判定（どちらも「別人」の強い証拠）:
 * 1. 同じランキングファイルに同じ氏名が2行ある（JOY が別人として扱っている）
 * 2. 同じ氏名・別の所属で、同じ大会に違う得点が付いている（同じ人なら同じ大会の得点は同じ）
 *    エリート（elite_*）と年齢別（age_*）は得点の尺度が違うため、それぞれの中だけで比べる。
 *
 * 入力は改名シム適用後の行。対応表で解決済みの人は別名になっているため候補に出ない。
 * 解決できなかった行（未登録の所属）は旧名のまま残るので、食い違いがあれば候補に出る。
 */

export interface RankingFileForDetect {
  file: string; // 例: "age_forest_無差別"
  entries: readonly {
    athlete_name: string;
    club: string;
    event_scores: readonly { event_name: string; points: number }[];
  }[];
}

export interface HomonymCandidate {
  name: string; // 空白除去後の氏名
  clubs: string[];
  reasons: string[];
}

const DATED_EVENT_RE = /^(\d{4}-\d{2}-\d{2})\s+([\s\S]+)$/;
const MAX_REASONS = 3;

function normalizeName(name: string): string {
  return name.replace(/\s+/g, "");
}

function eventKey(raw: string): string | null {
  const m = raw.trim().match(DATED_EVENT_RE);
  return m ? `${m[1]} ${m[2].replace(/\s+/g, " ").trim()}` : null;
}

function scaleOf(file: string): "elite" | "age" {
  return file.startsWith("elite_") ? "elite" : "age";
}

export function detectHomonymCandidates(files: readonly RankingFileForDetect[]): HomonymCandidate[] {
  const byName = new Map<string, { clubs: Set<string>; reasons: string[] }>();
  const bucket = (name: string) => {
    let b = byName.get(name);
    if (!b) {
      b = { clubs: new Set(), reasons: [] };
      byName.set(name, b);
    }
    return b;
  };

  // 1. 同一ファイル内の重複
  for (const f of files) {
    const clubsByName = new Map<string, string[]>();
    for (const e of f.entries) {
      const n = normalizeName(e.athlete_name);
      clubsByName.set(n, [...(clubsByName.get(n) ?? []), e.club]);
    }
    for (const [n, clubs] of clubsByName) {
      if (clubs.length < 2) continue;
      const b = bucket(n);
      clubs.forEach((c) => b.clubs.add(c));
      b.reasons.push(`${f.file} に${clubs.length}行（${clubs.join(" / ")}）`);
    }
  }

  // 2. 同じ大会で、所属の違う同名に違う得点
  // name -> scale -> event -> club -> points
  const points = new Map<string, Map<string, Map<string, Map<string, Set<number>>>>>();
  for (const f of files) {
    const scale = scaleOf(f.file);
    for (const e of f.entries) {
      const n = normalizeName(e.athlete_name);
      for (const s of e.event_scores) {
        const key = eventKey(s.event_name);
        if (!key || !(s.points > 0)) continue;
        const byScale = points.get(n) ?? new Map();
        points.set(n, byScale);
        const byEvent = byScale.get(scale) ?? new Map();
        byScale.set(scale, byEvent);
        const byClub = byEvent.get(key) ?? new Map();
        byEvent.set(key, byClub);
        const set = byClub.get(e.club) ?? new Set<number>();
        byClub.set(e.club, set);
        set.add(s.points);
      }
    }
  }
  for (const [n, byScale] of points) {
    for (const byEvent of byScale.values()) {
      for (const [ev, byClub] of byEvent) {
        if (byClub.size < 2) continue;
        const entries = [...byClub.entries()];
        const distinct = new Set(entries.map(([, pts]) => [...pts].sort().join(",")));
        if (distinct.size < 2) continue;
        const b = bucket(n);
        entries.forEach(([c]) => b.clubs.add(c));
        b.reasons.push(`${ev}: ${entries.map(([c, pts]) => `${c} ${[...pts].join("/")}点`).join("、")}`);
      }
    }
  }

  return [...byName.entries()]
    .map(([name, b]) => ({ name, clubs: [...b.clubs].sort(), reasons: b.reasons.slice(0, MAX_REASONS) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}
