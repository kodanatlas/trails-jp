/**
 * スタートリスト解析（配車割 Phase 4・純粋ロジック）。
 *
 * JOY のスタートリスト PDF を unpdf の `extractText(pdf, { mergePages: false })` で
 * ページ別 plain text（`string[]`）に線形化したものを受け、データ行を抽出する。
 * 貼り付けテキスト（ページ概念なし）にも対応するため、`parseStartlistText(["<全文>"])`
 * のような 1 要素配列でも動く。
 *
 * 主催者ごとにスタートリストの列構成が異なるため、2 系統のフォーマットを統一的に扱う:
 *
 *   【A: サンプル系（startlist_sample_olk2264.pdf, 42p）】
 *     - ヘッダ `スタート時間 ゼッケン 氏名 所属 Eカード番号`
 *     - データ行 `HH:MM <ゼッケン3〜5桁> <氏名> <所属> <Eカード番号>`
 *     - セクション見出し `ME（レーン１） 10:45~11:14` で className が切り替わる。
 *
 *   【B: 東大OLK前日大会系（getfile/10708）】
 *     - ヘッダ `出走時刻 名前 所属 SIカード番号 Extra`
 *     - データ行 `HH:MM:SS <氏名> <所属> <SIカード番号> <○/×>`（ゼッケン列なし・時刻に秒・行末フラグ）
 *     - 見出しは `レーン1（…）`（日本語始まり）で className を含まない
 *       → className は "" のまま（呼び出し側はエントリー由来のクラスを保持する）。
 *
 * 両系統を 1 つの行パーサで吸収するため、位置固定の単一正規表現はやめ、
 * 「先頭=時刻 → 末尾から フラグ / カード番号 を剥がす → 残りの先頭が数字なら ゼッケン →
 * 残り = 氏名+所属」と段階的に削る方式にする。
 *
 * I/O（PDF 読込）は index.ts に分離し、本ファイルは純粋関数のみ。
 */

/** スタートリストの 1 データ行。 */
export interface StartlistRow {
  /** スタート時刻（`HH:MM`。秒つき入力は分まで丸める）。 */
  startTime: string;
  /** ゼッケン番号（3〜5桁の数字文字列。ゼッケン列が無いフォーマットでは ""）。 */
  bib: string;
  /** 氏名（姓名連結ケースは 1 トークン、通常は「姓 名」を半角空白で連結した 2 トークン）。 */
  name: string;
  /** 所属（生文字列。複数所属・`-` もそのまま保持。突合側で splitAffiliations 正規化）。 */
  affiliation: string;
  /** クラス名（直前のセクション見出し行から導出。見出しが無ければ ""）。 */
  className: string;
}

/**
 * データページ判定に使うヘッダ行（className 文脈の補助）。
 * このヘッダの有無は採用条件ではなく、貼り付けテキスト対応のため
 * 「データ行が 1 つでもあるページ/ブロックは採用」する方針を採る。
 * A 系（スタート時間…）/ B 系（出走時刻…）の双方を許容する。
 */
const HEADER_RE =
  /(?:スタート時間\s+ゼッケン\s+氏名\s+所属\s+Eカード番号|出走時刻\s+名前\s+所属)/;

/**
 * セクション見出し行 → className（A 系）。
 * 行頭の `[A-Za-z0-9]+`（全角丸括弧 `（` の直前まで）を className とする。
 * 例: `ME（レーン１） 10:45~11:14` → "ME" / `M21A1（レーン2） 11:45~12:06` → "M21A1"。
 * B 系の `レーン1（…）`（日本語始まり）は意図的に一致させない（競技クラスではないため）。
 */
const HEADING_RE = /^([A-Za-z0-9]+)（/;

/** 先頭の時刻（`HH:MM` または `HH:MM:SS`）+ 残り。 */
const LEADING_TIME_RE = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?[\s　]+(.+)$/;

/** 行末の Extra フラグ（出走可否・レンタル等のマーク。B 系の末尾列）。 */
const TRAILING_FLAG_RE = /[\s　]+[○◯〇●×✕✗✓✔]+$/u;

/** 行末の SI/E カード番号（4 桁以上。A 系=Eカード, B 系=SIカード。所属末尾の少数桁は剥がさない）。 */
const TRAILING_CARD_RE = /[\s　]+\d{4,}$/;

/** 先頭のゼッケン（3〜5 桁）+ 残り（次トークンは非数字＝氏名）。A 系のみ該当。 */
const LEADING_BIB_RE = /^(\d{3,5})[\s　]+(\D.*)$/;

/**
 * `mid`（氏名 + 所属）を氏名と所属に分割する。
 *   - トークン数 >= 3 → name = 先頭 2 トークン（姓 名）、affiliation = 残り全部を空白で join。
 *   - トークン数 == 2 → name = 先頭 1 トークン（姓名連結ケース）、affiliation = 2 番目。
 *   - トークン数 == 1 → name = そのトークン、affiliation = ""（防御的）。
 */
function splitNameAndAffiliation(mid: string): { name: string; affiliation: string } {
  const tokens = mid.trim().split(/\s+/).filter(Boolean);
  if (tokens.length >= 3) {
    return { name: `${tokens[0]} ${tokens[1]}`, affiliation: tokens.slice(2).join(" ") };
  }
  if (tokens.length === 2) {
    return { name: tokens[0], affiliation: tokens[1] };
  }
  return { name: tokens[0] ?? "", affiliation: "" };
}

/**
 * 1 行を段階的に削ってデータ行として解釈する。データ行でなければ null。
 *
 * @param line      trim 済みの 1 行。
 * @param className 現在のセクション className（A 系見出し由来。無ければ ""）。
 */
function parseDataLine(line: string, className: string): StartlistRow | null {
  const tm = line.match(LEADING_TIME_RE);
  if (!tm) return null;

  const hour = Number(tm[1]);
  if (hour > 23) return null;
  const startTime = `${String(hour).padStart(2, "0")}:${tm[2]}`;

  // 末尾から「Extra フラグ → カード番号」を剥がす（順序固定: フラグが最後尾）。
  let rest = tm[3].trim();
  rest = rest.replace(TRAILING_FLAG_RE, "").trim();
  rest = rest.replace(TRAILING_CARD_RE, "").trim();

  // 先頭がゼッケン（3〜5 桁・直後が非数字）なら剥がして記録（A 系）。B 系は氏名始まりで非該当。
  let bib = "";
  const bibMatch = rest.match(LEADING_BIB_RE);
  if (bibMatch) {
    bib = bibMatch[1];
    rest = bibMatch[2].trim();
  }

  if (!rest) return null;

  const { name, affiliation } = splitNameAndAffiliation(rest);
  if (!name) return null;

  return { startTime, bib, name, affiliation, className };
}

/**
 * unpdf のページ別 plain text（または貼り付け全文の 1 要素配列）から
 * スタートリストのデータ行を抽出する純粋関数。
 *
 * className はページをまたいでも継続せず、各要素内で見出しを見つけ次第更新する
 * （要素境界では "" にリセット）。実 PDF ではデータページ間で見出しが再掲されるため十分。
 *
 * @param pages ページ別 plain text。貼り付けテキストは `[全文]` の 1 要素でも可。
 * @returns 抽出した StartlistRow の配列（出現順）。
 */
export function parseStartlistText(pages: string[]): StartlistRow[] {
  const rows: StartlistRow[] = [];

  // ヘッダ行の有無は採用条件にしない（貼り付け対応）。className 文脈の補助としてのみ存在を見る。
  void HEADER_RE;

  for (const page of pages) {
    if (!page) continue;
    const lines = page.split(/\r?\n/);

    let className = "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const heading = line.match(HEADING_RE);
      if (heading) {
        className = heading[1];
        // 見出し行はデータ行ではないので次へ。
        continue;
      }

      const row = parseDataLine(line, className);
      if (row) rows.push(row);
    }
  }

  return rows;
}
