// The User-Agent sent to CDC WONDER.
//
// Node's built-in fetch identifies itself as "node" unless told otherwise, and
// CDC's edge (Akamai) refuses that exact string. Measured 2026-11-11 from one
// machine, same IP, same request, seventeen seconds apart:
//
//   curl, its own User-Agent               200
//   curl, "User-Agent: node"               403
//   Node fetch, default                    403
//   Node fetch, a named product token      200
//
// Nothing else Node adds (Accept-Language, Sec-Fetch-Mode, Connection: close)
// made any difference. The address this site runs on gets through with the
// default most of the time, which is why it went unnoticed. Whether the
// intermittent 403s seen there ("poisoned connections") are this same rule
// firing has not been established; it is the first thing to rule out.
//
// This is not the browser spoofing the route warns against. It says what the
// client is, which is what the header is for; claiming to be Chrome without
// Chrome's TLS fingerprint remains a bad idea.

const DEFAULT_USER_AGENT = "MortalityDataPortal/1.0";

/**
 * @param override  WONDER_USER_AGENT, for adding a contact address without a
 *   code change, e.g. "MortalityDataPortal/1.0 (+https://example.org/contact)".
 */
export function wonderUserAgent(override: string | undefined = process.env.WONDER_USER_AGENT): string {
  // A header value cannot carry control characters, and an override that is
  // blank or is the very string being avoided is no override at all.
  const cleaned = (override ?? "").replace(/[^\x20-\x7e]/g, "").trim();
  if (!cleaned || /^node$/i.test(cleaned)) return DEFAULT_USER_AGENT;
  return cleaned;
}
