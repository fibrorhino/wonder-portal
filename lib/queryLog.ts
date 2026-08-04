// Append-only usage log: what was queried, by whom, from where.
//
// Writes one JSON object per line to logs/queries.jsonl (JSONL), which stays
// readable with a text editor and is trivial to summarise — see
// tools/query-report.mjs.
//
// Client details come from headers Cloudflare sets on the way through the
// tunnel, so they are real rather than the 127.0.0.1 the socket would show:
//   CF-Connecting-IP  the visitor's actual IP
//   CF-IPCountry      two-letter country, no geo-IP database needed
// These are trustworthy here because the app is ONLY reachable through the
// tunnel — nothing can connect directly and forge them.
//
// Logging must never break a query: every call is wrapped, and a failure to
// write is swallowed (reported once to stderr).
//
// PRIVACY: IP addresses are personal data in most jurisdictions. To stop
// storing them, change `anonymiseIp` below to hash or truncate — nothing else
// needs to change.

import { appendFile, stat, rename, unlink } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "queries.jsonl");
const MAX_BYTES = 5 * 1024 * 1024; // rotate at 5 MB
const KEEP_ROTATIONS = 3; // queries.jsonl.1 .. .3

let dirReady = false;
let warned = false;

function ensureDir(): void {
  if (dirReady) return;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    dirReady = true;
  } catch {
    /* handled by the caller's try/catch */
  }
}

/**
 * Identity transform: the full IP is stored. Swap for a hash or a truncation
 * (e.g. drop the last octet) if you'd rather not keep the raw address.
 */
function anonymiseIp(ip: string): string {
  return ip;
}

/** Real client IP, preferring the header Cloudflare sets. */
function clientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return anonymiseIp(cf.trim());
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return anonymiseIp(fwd.split(",")[0].trim());
  return "unknown";
}

interface UaInfo {
  browser: string;
  os: string;
  device: "mobile" | "tablet" | "desktop" | "bot" | "unknown";
}

/**
 * Small dependency-free User-Agent classifier. Order matters: Edge and Opera
 * both claim to be Chrome, and Chrome claims to be Safari, so the more
 * specific families must be tested first.
 */
export function parseUserAgent(ua: string): UaInfo {
  if (!ua) return { browser: "unknown", os: "unknown", device: "unknown" };
  const s = ua.toLowerCase();

  if (/bot|crawler|spider|crawling|headless|monitor|uptime|curl|wget|python-requests/.test(s)) {
    return { browser: "bot", os: "n/a", device: "bot" };
  }

  let browser = "other";
  if (s.includes("edg/") || s.includes("edga/") || s.includes("edgios/")) browser = "Edge";
  else if (s.includes("opr/") || s.includes("opera")) browser = "Opera";
  else if (s.includes("firefox/") || s.includes("fxios/")) browser = "Firefox";
  else if (s.includes("chrome/") || s.includes("crios/")) browser = "Chrome";
  else if (s.includes("safari/")) browser = "Safari";

  let os = "other";
  if (s.includes("windows")) os = "Windows";
  else if (s.includes("iphone") || s.includes("ipad") || s.includes("ipod")) os = "iOS";
  else if (s.includes("mac os x") || s.includes("macintosh")) os = "macOS";
  else if (s.includes("android")) os = "Android";
  else if (s.includes("linux")) os = "Linux";

  let device: UaInfo["device"] = "desktop";
  if (s.includes("ipad") || (s.includes("android") && !s.includes("mobile"))) device = "tablet";
  else if (s.includes("mobi") || s.includes("iphone") || s.includes("android")) device = "mobile";

  return { browser, os, device };
}

export interface QueryLogEntry {
  /** "query" = a WONDER query, "nl" = a natural-language prompt. */
  kind: "query" | "nl";
  ok: boolean;
  ms: number;
  cached?: boolean;
  /** kind === "query" */
  groupBy?: string[];
  measures?: string[];
  filters?: Record<string, string[]>;
  /** kind === "nl" */
  text?: string;
  /** Populated on failures. */
  error?: string;
}

async function rotateIfNeeded(): Promise<void> {
  let size = 0;
  try {
    size = (await stat(LOG_FILE)).size;
  } catch {
    return; // no file yet
  }
  if (size < MAX_BYTES) return;

  try {
    await unlink(`${LOG_FILE}.${KEEP_ROTATIONS}`);
  } catch {
    /* may not exist */
  }
  for (let i = KEEP_ROTATIONS - 1; i >= 1; i--) {
    try {
      await rename(`${LOG_FILE}.${i}`, `${LOG_FILE}.${i + 1}`);
    } catch {
      /* may not exist */
    }
  }
  await rename(LOG_FILE, `${LOG_FILE}.1`);
}

/** Fire-and-forget. Never throws, never blocks the response. */
export function logQuery(headers: Headers, entry: QueryLogEntry): void {
  void (async () => {
    try {
      ensureDir();
      await rotateIfNeeded();

      const ua = headers.get("user-agent") ?? "";
      const parsed = parseUserAgent(ua);
      const referrer = headers.get("referer") ?? "";

      const record = {
        at: new Date().toISOString(),
        ...entry,
        ip: clientIp(headers),
        country: headers.get("cf-ipcountry") ?? "unknown",
        browser: parsed.browser,
        os: parsed.os,
        device: parsed.device,
        lang: (headers.get("accept-language") ?? "").split(",")[0] || "unknown",
        referrer: referrer.slice(0, 300),
        ua: ua.slice(0, 300),
      };

      await appendFile(LOG_FILE, JSON.stringify(record) + "\n", "utf8");
    } catch (e) {
      if (!warned) {
        warned = true;
        console.error(
          "[queryLog] could not write usage log (continuing without it):",
          e instanceof Error ? e.message : e,
        );
      }
    }
  })();
}
