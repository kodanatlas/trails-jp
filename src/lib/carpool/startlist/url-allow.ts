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
