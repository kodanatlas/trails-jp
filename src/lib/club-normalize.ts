/**
 * クラブ（所属）名の名寄せ・分割ロジック。
 * 選手ページ（scripts/build-analysis-index.ts）とイベントのエントリーリストで共有する。
 *
 * - normalizeClubName: 表記ゆれを正式名に正規化
 * - splitAffiliations: 区切り分割 → 各要素を正規化 → 空要素除外（重複除去はしない）
 */

/** 区切り文字なしの複合クラブ名を事前分割するための特例マップ */
const CLUB_SPLIT: Record<string, string[]> = {
  "法政大OLCOB上尾OLC": ["法政大学", "上尾OLC"],
  "丘の上尾OLC": ["丘の上", "上尾OLC"],
};

/**
 * クラブ名の名寄せ (正規化)
 * 1. 大学OLC略称 → 正式大学名 (京大OLC → 京都大学)
 * 2. 大学大学院・大学院 → 大学
 * 3. 大学+末尾数字 → 大学 (京都大学3 → 京都大学)
 * 4. 末尾スペース+数字除去
 * 5. OLクラブ → OLC, olc → OLC
 */
export function normalizeClubName(raw: string): string {
  let name = raw.trim();

  // --- 0. 全角英数字→半角に統一 ---
  name = name.replace(/[Ａ-Ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF21 + 0x41));
  name = name.replace(/[ａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF41 + 0x61));
  name = name.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30));

  // --- 0b. 大文字小文字の事前統一 ---
  name = name.replace(/olc/gi, "OLC");
  name = name.replace(/olk/gi, "OLK");

  // --- 1. 大学OLC略称の明示的マッピング ---
  const universityMap: Record<string, string> = {
    "京大OLC": "京都大学",
    "北大OLC": "北海道大学",
    "千葉大OLC": "千葉大学",
    "東北大OLC": "東北大学",
    "東北大学OLC": "東北大学",
    "広大OLC": "広島大学",
    "阪大OLC": "大阪大学",
    "大阪大学OLC": "大阪大学",
    "金大OLC": "金沢大学",
    "金大OLC44期": "金沢大学",
    "岩手大学OLC": "岩手大学",
    "京女OLC": "京都女子大学",
    "奈良女OLC": "奈良女子大学",
    "同志社OLC": "同志社大学",
    "立命OLC": "立命館大学",
    "立命館OLC": "立命館大学",
    "神大OLC": "神戸大学",
    "神大大学4": "神戸大学",
    "東大大学院": "東京大学",
    "新潟大学OC1年": "新潟大学",
    "HUOLC": "北海道大学",
    "阪大30期": "大阪大学",
    "阪大2011入学": "大阪大学",
    "東京科学大OLT": "東京科学大学",
    "神大OLK": "神戸大学",
    "一橋OLK": "一橋大学",
    "日大OLK": "日本大学",
    "神戸大学オリエンテーリングクラブ": "神戸大学",
    "筑波大学オリエンテーリング部": "筑波大学",
    "筑波大学体育会オリエンテーリング部": "筑波大学",
    "東北大学農学部": "東北大学",
    "磨くっちゃ漢@東北大OLC": "東北大学",
    "十文字女子大学": "十文字学園女子大学",
    "大阪OLCおろしの会": "大阪OLC",
    "東京農業大学（オホーツク）4": "東京農業大学オホーツク",
    "OLK35th": "東大OLK",
    "慶應義塾": "慶應義塾大学",
    "中央大学附属高等学校WILDLIFE": "中央大学附属高等学校",
    "麻布学園オリエンテーリング部": "麻布学園OLK",
    "麻布高等学校": "麻布学園OLK",
    "朱雀オリエンテーリングクラブ": "朱雀OK",
    "京葉オリエンテーリングクラブ": "京葉OLC",
    "多摩オリエンテーリングクラブ": "多摩OL",
    "福島県オリエンテーリング協会": "福島県協会",
    "福島県OL協会": "福島県協会",
  };
  if (universityMap[name]) return universityMap[name];

  // --- 2. 大学院系の正規化 ---
  // "京都大学大学院" → "京都大学", "大阪大学大学院4" → "大阪大学"
  name = name.replace(/大学大学院\d*$/, "大学");
  // "筑波大学院" → "筑波大学", "名古屋大学院4" → "名古屋大学"
  name = name.replace(/(..+大)学院\d*$/, "$1学");

  // --- 3. 大学+末尾数字 (京都大学3, 広島大学1 etc.) ---
  name = name.replace(/(大学)\d+$/, "$1");

  // --- 4. 末尾の「N期」を除去 (つばめ会41期 → つばめ会, 名椙45期 → 名椙 etc.) ---
  name = name.replace(/\d+期$/, "");

  // --- 5. 末尾のスペース+数字を除去 (e.g. "金沢大学 3" → "金沢大学") ---
  name = name.replace(/\s+\d+$/, "");

  // --- 5b. 日本語名の末尾数字を除去 (e.g. "青葉会18" → "青葉会", "越王会'14" → "越王会") ---
  // 漢字・ひらがな・カタカナの後に続く '? + 数字 を除去（英字のみのクラブ名は対象外）
  name = name.replace(/([　-鿿豈-﫿])'?\d+$/, "$1");

  // --- 6. 一般的な正規化 ---
  name = name.replace(/OLクラブ$/, "OLC");

  if (name === "ES関東" || name === "ES関東クラブ") {
    name = "ES関東C";
  }

  // --- 7. 略称→正式名の個別マッピング ---
  const aliasMap: Record<string, string> = {
    "三河": "三河OLC",
    "名椙": "名椙OLC",
    "大阪": "大阪OLC",
    "練馬": "練馬OLC",
    "レオ": "OLCレオ",
    "新潟": "新潟大学",
    "金沢": "金沢大学",
    "神戸": "神戸大学",
    "いずもOLC": "いづもOLC",
    "MOXINA OK": "Moxina OK",
    "ふるはうす": "OLCふるはうす",
    "サンスーシ": "OLCサンスーシ",
    "ルーパー": "OLCルーパー",
    "京葉OL": "京葉OLC",
    "横浜OL": "横浜OLC",
    "晴れの国岡山OLC": "晴れの国岡山",
    "札幌農学校OLC": "札幌農学校",
    "トータス金沢支部": "トータス",
  };
  if (aliasMap[name]) name = aliasMap[name];

  return name;
}

/**
 * 所属文字列を区切り、正規化したクラブ名の配列を返す。
 * 区切り: "/"・全角空白(　)・"、" / 特例は CLUB_SPLIT。
 * 空文字・"-" は空配列。重複除去はしない（呼び出し側の集計に委ねる）。
 */
export function splitAffiliations(raw: string): string[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === "-") return [];
  const parts = CLUB_SPLIT[trimmed] ? CLUB_SPLIT[trimmed] : trimmed.split(/[\/　、]/);
  return parts.map((c) => normalizeClubName(c)).filter(Boolean);
}
