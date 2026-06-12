/**
 * 配車割 API 層のクラブ規模依存定数。
 * 「クラブの体感に依存する数値」はここに集約し、ハンドラ/ヘルパーに散在させない。
 */

/** レート制限: 同一 ip_hash で直近この時間窓の書き込みを数える（ミリ秒）。 */
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 時間

/**
 * レート制限: 上記窓内でこの件数を「超えた」ら 429（>、=は許可）。
 *
 * 注意（XFF 偽装）: IP は x-forwarded-for 先頭から取る。この値が信頼できるのは
 * Vercel が終端プロキシとして付与する **Vercel 限定運用** の前提による。
 * セルフホスト等で直接公開すると任意ヘッダで偽装可能になる。
 */
export const RATE_LIMIT_MAX_WRITES = 100;

/** travel-times バッチ upsert の 1 リクエスト上限件数。 */
export const TRAVEL_TIMES_BATCH_LIMIT = 200;

/** ピックアップ希望の1メンバーあたり上限。 */
export const PICKUP_PREFS_MAX = 20;

/** route_times の1ルートあたり上限。 */
export const ROUTE_TIMES_MAX = 100;

/** risk_windows の1ルートあたり上限。 */
export const RISK_WINDOWS_MAX = 20;

/** 所要分の上限（移動時間・会場までの所要に共通。24時間）。 */
export const MINUTES_MAX = 1440;

/** 片道高速料金の上限（円）。 */
export const TOLL_YEN_MAX = 100000;

/** 競技予想時間の上限（分）。 */
export const EST_COURSE_MIN_MAX = 600;

/** events-search で返す最大件数。 */
export const EVENTS_SEARCH_LIMIT = 30;

/** actor_name の長さ制約。 */
export const ACTOR_NAME_MIN = 1;
export const ACTOR_NAME_MAX = 30;

/** 既定の到着バッファ（分）。クラブ settings 未設定時のフォールバック。 */
export const DEFAULT_BUFFER_MIN = 75;

/** participations の一括登録（検出パネル）で1リクエストに含められる上限件数。 */
export const PARTICIPATION_BULK_LIMIT = 30;
