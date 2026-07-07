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
  // WONDER's cause-of-death section is a single radio (O_ucd): only one cause
  // framework (ICD codes | injury intent/mechanism | leading causes) may be
  // used per query, whether for grouping or filtering.
  const usedKeys = [
    ...spec.groupBy,
    ...Object.entries(spec.filters ?? {})
      .filter(([, v]) => v && v.length > 0)
      .map(([k]) => k),
  ];
  const ucdValues = new Set(
    usedKeys
      .map((k) => VARIABLE_BY_KEY[k]?.control)
      .filter((c) => c?.param === "O_ucd")
      .map((c) => c!.value),
  );
  if (ucdValues.size > 1) {
    return (
      "Only one cause-of-death framework can be used per query: choose ICD-10 codes, " +
      "injury intent/mechanism, OR leading causes — not a mix. Run separate queries instead."
    );
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
  if (cached) return NextResponse.json(cached);

  const xmlRequest = buildRequestXml(spec);
  let xml: string;
  try {
    const body = new URLSearchParams({
      request_xml: xmlRequest,
      accept_datause_restrictions: "true",
    });
    const res = await throttled(() =>
      fetch(WONDER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Present as a real browser — CDC's edge/WAF can 403 bare requests.
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Origin: "https://wonder.cdc.gov",
          Referer: "https://wonder.cdc.gov/ucd-icd10-expanded.html",
        },
        body: body.toString(),
        // WONDER can be slow for big cross-tabs.
        signal: AbortSignal.timeout(55_000),
      }),
    );
    xml = await res.text();
    if (!res.ok) {
      const detail = extractError(xml) ?? `HTTP ${res.status}`;
      const blocked =
        res.status === 403
          ? " CDC may be blocking requests from this server's IP (common for cloud hosts). Try running the app locally."
          : "";
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
    return NextResponse.json(
      { ok: false, error: `CDC WONDER: ${wonderError}`, spec } satisfies WonderResponse,
      { status: 502 },
    );
  }

  const table = parseResponse(xml, spec);
  const payload: WonderResponse = { ok: true, table, spec };
  cacheSet(key, payload);
  return NextResponse.json(payload);
}
