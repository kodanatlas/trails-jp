/**
 * スタートリスト解析（配車割 Phase 4・純粋ロジック）。
 *
 * JOY のスタートリスト PDF を unpdf の `extractText(pdf, { mergePages: false })` で
 * ページ別 plain text（`string[]`）に線形化したものを受け、データ行を抽出する。
 * 貼り付けテキスト（ページ概念なし）にも対応するため、`parseStartlistText(["<全文>"])`
 * のような 1 要素配列でも動く。
 *
 * 実サンプル（startlist_sample_olk2264.pdf, 42ページ）で実測した構造に基づく:
 *   - ページ1=表紙 / ページ2=もくじ / ページ3=スタートレーン表 はデータ行ヘッダを含まない。
 *   - データページは必ずヘッダ行 `スタート時間 ゼッケン 氏名 所属 Eカード番号` を含む。
 *   - セクション見出し行（例 `ME（レーン１） 10:45~11:14`）で className が切り替わる。
 *     1ページに複数クラスが載るため、className は行を上から走査しながら見出し行で更新し、
 *     以降の行に適用する（ページ単位ではなくセクション単位）。
 *   - データ行: `HH:MM ゼッケン(3〜5桁) <氏名と所属> Eカード番号`。
 *
 * I/O（PDF 読込）は index.ts に分離し、本ファイルは純粋関数のみ。
 */

/** スタートリストの 1 データ行。 */
export interface StartlistRow {
  /** スタート時刻（`HH:MM`）。 */
  startTime: string;
  /** ゼッケン番号（3〜5桁の数字文字列）。 */
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
 */
const HEADER_RE = /スタート時間\s+ゼッケン\s+氏名\s+所属\s+Eカード番号/;

/**
 * セクション見出し行 → className。
 * 行頭の `[A-Za-z0-9]+`（全角丸括弧 `（` の直前まで）を className とする。
 * 例: `ME（レーン１） 10:45~11:14` → "ME" / `M21A1（レーン2） 11:45~12:06` → "M21A1"。
 */
const HEADING_RE = /^([A-Za-z0-9]+)（/;

/**
 * データ行の厳密正規表現（実サンプル 863 行を漏れ 0 で捕捉）。
 * 位置キャプチャ（tsconfig target=ES2017 のため named group は使えない）:
 *   [1] time  = スタート時刻 HH:MM
 *   [2] bib   = ゼッケン 3〜5 桁
 *   [3] mid   = 氏名 + 所属（間は半角空白区切り、非貪欲）
 *   [4] ecard = 末尾の Eカード番号（数字）
 */
const DATA_RE =
  /^((?:[01]\d|2[0-3]):[0-5]\d)\s+(\d{3,5})\s+(.+?)\s+(\d+)\s*$/;

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
 * unpdf のページ別 plain text（または貼り付け全文の 1 要素配列）から
 * スタートリストのデータ行を抽出する純粋関数。
 *
 * className はページをまたいでも継続せず、各ページ（=配列要素）の先頭でリセットする
 * のではなく「直前に出現した見出し行」を引き継ぐ。実 PDF ではデータページ間で
 * 見出しが再掲されるため、各要素内で見出しを見つけ次第更新すれば十分。
 * 安全側として要素境界では className を引き継がず "" に戻す（ページごとに必ず
 * 見出しが先頭付近に出る実構造に合わせる）。
 *
 * @param pages ページ別 plain text。貼り付けテキストは `[全文]` の 1 要素でも可。
 * @returns 抽出した StartlistRow の配列（出現順）。
 */
export function parseStartlistText(pages: string[]): StartlistRow[] {
  const rows: StartlistRow[] = [];

  for (const page of pages) {
    if (!page) continue;
    const lines = page.split(/\r?\n/);

    // ヘッダ行の有無は採用条件にしない（貼り付け対応）。className 文脈の補助としてのみ存在を見る。
    // データ行が 1 つでもあるページ/ブロックは採用する方針なので、ここでは事前スキップしない。
    void HEADER_RE;

    let className = "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const heading = line.match(HEADING_RE);
      if (heading) {
        className = heading[1];
        // 見出し行はデータ行正規表現に当たらないが、明示的に次へ。
        continue;
      }

      const m = line.match(DATA_RE);
      if (!m) continue;

      const [, time, bib, mid] = m;
      const { name, affiliation } = splitNameAndAffiliation(mid);
      rows.push({
        startTime: time,
        bib,
        name,
        affiliation,
        className,
      });
    }
  }

  return rows;
}
