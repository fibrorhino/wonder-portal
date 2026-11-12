<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Mortality Data Portal — agent handoff

A query, analysis and visualisation front end for CDC mortality data, run by the
Johns Hopkins Center for Suicide Prevention. Next.js 16.4.6 (App Router,
Turbopack), React 19, Tailwind v4, TypeScript.

**Repo:** `C:\dev\wonderwall` → `github.com/fibrorhino/wonder-portal` (branch `main`).
**Live:** `mortality.nestadt.org` and `wonderwall.nestadt.org`, both served by a
Windows service on this machine through a Cloudflare tunnel. Not Vercel — see
*CDC blocks data-center IPs* below.

There **is** a Vercel project linked to this repo, and it is easy to mistake for
the live site. It builds every push (`main` as "production" at
`wonder-portal-bice.vercel.app`, every other branch as a preview), all of it
behind Vercel login, none of it attached to the public hostnames. Pages render
there; CDC queries do not (403). It is useful as a build check and nothing else.
Merging to `main` therefore changes nothing a visitor sees until someone deploys
on the desktop.

`README.md` explains **why** the code is the way it is, at length, and is the
reference when you need the reasoning. This file is the operational layer: what
to run, what will bite you, and what not to touch. Read both before changing
anything in `lib/wonder/` or `lib/analysis/`.

---

## Commands

| | |
|---|---|
| `npm test` | Compiles `tsconfig.test.json` → `.test-out`, runs Node's built-in runner. ~240 tests, <1s. Run after **any** change under `lib/`. |
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

- **Results are cached in memory**: a week for the final files, twelve hours
  for anything provisional (`lib/cache.ts`). The parts of a combined query are
  cached separately, so a repeat only re-fetches the provisional part.
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
- **Node's default User-Agent is refused.** `fetch` sends `User-Agent: node`,
  and CDC's edge answers that string with 403. Measured 2026-11-11 from one
  cloud address, same request, seconds apart: curl 200; curl with
  `User-Agent: node` 403; Node `fetch` default 403; Node `fetch` with a named
  product token 200. `lib/wonder/userAgent.ts` sets one (`WONDER_USER_AGENT`
  overrides it). **Vercel is refused regardless:** on 2026-11-12 a preview
  build carrying the named User-Agent ran one query from Vercel's `iad1` region
  and got 403 on all three attempts. So for Vercel the address is the problem
  and the hosting decision stands; the header only matters from addresses CDC
  otherwise accepts. Azure and AWS have not been re-tested. Do not go back to
  imitating a browser.
- **A 500 with a `<message>` is CDC refusing the query, not CDC being down.**
  It used to be shown as "temporarily unavailable, try again in a minute" and
  counted against `/api/health`. `isQueryRejection()` in `lib/wonder/cdcErrors.ts`
  tells the two apart. The message may or may not be wrapped in CDATA.
- **Age-adjusted rates are refused (500) in four cases**, all handled by
  `ageAdjustedBlocker()` in `lib/wonder/buildRequest.ts`, which the builder, the
  parser, the composite and the UI all consult: grouped by age; filtered on
  five-year or single-year ages; filtered to a single ten-year age group;
  grouped or filtered by the 15- or 31-group race classification. The last one
  comes back with deaths only, with no population or crude rate either.
- **The response says what it contains.** `<measure-selections-all>` lists the
  measure columns actually returned, and the parser reads it rather than
  assuming the request was honoured. `<caveat>` appears in two places: about
  forty *definitions* under `<dataset>` (each with a `<rule>`), and the handful
  that apply under `<response><caveats>`. Only the second is shown.
- **A year CDC has not loaded yet is refused** ("Invalid 'Year/Month' codes were
  found: '2027'"). The provisional file lags the calendar every January, and the
  composite names its years explicitly, so `lib/wonder/composite.ts` drops the
  refused years and asks once more.

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

Gemini model IDs get retired without notice, so `lib/geminiCall.ts` holds a
fallback chain (`gemini-3.5-flash-lite` → `gemini-2.5-flash-lite` →
`gemini-3.6-flash`) used by **both** `/api/insights` and `/api/nl`. Free-tier
limits are per-model, so a 429 falls through to the next id when the quota body
says the violated quota is `PerModel`.
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
- **CDATA must come off before tags are stripped.** `<![CDATA[` starts with
  `<`, so `/<[^>]+>/` eats everything up to the first `>`, which is the whole text when
  there is no markup inside. This silently emptied CDC's caveats and any error
  message CDC wrapped in CDATA.
- **Hand-built fixtures hide format bugs.** The caveat bug passed every test
  because the fixture had one tidy `<caveat>`. `lib/wonder/fixtures/` now holds
  real responses, trimmed but not edited. Do not tidy them.
- **A long request is not a failed one.** The tunnel drops the visitor at 100 s;
  the server carries on, finishes, and caches. Do not add a timeout shorter
  than CDC's worst case (76 s measured for the provisional file by single year
  of age). That turns "slow, then cached" into "fails every time".
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

On the desktop, after the change is on `main`: run **`tools\deploy.bat`**. It
asks for an Administrator window, then pulls, stops the app, runs `npm install`
and `npm run build`, starts the app and checks it answers. The app is stopped
for the build on purpose (two or three minutes): the build rewrites the folder
the running app reads, and a dependency upgrade replaces Next.js underneath it.
It was written without a Windows machine to run it on; the first run is its
test. By hand, the same thing is:

```bash
npm test && npx tsc --noEmit && npx eslint app components lib
git pull && npm install && npm run build
net stop WonderPortal && net start WonderPortal
```

Nothing deploys itself, and the desktop cannot be reached from a cloud session.
The user runs the deploy. Two WinSW services, both working from `C:\dev\wonderwall`:

- **`WonderPortal`** — `next start -p 3000`.
- **`WonderTunnel`** — `cloudflared` with `tools/config.yml`, tunnel `wonder-portal`.

Health: `https://mortality.nestadt.org/api/health` (CDC status, call counts,
uptime, and `recentFailures`: the raw status and CDC's own text for the last
five failures. Read that first when queries fail; it distinguishes a 403 from a
timeout from a refused query). The same raw text is the `detail` field in
`queries.jsonl`; `error` there is only what the visitor was shown.

Logs in `logs/`: `queries.jsonl` (usage, real IPs via Cloudflare headers),
`revisions.jsonl` (provisional revision history — append-only,
production data, do not seed with test values).

Env (`.env.local`): `GEMINI_API_KEY`, optional `GEMINI_MODEL` override, optional
`WONDER_USER_AGENT`, optional `CF_ANALYTICS_TOKEN`.

---

## Open items

- **The Gemini quota is still one shared free-tier allowance.** A per-address
  cap (`lib/rateLimit.ts`: 30 analyses per ten minutes and 150 a day; 40 and
  200 for the plain-English box) stops one visitor draining it, but enough
  visitors together still can. Billing on the key is the other half.
- **Deploys need a person at the desktop.** A scheduled task that polls `main`
  and runs `tools\deploy.ps1` would remove that, at the price of giving anyone
  who can push to `main` code execution on that machine. Not built; a decision
  for the owner.
- **Next.js must be kept patched.** This is a public server on Windows, and the
  2026 advisories against Next 16 include unauthenticated remote code execution
  on exactly that. Upgraded 16.2.9 to 16.4.6 on 2026-11-12. Run `npm audit`
  when you are in here; what remains is `xlsx` (no fixed release on npm) and
  `image-size` inside `pptxgenjs`, both of which only run in the browser to
  write export files, plus build-time tooling.
- **Queries are held open for their whole duration.** A combined series is
  ~50 s alone and longer behind other people's queries; past 100 s the tunnel
  drops the visitor (the page now says the query is still running and to run it
  again). The request queue is bounded (`lib/wonder/throttle.ts`) so it cannot
  grow without limit, but the real fix is a job the page polls for, with a
  queue position, rather than one long request.
- **The cut points are hand-maintained.** When CDC adds final 2025 data to
  D158, `AVAILABLE_YEARS`, the labels that say "2018–2024", and
  `COMBINED_SOURCES` all need moving by hand.
- **State-level geography** is scoped but unbuilt. Two Socrata datasets on
  `data.cdc.gov` carry it: `fpsi-y8tj` (state/county/tract, counts and **crude**
  rates, trailing-12-month window, suppressed rows arrive as count `"1-9"` with
  **rate `-999`** — a sentinel that plots as a huge negative bar) and
  `489q-934x` (VSRR quarterly, **age-adjusted**, per state). No API key needed.
  Would be its own route, never merged into a WONDER series. WISQARS has no
  public API.
- **No demographics at state level** in any of those files — geography and
  demographic detail are mutually exclusive in public CDC data.
