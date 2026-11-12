// POST /api/wonder — the only WONDER-facing endpoint. Accepts a QuerySpec,
// builds the request_xml, POSTs it to CDC WONDER server-side (avoids CORS and
// keeps one place to handle CDC IP-blocking), parses the XML, and returns a
// normalized ResultTable.

import { NextRequest, NextResponse } from "next/server";
import type { QuerySpec, ResultTable, WonderResponse } from "@/lib/wonder/types";
import { getDatabase } from "@/lib/wonder/db/registry";
import { runComposite } from "@/lib/wonder/composite";
import { normalizeSpec, validateSpec } from "@/lib/wonder/validateSpec";
import { createThrottle, QueueFullError } from "@/lib/wonder/throttle";
import { wonderUserAgent } from "@/lib/wonder/userAgent";
import { observe } from "@/lib/revisions";
import { buildRequestXml } from "@/lib/wonder/buildRequest";
import { decodeBody, extractError, parseResponse } from "@/lib/wonder/parseResponse";
import {
  cdcBusyMessage,
  cdcHttpErrorMessage,
  cdcNetworkErrorMessage,
  isQueryRejection,
} from "@/lib/wonder/cdcErrors";
import { cacheGet, cacheKey, cacheSet, FINAL_TTL_MS, PROVISIONAL_TTL_MS } from "@/lib/cache";
import {
  recordCacheHit,
  recordCdcFailure,
  recordCdcSuccess,
} from "@/lib/wonderHealth";
import { logQuery } from "@/lib/queryLog";

// Each database is its own endpoint. This must follow the spec, not a
// constant: a spec naming D176 sent to the D158 URL returns D158 data with no
// error at all, which is the worst possible failure.
const wonderUrl = (databaseId: string) =>
  `https://wonder.cdc.gov/controller/datarequest/${databaseId}`;

export const runtime = "nodejs";
// A single WONDER query is slow; a combined one is several in series, spaced by
// CDC's own fifteen-second minimum, and measures around 48s for the three-file
// span — close enough to 60 that a slow day would trip it. This export only
// binds on Vercel, where 300 is the fluid-compute ceiling; the self-hosted
// server this actually runs on has no such limit, but the tunnel in front of it
// gives up at 100s, which is the real constraint on how many sources a
// composite can have.
export const maxDuration = 300;

// CDC requires >= 15 s between consecutive API requests, so every outbound
// WONDER call goes through one queue with enforced spacing. (Cache hits skip
// it entirely.) The queue is bounded: the tunnel in front of this server drops
// a request at 100 s, so a call that would start later than this can only end
// in a timeout for the visitor and a CDC request nobody is waiting for.
const throttle = createThrottle({ minGapMs: 15_500, maxWaitMs: 75_000 });

type Outcome =
  | { ok: true; table: ResultTable }
  | { ok: false; error: string; status: number; detail?: string };

// Identical queries that arrive while the first is still running share its
// result. The cache only helps once a query has finished, and a shared link
// opened by a whole seminar at once is the same query many times over: without
// this, each copy took its own turn in the 15-second queue.
const inflight = new Map<string, Promise<{ outcome: Outcome; revisions: Awaited<ReturnType<typeof observe>> }>>();

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const normalized = normalizeSpec(body);
  if (typeof normalized === "string") {
    return NextResponse.json({ ok: false, error: normalized }, { status: 400 });
  }
  const spec: QuerySpec = normalized;

  // Usage log — one line per query. Fire-and-forget; never blocks or throws.
  const log = (
    ok: boolean,
    extra: { cached?: boolean; error?: string; detail?: string } = {},
  ) =>
    logQuery(req.headers, {
      kind: "query",
      ok,
      ms: Date.now() - startedAt,
      database: spec.database,
      groupBy: spec.groupBy,
      measures: spec.measures,
      filters: spec.filters,
      ...extra,
    });

  const invalid = validateSpec(spec);
  if (invalid) {
    log(false, { error: invalid });
    return NextResponse.json(
      { ok: false, error: invalid, spec } satisfies WonderResponse,
      { status: 400 },
    );
  }

  const key = cacheKey(spec);
  const cached = cacheGet<WonderResponse>(key);
  if (cached) {
    recordCacheHit();
    log(true, { cached: true });
    return NextResponse.json(cached);
  }

  let pending = inflight.get(key);
  const shared = Boolean(pending);
  if (!pending) {
    pending = execute(spec, key).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const { outcome: result, revisions } = await pending;

  if (!result.ok) {
    log(false, { error: result.error, detail: result.detail });
    return NextResponse.json(
      { ok: false, error: result.error, spec } satisfies WonderResponse,
      { status: result.status },
    );
  }

  const payload: WonderResponse = { ok: true, table: result.table, spec };
  // The revision report goes on a copy: the cache holds `payload`'s twin by
  // reference, and "Revised since you last ran this" describes something that
  // happened on THIS fetch. Replaying it from cache for the next twelve hours
  // would make one revision look like several.
  const response: WonderResponse = revisions ? { ...payload, revisions } : payload;
  log(true, { cached: shared });
  return NextResponse.json(response);
}

/**
 * Fetch a spec from CDC, record what a provisional result looks like now, and
 * cache it. Runs once per distinct query however many requests are waiting.
 * Never rejects: a failure is an outcome, so that every waiter gets the same
 * answer rather than one of them an unhandled exception.
 */
async function execute(spec: QuerySpec, key: string) {
  let outcome: Outcome;
  try {
    // A composite is not a database: it is several, queried in turn and joined.
    const def = getDatabase(spec.database);
    outcome = def.composite
      ? await runComposite(spec, def.composite, fetchSourceTable)
      : await fetchTable(spec);
    if (!outcome.ok) return { outcome, revisions: null };

    // Only reached on a cache MISS, which is what we want: a cached result is
    // the same observation, not a new one.
    const revisions = def.provisional ? await observe(spec, outcome.table) : null;
    // Cached WITHOUT the revision report; see the note in POST.
    cacheSet(
      key,
      { ok: true, table: outcome.table, spec } satisfies WonderResponse,
      def.provisional ? PROVISIONAL_TTL_MS : FINAL_TTL_MS,
    );
    return { outcome, revisions };
  } catch (e) {
    // Reaching here means a bug in parsing or stitching, not a CDC failure.
    // Say so in the log, and give the visitor something better than a bare 500.
    console.error("[wonder] unexpected failure:", e);
    outcome = {
      ok: false,
      error: "This result could not be processed. The problem is on this site, not CDC's, and has been logged.",
      status: 500,
      detail: `internal: ${e instanceof Error ? e.message : String(e)}`,
    };
    return { outcome, revisions: null };
  }
}

/**
 * fetchTable for one part of a combined series, with a memory.
 *
 * A combined query is three or four CDC calls fifteen seconds apart, and most
 * of that is spent re-fetching the two FINAL files, whose answers have not
 * changed since the last time anyone asked. Each part is cached on its own
 * spec: when the combined result expires after twelve hours, only the
 * provisional part has to be fetched again, and a combined query that failed
 * part-way keeps the parts it already had.
 *
 * Nothing downstream changes a table it is handed (the stitcher copies), so
 * holding these by reference is safe.
 */
async function fetchSourceTable(spec: QuerySpec): Promise<Outcome> {
  const key = `source:${cacheKey(spec)}`;
  const cached = cacheGet<ResultTable>(key);
  if (cached) {
    recordCacheHit();
    return { ok: true, table: cached };
  }
  const outcome = await fetchTable(spec);
  if (outcome.ok) {
    cacheSet(
      key,
      outcome.table,
      getDatabase(spec.database).provisional ? PROVISIONAL_TTL_MS : FINAL_TTL_MS,
    );
  }
  return outcome;
}

/**
 * Run one spec against its own database and return the parsed table.
 *
 * Extracted so the composite series can call it once per source. The retry and
 * connection handling here was arrived at painfully, and must not be
 * duplicated.
 */
async function fetchTable(spec: QuerySpec): Promise<Outcome> {
  const xmlRequest = buildRequestXml(spec);
  let xml: string;
  try {
    const body = new URLSearchParams({
      request_xml: xmlRequest,
      accept_datause_restrictions: "true",
    });
    // A long-lived server reuses TCP connections (keep-alive). If CDC's edge
    // flags one, every subsequent request on it is denied instantly with 403 —
    // which is why a fresh process works while the service keeps failing.
    // `Connection: close` forces a new connection per request, and a 403 is
    // retried (rather than surfaced) so a single poisoned connection can't
    // break the app.
    //
    // The User-Agent names this site. Node's default, the bare string "node",
    // is refused by CDC's edge outright (lib/wonder/userAgent.ts has the
    // measurements). We still do NOT claim to be a browser: saying what the
    // client is is honest, and claiming to be Chrome without a browser TLS
    // fingerprint is itself a bot-detection trigger.
    const doFetch = () =>
      fetch(wonderUrl(getDatabase(spec.database).id), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/xml, text/html, */*",
          Connection: "close",
          "User-Agent": wonderUserAgent(),
        },
        body: body.toString(),
        // WONDER can be slow for big cross-tabs: the provisional file grouped
        // by single year of age took 76 s when measured (2026-11-11), which a
        // 55 s limit turned into a failure every time. The tunnel gives up on
        // the visitor's connection at 100 s, but the server does not stop when
        // it does. It finishes and caches the result, so their next attempt
        // loads at once. A limit shorter than CDC's worst case means there is
        // nothing to load.
        signal: AbortSignal.timeout(90_000),
      });

    let res = await throttle.run(doFetch);
    for (let attempt = 0; attempt < 2 && res.status === 403; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      res = await throttle.run(doFetch);
    }

    xml = decodeBody(await res.arrayBuffer(), res.headers.get("content-type"));
    if (!res.ok) {
      // The raw status and CDC's own text go to /api/health, the usage log and
      // the server console; the visitor gets wording that makes clear whose
      // problem it is.
      const cdcText = extractError(xml);
      const detail = `HTTP ${res.status}: ${cdcText ?? "(no detail)"}`;
      console.warn(`[wonder] ${spec.database} ${detail}`);
      // CDC answers a query it will not run with a 500 and an explanation.
      // That is a refusal of this query, not an outage, and counting it as one
      // would turn the health check red over something a visitor typed.
      if (isQueryRejection(res.status, cdcText)) recordCdcSuccess();
      else recordCdcFailure(detail);
      return {
        ok: false,
        error: cdcHttpErrorMessage(res.status, cdcText),
        status: 502,
        detail,
      };
    }
  } catch (e) {
    if (e instanceof QueueFullError) {
      // Never reached CDC, so it says nothing about CDC's health.
      return { ok: false, error: cdcBusyMessage(), status: 503, detail: "queue full" };
    }
    const msg = e instanceof Error ? e.message : String(e);
    const detail = `unreachable: ${msg}`;
    console.warn(`[wonder] ${spec.database} ${detail}`);
    recordCdcFailure(detail);
    return { ok: false, error: cdcNetworkErrorMessage(e), status: 502, detail };
  }

  const wonderError = extractError(xml);
  if (wonderError) {
    // WONDER answered, so the connection and IP are fine — this is a rejected
    // query, not an outage. Recorded as a success for health purposes so a
    // malformed query cannot make the site look down.
    recordCdcSuccess();
    return {
      ok: false,
      error: `CDC WONDER: ${wonderError}`,
      status: 502,
      detail: `HTTP 200: ${wonderError}`,
    };
  }

  recordCdcSuccess();
  return { ok: true, table: parseResponse(xml, spec) };
}
