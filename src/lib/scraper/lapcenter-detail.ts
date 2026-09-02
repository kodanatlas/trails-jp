// LapCenter split-list.jsp に埋め込まれた runnerData（JS）から、全ランナーの
// per-leg 全配列をパースする純関数群。IO・外部依存なし（どの環境でも動く・テスト容易）。
// fetch は lapcenter.ts の fetchSplitListDetailed が担い、本ファイルは文字列処理のみ。
//
// 方針（docs/plans/2026-06-29_results-analysis-methodology.md §8.1 relay-first）:
// LapCenter が既に算出している値（legLossTime=ミス, idealTime, legSpeed, Ave3 等）を
// そのまま relay する。本パーサはその relay の入口。再計算はしない。
//
// メトリクス方向の罠（reference: LapCenter指標の向き）:
//   speed / legSpeed は小さいほど速い＝良い（優勝者≈最小）。lapRank/elapsedRank は小さいほど良い。
//   legLossTime は小さい・負ほど良い（負=その人の巡航ペースに対しミスなし）。

export interface LapCenterRunnerDetail {
  index: number;             // フィールド内の登場順（0始まり）
  name: string;
  club: string;
  runnerId: string;
  rank: number | null;       // MP/DISQ/DNS は null（数値順位なし）
  result: string;            // 完走タイム 例 "0:11:13"
  start: string;             // スタート時刻 例 "10:35:00"
  speed: number | null;      // 巡航速度（小さいほど速い）
  lossRate: number | null;   // ミス率 %（= totalLossTime / result）
  totalRelative: number | null;
  totalLossTime: string;     // ミス時間合計 例 "1:03"
  idealTime: string;         // = result − totalLossTime 例 "10:10"
  lapTime: string[];         // レッグ別スプリット（S→1, 1→2, …, →Goal）
  lapRank: (number | null)[];// そのレッグ単独の順位
  elapsedTime: string[];     // 各コントロール通過時の累積タイム
  elapsedRank: (number | null)[]; // 各コントロール時点の順位（レース展開）
  legLossTime: string[];     // レッグ別ミス時間（符号付き・負=ミスなし）
  legSpeed: (number | null)[]; // レッグ別相対ペース（100=Ave3, 小さいほど速い）
}

/** HTML セルをプレーンテキスト化し、連続する空白を1文字に畳む。 */
function htmlCellText(cell: string): string {
  return cell
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower === "nbsp") return " ";
      if (lower === "amp") return "&";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "quot") return '"';
      if (lower === "apos") return "'";
      const codePoint = lower.startsWith("#x")
        ? parseInt(lower.slice(2), 16)
        : parseInt(lower.slice(1), 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** relay-result-list.jsp の HTML から (走者名, クラス名) → チーム名 を抽出する。 */
export function parseRelayTeams(html: string): Map<string, string> {
  const teams = new Map<string, string>();
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1]);
    }
    const teamCellIndex = cells.findIndex((cell) => /<br\s*\/?\s*>/i.test(cell));
    if (teamCellIndex < 0) continue;

    // 最初に改行を含むセルの先頭行だけがチーム名。以降の総合タイム・順位・DISQ は含めない。
    const teamName = htmlCellText(cells[teamCellIndex].split(/<br\s*\/?\s*>/i, 1)[0]);
    if (!teamName) continue;

    const runners: Array<{ name: string; className: string }> = [];
    for (const cell of cells.slice(teamCellIndex + 1)) {
      const runner = htmlCellText(cell).match(/^(.+?)\s*\/\s*(\S+)/);
      if (!runner) continue;
      const name = runner[1].replace(/\s+/g, "");
      const className = runner[2];
      if (name && className) runners.push({ name, className });
    }
    if (runners.length === 0) continue;

    for (const { name, className } of runners) teams.set(`${name}|${className}`, teamName);
  }

  return teams;
}

/** "h:mm:ss" / "m:ss" / "s"、先頭 "-" 付きを秒へ。空文字・不正は null。 */
export function lapStrToSeconds(s: string | null | undefined): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (t === "") return null;
  const neg = t.startsWith("-");
  const body = neg ? t.slice(1) : t;
  let sec = 0;
  for (const part of body.split(":")) {
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    sec = sec * 60 + n;
  }
  return neg ? -sec : sec;
}

/** 各レッグの基準時間 Ave3（上位3スプリット平均）を、ある走者のレッグから逆算で復元。
 *  legSpeed = round(100·lap/Ave3) より Ave3 = 100·lap/legSpeed。レッグ共通定数なので
 *  どの走者からでも（rounding 差を除き）同じ値が出る。null は復元不能。 */
export function deriveAve3Seconds(lapTime: string, legSpeed: number | null): number | null {
  if (legSpeed == null || legSpeed <= 0) return null;
  const lap = lapStrToSeconds(lapTime);
  if (lap == null) return null;
  return (100 * lap) / legSpeed;
}

function scalar(block: string, key: string): string {
  // runnerData['key'] = 'value';  （単一クォート文字列のスカラーのみ。index 等の数値リテラルは対象外）
  const m = block.match(new RegExp(`runnerData\\['${key}'\\]\\s*=\\s*'([^']*)';`));
  return m ? m[1] : "";
}

function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

/** runnerData['key'] = ['a','b',...]; の配列を文字列配列で取り出す。欠損 '' は "" のまま保持。 */
function strArray(block: string, key: string): string[] {
  const m = block.match(new RegExp(`runnerData\\['${key}'\\]\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!m) return [];
  const out: string[] = [];
  const re = /'([^']*)'/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(m[1])) !== null) out.push(mm[1]);
  return out;
}

/** split-list.jsp の HTML から全ランナーの per-leg 詳細をパースする。 */
export function parseSplitListDetailed(html: string): LapCenterRunnerDetail[] {
  const runners: LapCenterRunnerDetail[] = [];
  // runnerData の各代入は対応する runnerList.push(runnerData) の直前に並ぶ。
  // push で分割すると block[i] に runner i の代入が入る（末尾 block は runnerName なし→skip）。
  const blocks = html.split("runnerList.push(runnerData);");
  for (const block of blocks) {
    const name = scalar(block, "runnerName");
    if (!name) continue;
    const r: LapCenterRunnerDetail = {
      index: runners.length,
      name,
      club: scalar(block, "clubName"),
      runnerId: scalar(block, "runnerId"),
      rank: intOrNull(scalar(block, "rank")),
      result: scalar(block, "result"),
      start: scalar(block, "start"),
      speed: numOrNull(scalar(block, "speed")),
      lossRate: numOrNull(scalar(block, "lossRate")),
      totalRelative: numOrNull(scalar(block, "totalRelative")),
      totalLossTime: scalar(block, "totalLossTime"),
      idealTime: scalar(block, "idealTime"),
      lapTime: strArray(block, "lapTime"),
      lapRank: strArray(block, "lapRank").map(intOrNull),
      elapsedTime: strArray(block, "elapsedTime"),
      elapsedRank: strArray(block, "elapsedRank").map(intOrNull),
      legLossTime: strArray(block, "legLossTime"),
      legSpeed: strArray(block, "legSpeed").map(numOrNull),
    };

    // relay-first 健全性: 6本の per-leg 配列の長さが揃わない（HTML形式変更/破損）なら
    // 黙って穴埋めせず、その runner をスキップする（誤った中継値を出さない・レビュー C）。
    const lens = new Set([
      r.lapTime.length,
      r.lapRank.length,
      r.elapsedTime.length,
      r.elapsedRank.length,
      r.legLossTime.length,
      r.legSpeed.length,
    ]);
    if (lens.size > 1) {
      console.warn(`[lapcenter-detail] inconsistent per-leg array lengths for "${name}" — skipping runner`);
      continue;
    }
    runners.push(r);
  }
  return runners;
}
