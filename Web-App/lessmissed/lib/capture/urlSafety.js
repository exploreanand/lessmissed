// Is this URL safe for the capture worker to navigate to?
//
// The worker is a browser that fetches attacker-influenceable URLs from inside
// our network. That is the textbook SSRF shape, and the mitigation has to be
// applied at two separate moments: when an admin first supplies a URL, and
// again on every redirect the browser follows. Checking only the first is the
// classic bypass — a public hostname that 302s to 169.254.169.254 defeats any
// filter that validates the typed string and then hands it to a browser.
//
// Plain ESM, no "@/" alias, so the worker can import it under bare Node.

import dns from "node:dns/promises";
import net from "node:net";

/** Only these ever reach a browser. No file:, data:, blob:, ftp:, gopher:. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export class UnsafeUrlError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "UnsafeUrlError";
    this.code = code;
  }
}

/**
 * URL.hostname returns an IPv6 literal wrapped in brackets ("[::1]"), which
 * net.isIP rejects. Left unstripped, every bracketed IPv6 address would skip
 * the range check below and fall through to a DNS lookup — a straightforward
 * way to reach loopback and link-local space.
 */
function normalizeHost(hostname) {
  const host = String(hostname).toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Is this literal IP address one the worker must never connect to?
 *
 * Covers loopback, RFC1918 private space, link-local (and with it the cloud
 * metadata endpoint at 169.254.169.254, the single highest-value SSRF target),
 * carrier-grade NAT, broadcast/multicast, and the IPv6 equivalents including
 * IPv4-mapped addresses like ::ffff:127.0.0.1 which otherwise slip through an
 * IPv4-only check.
 */
export function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return true; // not an IP at all — fail closed

  if (family === 4) return isBlockedIPv4(address);
  return isBlockedIPv6(address);
}

function isBlockedIPv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;

  if (a === 0) return true; // "this" network
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isBlockedIPv6(address) {
  const addr = address.toLowerCase().split("%")[0]; // strip zone index

  if (addr === "::" || addr === "::1") return true; // unspecified, loopback

  // Expand to the full 8 groups before judging anything. Pattern-matching the
  // textual form is not enough: the URL parser rewrites "::ffff:127.0.0.1" to
  // "::ffff:7f00:1", so a check that only recognised the dotted-quad spelling
  // would wave through every IPv4-mapped address written the other way.
  const groups = expandIPv6(addr);
  if (!groups) return true; // unparseable — fail closed

  // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96): the low 32 bits
  // are an IPv4 address and must be judged by the IPv4 rules.
  const isMapped = groups.slice(0, 5).every((g) => g === 0) &&
    (groups[5] === 0xffff || groups[5] === 0);
  if (isMapped) {
    const v4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
    return isBlockedIPv4(v4);
  }

  const first = groups[0];
  if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((first & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((first & 0xff00) === 0xff00) return true; // multicast ff00::/8
  return false;
}

/** "::ffff:7f00:1" -> [0,0,0,0,0,65535,32512,1]. Null if not parseable. */
function expandIPv6(addr) {
  const halves = addr.split("::");
  if (halves.length > 2) return null;

  const parse = (part) =>
    part ? part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)) : [];

  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some(Number.isNaN)) return null;

  const groups =
    halves.length === 2
      ? [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail]
      : head;

  return groups.length === 8 ? groups : null;
}

/**
 * Is this URL's host a literal IP that must not be connected to?
 *
 * The cheap, no-DNS check for subresources. Returns **false** for ordinary
 * domain names: a hostname is not an address, so the range rules simply do not
 * apply to it, and whether it resolves somewhere private is a question only DNS
 * can answer.
 *
 * Do not reach for `isBlockedAddress` here. It fails closed on anything that is
 * not a literal IP — correct when judging an address, catastrophic when handed
 * a hostname, because every stylesheet, font and image on the page is served
 * from a domain name and would be blocked. That bug renders pages as bare
 * unstyled HTML.
 */
export function isBlockedLiteralHost(hostname) {
  const host = normalizeHost(hostname ?? "");
  if (!net.isIP(host)) return false; // a domain name — not our call to make
  return isBlockedAddress(host);
}

/**
 * Validate a URL string and confirm every address its host resolves to is
 * publicly routable.
 *
 * Checks *all* resolved addresses, not just the first: a host with one public
 * and one private A record would otherwise pass validation and then connect to
 * whichever the browser's own resolver preferred.
 *
 * @param {string} rawUrl
 * @param {{ expectedHostname?: string }} [options] expectedHostname binds the
 *   URL to a project's verified domain, so the worker cannot be pointed at an
 *   arbitrary third-party site — the difference between a capture tool and an
 *   open screenshot proxy.
 * @returns {Promise<{ url: URL, addresses: string[] }>}
 * @throws {UnsafeUrlError}
 */
export async function assertSafeUrl(rawUrl, options = {}) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new UnsafeUrlError(`Not a valid URL: ${rawUrl}`, "invalid_url");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError(
      `Only http and https can be captured, not ${url.protocol}`,
      "bad_protocol"
    );
  }

  // Credentials in the URL would be sent to whatever the host resolves to, and
  // are never something we want stored on a page record.
  if (url.username || url.password) {
    throw new UnsafeUrlError("URL must not contain credentials", "credentials_in_url");
  }

  if (options.expectedHostname && !hostMatches(url.hostname, options.expectedHostname)) {
    throw new UnsafeUrlError(
      `${url.hostname} is not part of ${options.expectedHostname}`,
      "wrong_origin"
    );
  }

  // A literal IP needs no DNS, but still needs the range check.
  const host = normalizeHost(url.hostname);
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new UnsafeUrlError(`${host} is not publicly routable`, "blocked_address");
    }
    return { url, addresses: [host] };
  }

  let resolved;
  try {
    resolved = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve ${host}`, "dns_failure");
  }

  const addresses = resolved.map((r) => r.address);
  if (!addresses.length) {
    throw new UnsafeUrlError(`${url.hostname} resolved to nothing`, "dns_failure");
  }

  const blocked = addresses.find((address) => isBlockedAddress(address));
  if (blocked) {
    throw new UnsafeUrlError(
      `${url.hostname} resolves to a private address (${blocked})`,
      "blocked_address"
    );
  }

  return { url, addresses };
}

/**
 * Does `hostname` belong to `expected`? Accepts the bare domain and any
 * subdomain of it, so a project on "acme.com" may capture "www.acme.com" and
 * "shop.acme.com" but not "notacme.com" — the suffix check is anchored on a
 * dot precisely to reject that.
 */
export function hostMatches(hostname, expected) {
  const host = String(hostname).toLowerCase().replace(/\.$/, "");
  const want = String(expected).toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return host === want || host.endsWith(`.${want}`);
}
