/**
 * 画面の振る舞いの切り替えスイッチ（試験導入した機能を1か所で戻せるようにする）。
 */

/**
 * 省略表示（…）された文字を、長押しで吹き出しに全文表示する（PC はマウスを乗せると全文のツールチップ）。
 * false にすると FullText は従来どおりの省略表示だけになる（長押ししても何も起きない）。
 * 2026-09-30 試験導入。docs/plans/2026-09-30_fulltext-long-press.md
 */
export const FULLTEXT_ON_LONG_PRESS = true;
