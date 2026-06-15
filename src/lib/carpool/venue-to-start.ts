/**
 * プログラム/要綱PDF等のテキストから「会場→スタートの所要時間（分）」候補を抽出する純粋関数。
 * （配車割 Phase 4 追補 → 実データ検証で「候補提示方式」に拡張）
 *
 * 実態（実PDF検証で判明）:
 *   - 所要時間は「徒歩◯分」とは限らず「所要時間 約30分」「大会バス」表現が多い。
 *   - 同じ「所要時間」が複数あり（子供体験 15〜25分 等）、単一自動確定は誤りやすい。
 *   → 単一値ではなく **候補リスト** を返し、スタート文脈に近いものほど高スコアにする。
 *     最終確定はユーザーが UI で選ぶ（自動プリフィルはしない）。
 *
 * I/O（PDF 取得・unpdf 抽出）は API ルート側に置き、本ファイルはテキスト → 候補のみ（純粋）。
 *
 * 設計の正本: orienteering-carpool/docs/plans/2026-06-15_buffer_breakdown_venue_to_start.md
 */

/** 抽出した所要時間候補の1件。 */
export interface VenueToStartCandidate {
  /** 所要分（1〜99）。 */
  minutes: number;
  /** ヒット箇所の前後を含む原文抜粋（UI の候補ボタン表示・出典確認用）。 */
  context: string;
  /** スタート文脈への近さによるスコア（高いほど会場→スタートらしい）。 */
  score: number;
}

/** 後方互換の単一値抽出結果（旧 API 形）。 */
export interface VenueToStartMatch {
  minutes: number;
  matched: string;
}

/**
 * 全角数字（０-９）を半角へ正規化する。それ以外の文字はそのまま。
 * 「徒歩１５分」「所要時間 約３０分」のような全角表記をパターンに通すための前処理。
 */
function normalizeDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

/**
 * 抽出した分が妥当か（1〜99分のみ採用）。0 や 3 桁超（100分以上）は棄却する。
 * 会場→スタートの所要は現実的に 1〜2 桁分に収まる前提（誤抽出のガード）。
 */
function isValidMinutes(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 99;
}

/**
 * 「N分」を含む表現の抽出パターン（全角正規化後の半角数字を1〜2グループ目で拾う）。
 * 候補列挙では「最初の1件」ではなく **すべての出現** を集めてスコアリングする。
 */
const NUMBER_PATTERNS: RegExp[] = [
  // 所要時間 [:：] 約? N 分
  /所要時間\s*[:：]?\s*約?\s*(\d{1,3})\s*分/g,
  // 徒歩 約? N 分
  /徒歩\s*約?\s*(\d{1,3})\s*分/g,
  // バス … 約? N 分（バスから10字以内に分表現。間に数字は挟まない＝先頭桁を食わせない）
  /バス[^。\n0-9０-９]{0,10}約?\s*(\d{1,3})\s*分/g,
  // N 分 程度|ほど|程|くらい
  /(\d{1,3})\s*分(?:程度|ほど|程|くらい)/g,
];

// 近傍に含まれると加点される語は scoreContext 内で重み付きに判定する
// （"スタートまで" > "スタート地区" > "スタート" > "誘導" > "会場" の順で強い）。
/** 近傍が「これら “だけ”」のときに減点する語（別目的の所要時間）。 */
const NEGATIVE_TERMS = ["体験", "説明", "受付", "表彰", "閉会"];

const CONTEXT_RADIUS = 40; // スコアリング近傍（前後の文字数の上限）
const CONTEXT_EXCERPT = 28; // UI 表示用に context へ載せる片側文字数
// 文の区切り（この文字を跨ぐと別文脈とみなしスコアリング近傍から外す）。
// 「、」は会場→スタートの一文中に入りやすい（例「会場から、スタートまで徒歩15分」）ため含めない。
const SENTENCE_BREAK = /[。\n]/;

/**
 * マッチ [start,end) のスコアリング近傍を、CONTEXT_RADIUS 内かつ
 * 直近の文区切り（。改行、）を跨がない範囲に切り詰めて返す。
 * 別の「所要時間」文が近接していても、文脈が混ざらないようにする。
 */
function sentenceWindow(text: string, start: number, end: number): string {
  // 後方: start から左へ、区切りに当たるか RADIUS まで戻る。
  let left = start;
  const leftLimit = Math.max(0, start - CONTEXT_RADIUS);
  while (left > leftLimit && !SENTENCE_BREAK.test(text[left - 1])) left--;
  // 前方: end から右へ、区切りに当たるか RADIUS まで進む。
  let right = end;
  const rightLimit = Math.min(text.length, end + CONTEXT_RADIUS);
  while (right < rightLimit && !SENTENCE_BREAK.test(text[right])) right++;
  return text.slice(left, right);
}

/**
 * 近傍テキストからスコアを算出する。
 *   - POSITIVE_TERMS を含むほど加点（"スタートまで" は強め）。
 *   - POSITIVE が1つも無く NEGATIVE のみある場合は減点（別目的の所要時間とみなす）。
 */
function scoreContext(near: string): number {
  let score = 0;
  let positiveHits = 0;
  if (near.includes("スタートまで")) {
    score += 5;
    positiveHits++;
  }
  if (near.includes("スタート地区")) {
    score += 4;
    positiveHits++;
  }
  if (near.includes("スタート")) {
    score += 3;
    positiveHits++;
  }
  if (near.includes("誘導")) {
    score += 2;
    positiveHits++;
  }
  if (near.includes("会場")) {
    score += 1;
    positiveHits++;
  }
  const hasNegative = NEGATIVE_TERMS.some((t) => near.includes(t));
  if (positiveHits === 0 && hasNegative) score -= 3;
  return score;
}

/**
 * テキストから会場→スタート所要時間の **候補リスト** を抽出する（純粋・テスト対象）。
 *
 * - 全角数字を正規化 → 各 NUMBER_PATTERN の全出現を集める。
 * - 各出現の前後 CONTEXT_RADIUS 字でスコアリング（スタート文脈の近さ）。
 * - minutes が妥当（1〜99）かつ score > 0（スタート文脈の語が近傍にある）候補のみ採用。
 *   ＝ スタートと無関係な「徒歩◯分」や、体験等の別目的の所要時間（score<=0）は除外。
 * - 同値 minutes は最高スコアで1件化。score 降順（同点は minutes 昇順）で返す。
 *
 * @param text PDF/プログラムから抽出した plain text。
 * @returns 候補配列（空ならヒットなし）。
 */
export function extractVenueToStartCandidates(text: string): VenueToStartCandidate[] {
  if (!text) return [];
  const normalized = normalizeDigits(text);

  // minutes → 最良候補（最高スコア）を保持する。
  const best = new Map<number, VenueToStartCandidate>();

  for (const re of NUMBER_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
      // パターンは数値を1つだけ持つ（左から最初の数字グループ）。
      const digit = m.slice(1).find((g) => g !== undefined && /^\d{1,3}$/.test(g));
      if (digit === undefined) continue;
      const minutes = Number(digit);
      if (!isValidMinutes(minutes)) continue;

      const start = m.index;
      const end = m.index + m[0].length;
      const near = sentenceWindow(normalized, start, end);
      const score = scoreContext(near);
      // スタート文脈の語が近傍に無い（score<=0）出現は会場→スタートと見なさない。
      if (score <= 0) continue;

      const context = normalized
        .slice(
          Math.max(0, start - CONTEXT_EXCERPT),
          Math.min(normalized.length, end + CONTEXT_EXCERPT),
        )
        .replace(/\s+/g, " ")
        .trim();

      const prev = best.get(minutes);
      if (!prev || score > prev.score) {
        best.set(minutes, { minutes, context, score });
      }
    }
  }

  return [...best.values()].sort(
    (a, b) => b.score - a.score || a.minutes - b.minutes,
  );
}

/**
 * 後方互換: テキストから会場→スタートの単一値を返す（旧 API 形）。
 * 候補抽出の先頭（最高スコア）を採用する。スコアが負の候補しか無ければ null。
 *
 * @param text PDF/要綱から抽出した plain text。
 * @returns 取れたら { minutes, matched }、取れなければ null。
 */
export function extractVenueToStartMinutes(text: string): VenueToStartMatch | null {
  const candidates = extractVenueToStartCandidates(text);
  const top = candidates[0];
  if (!top || top.score <= 0) return null;
  return { minutes: top.minutes, matched: top.context };
}
