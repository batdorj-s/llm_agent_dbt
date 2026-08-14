import { lookup } from "dns/promises";
import { isIP } from "net";

/**
 * SSRF guard for outbound webhook fetches.
 *
 * Blocks URLs that target:
 *  - non-http(s) schemes (file://, gopher://, etc.)
 *  - localhost / loopback addresses
 *  - private (RFC1918) and link-local ranges
 *  - cloud metadata endpoints (169.254.169.254)
 *
 * Hostnames are resolved to IPs at check time to defend against
 * DNS-rebinding style attacks; if any resolved address is blocked,
 * the whole URL is rejected.
 */

const BLOCKED_RANGES: Array<{ label: string; test: (ip: string) => boolean }> = [
  { label: "loopback", test: (ip) => ip === "127.0.0.1" || ip === "::1" || ip.startsWith("127.") },
  { label: "link-local IPv4", test: (ip) => ip.startsWith("169.254.") },
  { label: "private IPv4 10/8", test: (ip) => ip.startsWith("10.") },
  { label: "private IPv4 172.16/12", test: (ip) => {
      const m = ip.match(/^172\.(\d+)\./);
      return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31;
    } },
  { label: "private IPv4 192.168/16", test: (ip) => ip.startsWith("192.168.") },
  { label: "private IPv6 fc00::/7", test: (ip) => /^f[cd][0-9a-f]{2}:/i.test(ip) },
  { label: "link-local IPv6 fe80::/10", test: (ip) => /^fe[89ab][0-9a-f]:/i.test(ip) },
  { label: "unspecified", test: (ip) => ip === "0.0.0.0" || ip === "::" },
];

export function isBlockedIp(ip: string): { blocked: boolean; reason?: string } {
  if (isIP(ip) === 0) return { blocked: false }; // non-IP (hostname) resolved elsewhere
  for (const range of BLOCKED_RANGES) {
    if (range.test(ip)) return { blocked: true, reason: range.label };
  }
  return { blocked: false };
}

/**
 * Validates a webhook URL. Throws if the URL is not https/http or if the
 * resolved host is private/loopback/link-local.
 *
 * @param url       the webhook URL to validate
 * @param allowHttp when false (default), http:// URLs are rejected
 */
export async function assertSafeWebhookUrl(url: string, allowHttp = false): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid webhook URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported webhook URL protocol: ${parsed.protocol}`);
  }
  if (parsed.protocol === "http:" && !allowHttp) {
    throw new Error("Webhook URL must use HTTPS");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost") {
    throw new Error("Webhook URL must not target localhost");
  }

  // Literal IP — check directly
  const directIp = isIP(hostname);
  if (directIp !== 0) {
    const { blocked, reason } = isBlockedIp(hostname);
    if (blocked) throw new Error(`Webhook URL targets blocked address (${reason})`);
    return;
  }

  // Hostname — resolve and check every address (DNS-rebinding defense)
  let addresses: string[];
  try {
    const result = await lookup(hostname, { all: true });
    addresses = result.map((r) => r.address);
  } catch {
    throw new Error(`Webhook URL host could not be resolved: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new Error(`Webhook URL host could not be resolved: ${hostname}`);
  }
  for (const addr of addresses) {
    const { blocked, reason } = isBlockedIp(addr);
    if (blocked) throw new Error(`Webhook URL resolves to blocked address (${reason})`);
  }
}
