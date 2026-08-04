// GET /api/health — is the app up AND are CDC queries actually working?
//
// A check of the home page only proves the Next.js process is serving pages;
// the page renders perfectly while every WONDER query 403s. This reports the
// app's own view of CDC, based on the queries real users have already run (see
// lib/wonderHealth.ts — nothing here calls CDC).
//
// Point an uptime monitor at this URL:
//   - keyword monitor: alert when `"cdc":"ok"` is absent
//   - plain HTTP monitor: this returns 503 when queries are failing
//
// A quiet period reports "ok", not "unknown", so an idle night does not alert.

import { NextResponse } from "next/server";
import { healthSnapshot } from "@/lib/wonderHealth";

export const runtime = "nodejs";

export async function GET() {
  const snapshot = healthSnapshot();
  return NextResponse.json(snapshot, {
    status: snapshot.ok ? 200 : 503,
    // Never let a proxy or CDN serve a stale health answer.
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
