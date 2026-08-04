// POST /api/wonder — the only WONDER-facing endpoint. Accepts a QuerySpec,
// builds the request_xml, POSTs it to CDC WONDER server-side (avoids CORS and
// keeps one place to handle CDC IP-blocking), parses the XML, and returns a
// normalized ResultTable.

import { NextRequest, NextResponse } from "next/server";
import type { QuerySpec, WonderResponse } from "@/lib/wonder/types";
import { DATABASE_ID, VARIABLE_BY_KEY } from "@/lib/wonder/databases";
import { buildRequestXml } from "@/lib/wonder/buildRequest";
import { extractError, parseResponse } from "@/lib/wonder/parseResponse";
import { cacheGet, cacheKey, cacheSet } from "@/lib/cache";
import {
  recordCacheHit,
  recordCdcFailure,
  recordCdcSuccess,
} from "@/lib/wonderHealth";

const WONDER_URL = `https://wonder.cdc.gov/controller/datarequest/${DATABASE_ID}`;

export const runtime = "nodejs";
export const maxDuration = 60; // allow slow WONDER queries on Vercel

function validate(spec: QuerySpec): string | null {
  if (!spec || typeof spec !== "object") return "Missing query spec.";
  if (!Array.isArray(spec.groupBy) || spec.groupBy.length === 0)
    return "Select at least one 'Group results by' variable.";
  if (spec.groupBy.length > 5) return "At most 5 group-by variables.";
  for (const key of spec.groupBy) {
    const def = VARIABLE_BY_KEY[key];
    if (!def) return `Unknown variable: ${key}`;
    if (!def.canGroup) return `Cannot group by: ${def.label}`;
  }
  const ageGroups = spec.groupBy.filter((k) => k.startsWith("age"));
  if (ageGroups.length > 1) return "Only one age grouping at a time.";
  const raceGroups = spec.groupBy.filter((k) => k.startsWith("race"));
  if (raceGroups.length > 1) return "Only one race grouping at a time.";
  for (const key of Object.keys(spec.filters ?? {})) {
    if (!VARIABLE_BY_KEY[key]) return `Unknown filter variable: ${key}`;
  }
  // Several WONDER sections are a single radio: O_ucd selects WHICH cause
  // framework the query uses (ICD codes | injury intent/mechanism | leading
  // causes), O_age which age variable, O_race which race variable. Two
  // variables sharing a selector but needing different values cannot coexist
  // in one query — and that applies to FILTERS as much as to grouping.
  // Filtering on both Ten-Year and Five-Year age groups, for instance, used to
  // be accepted here and then resolved to whichever selector was written last,
  // so the query silently ran with one of the two age filters ignored.
  const usedKeys = [
    ...spec.groupBy,
    ...Object.entries(spec.filters ?? {})
      .filter(([, v]) => v && v.length > 0)
      .map(([k]) => k),
  ];
  const bySection = new Map<string, Map<string, string[]>>();
  for (const key of usedKeys) {
    const control = VARIABLE_BY_KEY[key]?.control;
    if (!control) continue;
    let byValue = bySection.get(control.param);
    if (!byValue) {
      byValue = new Map();
      bySection.set(control.param, byValue);
    }
    byValue.set(control.value, [
      ...(byValue.get(control.value) ?? []),
      VARIABLE_BY_KEY[key]?.label ?? key,
    ]);
  }

  if ((bySection.get("O_ucd")?.size ?? 0) > 1) {
    return (
      "Only one cause-of-death framework can be used per query: choose ICD-10 codes, " +
      "injury intent/mechanism, OR leading causes — not a mix. Run separate queries instead."
    );
  }
  const SECTION_LABEL: Record<string, string> = {
    O_age: "age variable",
    O_race: "race variable",
  };
  for (const [param, byValue] of bySection) {
    if (param === "O_ucd" || byValue.size <= 1) continue;
    const names = [...byValue.values()].flat().join(", ");
    return `Only one ${SECTION_LABEL[param] ?? param} can be used per query, whether grouping or filtering. Remove one of: ${names}.`;
  }
  return null;
}

// CDC requires >= 15 s between consecutive API requests. Serialize all outbound
// WONDER calls through a promise chain with enforced spacing. (Cache hits skip
// this entirely.)
const MIN_GAP_MS = 15_500;
let lastRequestAt = 0;
let queue: Promise<void> = Promise.resolve();

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function POST(req: NextRequest) {
  let spec: QuerySpec;
  try {
    spec = (await req.json()) as QuerySpec;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  spec.filters = spec.filters ?? {};
  spec.options = spec.options ?? {};

  const invalid = validate(spec);
  if (invalid) {
    return NextResponse.json(
      { ok: false, error: invalid, spec } satisfies WonderResponse,
      { status: 400 },
    );
  }

  const key = cacheKey(spec);
  const cached = cacheGet<WonderResponse>(key);
  if (cached) {
    recordCacheHit();
    return NextResponse.json(cached);
  }

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
    // break the app. We deliberately do NOT spoof a browser User-Agent: it
    // never helped, and claiming to be Chrome without a browser TLS
    // fingerprint is itself a bot-detection trigger.
    const doFetch = () =>
      fetch(WONDER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/xml, text/html, */*",
          Connection: "close",
        },
        body: body.toString(),
        // WONDER can be slow for big cross-tabs.
        signal: AbortSignal.timeout(55_000),
      });

    let res = await throttled(doFetch);
    for (let attempt = 0; attempt < 2 && res.status === 403; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      res = await throttled(doFetch);
    }

    xml = await res.text();
    if (!res.ok) {
      const detail = extractError(xml) ?? `HTTP ${res.status}`;
      const blocked =
        res.status === 403
          ? " CDC's edge is refusing requests from this server right now. This usually clears on its own; if it persists, restarting the app (which opens fresh connections) typically resolves it."
          : "";
      recordCdcFailure(`HTTP ${res.status}: ${detail}`);
      return NextResponse.json(
        {
          ok: false,
          error: `CDC WONDER rejected the query: ${detail}.${blocked}`,
          spec,
        } satisfies WonderResponse,
        { status: 502 },
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    recordCdcFailure(`unreachable: ${msg}`);
    return NextResponse.json(
      {
        ok: false,
        error: `Could not reach CDC WONDER: ${msg}`,
        spec,
      } satisfies WonderResponse,
      { status: 502 },
    );
  }

  const wonderError = extractError(xml);
  if (wonderError) {
    // WONDER answered, so the connection and IP are fine — this is a rejected
    // query, not an outage. Recorded as a success for health purposes so a
    // malformed query cannot make the site look down.
    recordCdcSuccess();
    return NextResponse.json(
      { ok: false, error: `CDC WONDER: ${wonderError}`, spec } satisfies WonderResponse,
      { status: 502 },
    );
  }

  recordCdcSuccess();

  const table = parseResponse(xml, spec);
  const payload: WonderResponse = { ok: true, table, spec };
  cacheSet(key, payload);
  return NextResponse.json(payload);
}
