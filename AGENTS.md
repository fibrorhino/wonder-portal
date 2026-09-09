<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Mortality Data Portal — agent handoff

A query, analysis and visualisation front end for CDC mortality data, run by the
Johns Hopkins Center for Suicide Prevention. Next.js 16.2.9 (App Router,
Turbopack), React 19, Tailwind v4, TypeScript.

**Repo:** `C:\dev\wonderwall` → `github.com/fibrorhino/wonder-portal` (branch `main`).
**Live:** `mortality.nestadt.org` and `wonderwall.nestadt.org`, both served by a
Windows service on this machine through a Cloudflare tunnel. Not Vercel — see
*CDC blocks data-center IPs* below.

`README.md` explains **why** the code is the way it is, at length, and is the
reference when you need the reasoning. This file is the operational layer: what
to run, what will bite you, and what not to touch. Read both before changing
anything in `lib/wonder/` or `lib/analysis/`.

---

## Commands

| | |
|---|---|
| `npm test` | Compiles `tsconfig.test.json` → `.test-out`, runs Node's built-in runner. ~175 tests, <1s. Run after **any** change under `lib/`. |
| `npx tsc --noEmit` | Typecheck the app. |
| `npx eslint app components lib` | Lint. |
| `NEXT_DIST_DIR=.next-validate npx next build` | **Compile check that does not touch the live build.** Use this to verify; delete `.next-validate` after. |
| `npm run build` | **The deploy build. Overwrites the `.next` the live service is serving.** Only when you intend to ship. |
| `npm run dev` | Dev server on :3000, writes to `.next-dev`. |

Verify with all four (test, tsc, eslint, sandboxed build) before claiming
anything works. Do not report success without running them.

---

## Hard rules

1. **Never `npm run build` to "check if it compiles."** It replaces the build the
   live site is serving, mid-flight. Use `NEXT_DIST_DIR=.next-validate`.
2. **Never remove the `distDir` split** in `next.config.ts`. Dev writes to
   `.next-dev` because dev and production share one working copy; sharing one
   build directory makes every `/api/*` route 404 on the live site.
3. **Never edit `lib/wonder/d158Snapshot.test.ts` expectations to make a test
   pass.** It pins the exact bytes D158 puts on the wire. Needing to change it
   means stop and re-verify against the live API. It has been changed once,
   deliberately, with a dated comment.
4. **A new file under `lib/` that tests import must be added to
   `tsconfig.test.json` `include`** — both the module and its `.test.ts`. The
   test build has **no `@/` path alias**, so anything the tests reach must use
   relative imports.
5. **Never present a computed figure as a CDC-published one.** `sourceNotes` is
   deliberately separate from `caveats` (which are CDC's own words). The
   age-adjusted rates for 2025+ are computed here; every surface that shows them
   says so.
6. **Never commit `logs/`** (gitignored). It holds real visitor IPs and the
   revision history the live service is writing.
7. **Don't add geography.** It is blocked at CDC's API, not by this code. See below.

---

## The data layer

Four entries in the dataset dropdown; `lib/wonder/db/registry.ts` is the index.

| id | Years | Grammar | Notes |
|---|---|---|---|
| `D158` | 2018–2024 | expanded | Final file. The default. Race 6/15/31, weekday, education, autopsy. |
| `D176` | 2018–present | expanded | Provisional. **No age-adjusted rate** (`M_4` absent). Requires `O_PR: "false"`. |
| `D76` | 1999–2020 | **classic** | No `dataset_code`/`dataset_label`/`saved_id`/`O_dates`/`O_race`. **Bridged** race, keyed `raceBridged`, not `race6`. |
| `COMBINED` | 1999–present | n/a | Not a database. A **composite**: one query becomes one per source, joined. |

**Every WONDER database is a separate API** with its own parameter numbering and
no documentation. D176 rejects a reconstructed request with HTTP 500 until ~50
scaffolding parameters are present, so it carries a captured template
(`lib/wonder/data/d176_base.json`, 129 params) that the builder seeds from.
Adding a fifth dataset is a session of probing, not an afternoon.

### CDC's constraints, all enforced in `app/api/wonder/route.ts`

- **≥15 seconds between requests**, or 429. A composite query is 3–4 requests in
  series: ~48s. `maxDuration` is 300; the Cloudflare tunnel gives up at 100s,
  which caps how many sources a composite can have.
- **Data-center IPs get 403.** This is why the app is self-hosted behind a
  tunnel rather than on Vercel. Do not "simplify" the deployment.
- **Counts of 1–9 are suppressed**; rates from <20 deaths are flagged unreliable.
- **No sub-national data, at all.** Grouping by state returns HTTP 500: *"Only
  national data are available for this dataset when using the WONDER web
  service… does not group results by region, division, state, county or
  urbanization."* This also rules out urbanisation. The scaffolding for those
  variables is already in every request and makes no difference. Verified
  2026-09-09. State data exists on `data.cdc.gov` (Socrata) as a **separate
  source** — scoped, not built.
- **The API returns no citation.** `lib/methods.ts` reconstructs it.

### The composite (`COMBINED`)

`lib/wonder/composite.ts` + `lib/wonder/stitch.ts`. Cut points: D76 1999–2017,
D158 2018–2024, D176 2025+. The overlap is the evidence this is sound — D76 and
D158 both cover 2018–2020 and return *identical* deaths, population and
age-adjusted rates. Later vintages win.

Two things are given up: **race** (D76's bridged categories are not the newer
single-race ones — collapsing them understates AI/AN by 13.3% and Asian/PI by
9.5%, measured on the overlap), and **published age-adjusted rates past 2024**,
which `lib/stats/ageAdjust.ts` computes by direct standardisation to the 2000 US
standard population. Validated against years CDC does publish: agrees within
0.02 per 100,000. An age group **absent** from the strata counts as zero deaths,
not missing data.

---

## The analysis pipeline

```
table → buildFactSheet()   exact figures, computed here, no model
      → renderFactSheet()  the same figures as text
      → Gemini             writes prose using ONLY those figures
      → verifyStatements() every number checked back; unaccountable ones dropped
```

**The model never supplies a statistic.** If you change `lib/analysis/facts.ts`,
you change what the model is allowed to say. Keep it that way.

Gemini model IDs get retired without notice, so `app/api/insights/route.ts`
holds a fallback chain (`gemini-3.5-flash-lite` → `gemini-2.5-flash-lite` →
`gemini-3.6-flash`). Free-tier limits are per-model, so a 429 falls through to
the next id when the quota body says the violated quota is `PerModel`.
`lib/geminiQuota.ts` parses that body — Google no longer publishes the numbers,
so the 429 log line is the only authoritative record of which limit was hit.

---

## Traps that have already cost a session each

- **Partial periods contaminate comparisons.** A two-month year has a low rate
  because the year is young. This has bitten twice: once in year-to-date, once
  when the fact sheet ranked 2026 as the "lowest rate" and reported a 6.07×
  disparity as statistically significant. Every figure is real, so the verifier
  passes it. `isPartialPeriod()` exists — use it in any new comparison.
- **Crude and age-adjusted figures mix silently.** Both are real numbers, so
  verification cannot catch a rate from one line paired with a ratio from the
  other. Label the measure on every figure in the fact sheet.
- **Plotly infers axis type.** Non-numeric category labels ("2026 (provisional
  and partial)") get dropped from a linear axis with no error. `lib/chartAxes.ts`
  declares the type. Checking `gd.data` is not enough — check the rendered axis.
- **Year labels carry annotations.** Fine on an axis, unreadable mid-sentence.
  Strip `\s*\(.*\)\s*$` for prose, keep it for display.
- **A `Response` body can only be read once.** Read it where you branch, carry
  the text forward.
- **`cacheSet` stores by reference.** Mutating the object afterwards mutates the
  cached copy.
- **`describeFilters()` returns a sentence** ("All deaths, all years (no filters
  applied)"), not `""`, when nothing is filtered. Use `filterChips().length`.
- **`<dialog>` inside `<p>`** breaks hydration; portal it to `document.body`.
- **Windows shell heredocs mangle backslashes** — `\b` becomes 0x08, `\n` a real
  newline, and a NUL byte once landed in a source file this way. Use the file
  editing tools for anything containing regexes or escapes, not shell heredocs.

## Testing

Node's built-in runner, no framework. Tests must be able to **fail** — if you
add one, confirm it fails without the fix. Characterisation tests are the
pattern for external formats (WONDER's XML, Gemini's 429 body): capture a real
payload, assert the parse. `lib/wonder/composite.test.ts` drives the whole
composite path against a stub fetcher so none of it costs a CDC call.

---

## Deploy

```bash
npm test && npx tsc --noEmit && npx eslint app components lib
npm run build
net stop WonderPortal && net start WonderPortal
```

The user runs the restart. Two WinSW services, both working from `C:\dev\wonderwall`:

- **`WonderPortal`** — `next start -p 3000`.
- **`WonderTunnel`** — `cloudflared` with `tools/config.yml`, tunnel `wonder-portal`.

Health: `https://mortality.nestadt.org/api/health` (CDC status, call counts,
uptime). Logs in `logs/`: `queries.jsonl` (usage, real IPs via Cloudflare
headers), `revisions.jsonl` (provisional revision history — append-only,
production data, do not seed with test values).

Env (`.env.local`): `GEMINI_API_KEY`, optional `GEMINI_MODEL` override, optional
`CF_ANALYTICS_TOKEN`.

---

## Open items

- **No per-visitor rate cap on `/api/insights`.** The Gemini quota is shared
  across all visitors; one person clicking repeatedly can exhaust it. The
  per-model fallback softens this but does not solve it. Billing on the key is
  the other half.
- **State-level geography** is scoped but unbuilt. Two Socrata datasets on
  `data.cdc.gov` carry it: `fpsi-y8tj` (state/county/tract, counts and **crude**
  rates, trailing-12-month window, suppressed rows arrive as count `"1-9"` with
  **rate `-999`** — a sentinel that plots as a huge negative bar) and
  `489q-934x` (VSRR quarterly, **age-adjusted**, per state). No API key needed.
  Would be its own route, never merged into a WONDER series. WISQARS has no
  public API.
- **No demographics at state level** in any of those files — geography and
  demographic detail are mutually exclusive in public CDC data.
