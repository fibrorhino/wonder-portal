#!/usr/bin/env node
// Summarise the usage log written by lib/queryLog.ts.
//
//   node tools/query-report.mjs                 last 30 days
//   node tools/query-report.mjs --days 7        last 7 days
//   node tools/query-report.mjs --days 0        everything
//   node tools/query-report.mjs --ips           include the per-IP breakdown
//
// Reads logs/queries.jsonl plus its rotated siblings (.1 .. .3).

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const argv = process.argv.slice(2);
const days = argv.includes("--days") ? Number(argv[argv.indexOf("--days") + 1]) : 30;
const showIps = argv.includes("--ips");

const root = path.resolve(import.meta.dirname, "..");
const files = [
  path.join(root, "logs", "queries.jsonl"),
  ...[1, 2, 3].map((n) => path.join(root, "logs", `queries.jsonl.${n}`)),
];

const rows = [];
let unreadable = 0;
for (const file of files) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    continue; // file may not exist
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      unreadable++; // a torn final line during rotation, say
    }
  }
}

if (rows.length === 0) {
  console.log("No usage logged yet (logs/queries.jsonl is empty or missing).");
  process.exit(0);
}

const cutoff = days > 0 ? Date.now() - days * 86400_000 : 0;
const inRange = rows.filter((r) => Date.parse(r.at) >= cutoff);

if (inRange.length === 0) {
  console.log(`No activity in the last ${days} days (${rows.length} older entries on file).`);
  process.exit(0);
}

const count = (items) => {
  const m = new Map();
  for (const i of items) if (i != null && i !== "") m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const bar = (n, max, width = 28) =>
  "█".repeat(Math.max(1, Math.round((n / max) * width)));

function section(title, pairs, limit = 10) {
  console.log(`\n${title}`);
  if (pairs.length === 0) {
    console.log("  (none)");
    return;
  }
  const top = pairs.slice(0, limit);
  const max = top[0][1];
  const pad = Math.max(...top.map(([k]) => String(k).length));
  for (const [k, n] of top) {
    console.log(`  ${String(k).padEnd(pad)}  ${String(n).padStart(5)}  ${bar(n, max)}`);
  }
  if (pairs.length > limit) console.log(`  … and ${pairs.length - limit} more`);
}

const queries = inRange.filter((r) => r.kind === "query");
const nl = inRange.filter((r) => r.kind === "nl");
const ok = inRange.filter((r) => r.ok);
const cached = queries.filter((r) => r.cached);
const uniqueIps = new Set(inRange.map((r) => r.ip).filter((v) => v && v !== "unknown"));
const times = queries.filter((r) => !r.cached && typeof r.ms === "number").map((r) => r.ms).sort((a, b) => a - b);
const median = times.length ? times[Math.floor(times.length / 2)] : null;

console.log("=".repeat(60));
console.log(`Wonderwall usage — ${days > 0 ? `last ${days} days` : "all time"}`);
console.log("=".repeat(60));
console.log(`  Total requests     ${inRange.length}`);
console.log(`    WONDER queries   ${queries.length}   (${cached.length} served from cache)`);
console.log(`    NL box prompts   ${nl.length}`);
console.log(`  Succeeded          ${ok.length}  (${((ok.length / inRange.length) * 100).toFixed(1)}%)`);
console.log(`  Unique IPs         ${uniqueIps.size}`);
if (median !== null) console.log(`  Median CDC time    ${(median / 1000).toFixed(1)}s`);
if (unreadable) console.log(`  (skipped ${unreadable} unparseable line(s))`);

// --- activity by day ---
const byDay = count(inRange.map((r) => r.at.slice(0, 10)));
section("Activity by day", byDay.sort((a, b) => a[0].localeCompare(b[0])), 40);

// --- who and where ---
section("Countries", count(inRange.map((r) => r.country)));
section("Devices", count(inRange.map((r) => r.device)));
section("Browsers", count(inRange.map((r) => r.browser)));
section("Operating systems", count(inRange.map((r) => r.os)));
section("Referrers", count(inRange.map((r) => r.referrer).filter(Boolean)));
if (showIps) section("IP addresses", count(inRange.map((r) => r.ip)), 25);

// --- what they asked for ---
section("Grouped by (individual fields)", count(queries.flatMap((r) => r.groupBy ?? [])));
section("Grouping combinations", count(queries.map((r) => (r.groupBy ?? []).join(" + ")).filter(Boolean)));
section("Measures requested", count(queries.flatMap((r) => r.measures ?? [])));
section("Filtered on (fields)", count(queries.flatMap((r) => Object.keys(r.filters ?? {}))));

const causeValues = queries.flatMap((r) =>
  Object.entries(r.filters ?? {})
    .filter(([k]) => ["injuryIntent", "injuryMechanism", "leadingCauses", "ucdCause"].includes(k))
    .flatMap(([k, v]) => (v ?? []).map((code) => `${k}=${code}`)),
);
section("Cause-of-death selections", count(causeValues));

const errors = inRange.filter((r) => !r.ok && r.error);
// Validation messages can be long; truncate so the bars stay readable.
section("Errors", count(errors.map((r) => (r.error.length > 64 ? r.error.slice(0, 61) + "…" : r.error))));

if (nl.length > 0) {
  console.log("\nMost recent natural-language prompts");
  for (const r of nl.slice(-15).reverse()) {
    console.log(`  ${r.at.slice(0, 16).replace("T", " ")}  ${r.ok ? "ok " : "ERR"}  ${JSON.stringify(r.text)}`);
  }
}

console.log("");
