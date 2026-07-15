/**
 * クラスがスタート時刻を持つか（抽選）／持たないか（フリースタート）の判定。純関数・決定的。
 *
 * **2026-07-15 の重大な誤りの修正。** それまで「時刻が無い＝O-Ringen 側が未抽選。開催が近づくと埋まる」と
 * 表示していたが**誤り**。公式（https://oringen.se/tavling/ol.html）が明記している:
 *
 *   - Huvudklass: 「lottad starttid för alla **utom DH75-95 som har fri minutstart**」
 *     ＝抽選。ただし **DH75〜95 はフリースタート**
 *   - Kortklass（成人）: 「**Du har fri starttid** och väljer startminut när du kommer fram till din start」
 *     ＝当日スタート地点で自分で分を選ぶ
 *   - 「Ungdomarnas kortklasser ... har **lottad starttid**」＝**少年の Kort だけ抽選**
 *   - Motionsklass: 「**fri starttid** på varje etapp」
 *   - Öppen klass / Etappstart / Inskolning: フリースタート
 *   - PreO: 「**fri minutstart** för samtliga klasser」（2026-07-07 のニュース）
 *
 * 実データとも完全に一致する（1日目・全189クラスで **0% か 100% の二値**。作業中のクラスは1つも無い）。
 * つまりフリースタートの人に「待てば埋まる」と言うのは嘘で、**待っても永久に埋まらない**。
 *
 * スタート時刻は 2026-07-07 に OL、07-13 に MTBO が公開済み（公式ニュース）。
 */

/**
 * フリースタート（時刻が割り当てられない）クラスの判定。
 *
 * **「時刻が無い」＝「フリースタート」ではない**点に注意。Elit クラスは 0% だが、これは未公開であって
 * フリースタートではない（Elittour は E1-2/E4-5 が別途抽選、E3 はスプリント）。この関数は
 * 「割り当てが**そもそも無い**」クラスだけを true にする。実データとの照合は
 * `isFreeStart(x) === true → 実データは必ず 0%` の一方向でのみ検証できる。
 */
export function isFreeStart(className: string): boolean {
  const n = className.trim();

  // --- MTBO は OL と規則が違う。Etappstart だけがフリーで、年齢クラス（Kort 含む）は抽選済み ---
  // 実データ: MTBO D21 Kort は 7/7 が時刻を持つ（＝抽選）。「成人 Kort=フリー」は OL の規則。
  if (/^MTBO /.test(n)) return /^MTBO Etappstart /.test(n);

  // --- Elit は未公開であってフリーではない ---
  if (/ Elit$/.test(n) && /^[DH]\d/.test(n)) return false;

  // --- Etappstart / 開放クラス（色）/ Inskolning / Prova på / PreO / Para-I / 3-dagars ---
  if (/^Etappstart /.test(n)) return true;
  if (/^(Vit|Gul|Orange|Lila|Blå|Svart) /.test(n)) return true;
  if (/^(Inskolning|Prova på)/.test(n)) return true;
  // PreO のクラス（Pre-A/B/C/Elit）。公式ニュース: PreO は fri minutstart för samtliga klasser
  if (/^Pre-(A|B|C|Elit)$/.test(n)) return true;
  if (/Para-I/.test(n)) return true;
  if (/^3-dagars /.test(n)) return true;

  // --- Motion は常にフリースタート ---
  if (/ Motion$/.test(n)) return true;

  // --- Kort: 少年（DH10-16）は抽選、成人はフリースタート ---
  if (/ Kort(-\d)?$/.test(n)) {
    const youth = /^[DH](1[0-6])\s+Kort/.exec(n);
    return youth ? false : true;
  }

  // --- Huvudklass の DH75〜95 はフリースタート ---
  const m = /^[DH](\d{2})(?:$| )/.exec(n);
  if (m && Number(m[1]) >= 75) return true;

  return false;
}

/**
 * 5日目（最終日）が追い抜きスタート（jaktstart）かどうか。
 *
 * 公式: 「Tävlingen avgörs på sista etappen med **jaktstart för alla utom DH10–DH12 och Para-I**」
 *       Kortklass も「På femte etappen är det **jaktstart**」（1〜4日目はフリースタートなのに5日目だけ抽選相当）
 *
 * 実データと完全に一致する。5日目に時刻を持つのは **D10/D11/D12/H10/H11/H12 とその Kort の12クラスだけ**で、
 * 残り64クラスは 0%（＝4日目の結果が出るまで時刻が決まらない）。
 *
 * **これは「待てば入る」未確定であって、フリースタート（永久に入らない）とは別物。** 混同すると、
 * 5日目を「フリー」と表示して選手が時刻を見に来なくなる。
 */
export function isChaseStartOnFinalStage(className: string): boolean {
  const n = className.trim();
  if (/Para-I/.test(n)) return false;
  // DH10〜DH12（Kort 含む）は追い抜きスタートの対象外＝5日目も抽選で公開済み
  if (/^[DH]1[012](\s|$)/.test(n)) return false;
  // PreO / Inskolning は総合順位を争わないので追い抜きスタートではない
  if (/^(Pre-A|Pre-B|Pre-C|Pre-Elit|Inskolning|Prova på)/.test(n)) return false;
  // Etappstart は単日参加なので総合が無い
  if (/^(Etappstart |MTBO Etappstart )/.test(n)) return false;
  return true;
}

/** 「時刻が無い」理由。UI で表示を分けるために使う。 */
export type MissingStartReason = "free-start" | "chase-start" | "unpublished";

/**
 * ある (クラス, 日) で時刻が無いときの理由を返す。
 *
 * - `free-start`  … 当日スタート地点で自分で分を選ぶ。**永久に入らない**
 * - `chase-start` … 5日目の追い抜きスタート。**4日目の結果が出たら入る**
 * - `unpublished` … 抽選クラスだが未公開（日本勢では Elit のみ＝該当者なし）
 */
export function missingStartReason(className: string, stage: number): MissingStartReason {
  if (stage === 5 && isChaseStartOnFinalStage(className)) return "chase-start";
  if (isFreeStart(className)) return "free-start";
  return "unpublished";
}
