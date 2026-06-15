/**
 * import-startlist の URL fetch 許可判定（SSRF 対策・純粋関数）。
 *
 * サーバ側で任意 URL を fetch するとプライベートネットワークやメタデータエンドポイントへの
 * 到達（SSRF）に悪用され得るため、取得先を JOY（japan-o-entry.com）に限定する
 * （ウォークスルー指摘 m2）。allowlist で実質すべて弾けるが、IP リテラル・localhost・
 * プライベート IP の拒否も防御的に明示する。
 */

const ALLOWED_HOSTS = new Set(["japan-o-entry.com", "www.japan-o-entry.com"]);

/** localhost / IP リテラル（プライベート含む）かの防御的判定。 */
function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  // IPv6 リテラル（URL.hostname は [] を除いた形）。allowlist 外だが明示拒否。
  if (h.includes(":")) return true;
  // IPv4 リテラルは一律拒否（プライベート帯か否かに関わらず allowlist のドメインではない）。
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/**
 * import-startlist で取得してよい URL か判定する。
 * http/https かつ japan-o-entry.com（www. 付き含む）のみ true。パース失敗は false。
 */
export function isAllowedStartlistUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (isPrivateOrLocalHost(parsed.hostname)) return false;
  return ALLOWED_HOSTS.has(parsed.hostname.toLowerCase());
}

/**
 * 会場→スタート所要時間の自動取得（programUrl）で取得してよい URL か判定する。
 *
 * 実データ検証で「プログラムは JOY getfile / Google Drive の両方がある」ことが判明したため、
 * import-startlist より広い allowlist を持つ専用判定にする（startlist 側は厳格なまま据え置き）。
 *
 * 許可ホスト: japan-o-entry.com（www 付き含む）/ drive.google.com /
 *            *.googleusercontent.com（Drive のダウンロード実体）。
 * private/localhost/IP リテラルは従来どおり拒否（SSRF 対策）。
 */
export function isAllowedProgramUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (isPrivateOrLocalHost(host)) return false;
  if (ALLOWED_HOSTS.has(host)) return true;
  if (host === "drive.google.com") return true;
  // *.googleusercontent.com（doc-XX-YY-docs.googleusercontent.com 等の Drive 実体）。
  if (host === "googleusercontent.com" || host.endsWith(".googleusercontent.com")) {
    return true;
  }
  return false;
}

/**
 * Google Drive の閲覧 URL を直リンク（ダウンロード）URL に正規化する純粋関数。
 *
 *   - https://drive.google.com/file/d/<ID>/view?... → uc?export=download&id=<ID>
 *   - https://drive.google.com/uc?...id=<ID>...     → uc?export=download&id=<ID>
 *   - https://drive.google.com/open?id=<ID>          → uc?export=download&id=<ID>
 *
 * Drive 以外・ID 抽出不能はそのまま返す（呼び出し側が元 URL で取得を試みる）。
 */
export function normalizeDriveUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname.toLowerCase() !== "drive.google.com") return url;

  // /file/d/<ID>/... を優先、無ければ ?id=<ID>（uc / open 両対応）。
  const fileMatch = /\/file\/d\/([A-Za-z0-9_-]+)/.exec(parsed.pathname);
  const id = fileMatch?.[1] ?? parsed.searchParams.get("id");
  if (!id) return url;

  return `https://drive.google.com/uc?export=download&id=${id}`;
}
