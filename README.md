# Wonderwall

The **Mortality Data Portal** — a friendlier front-end for CDC WONDER data.
Query the *Underlying Cause of Death, 2018–2024, Single Race* database (API id
`D158`), inspect the data as a table/spreadsheet, build **customizable
figures**, run **basic statistics** (regression + r², chi-square, correlation),
and get a written **analysis of what is actually in the result** — things the
official WONDER portal can't do.

> **Naming.** The site is called the *Mortality Data Portal*, not a "WONDER
> portal": it is an independent tool and must not read as a CDC property. CDC
> WONDER is credited as the **data source** (subtitle, footer) and its Data Use
> Restrictions are linked from every control that runs a query — the `Ask` and
> `Run query` buttons carry an asterisk to that notice, mirroring the agreement
> the official portal makes you accept. Keep it that way.

A natural-language query box translates plain-English requests into queries
using the free-tier **Gemini API** — see [Enabling the natural-language
box](#enabling-the-natural-language-box) below. Everything it does can also be
done with the manual query builder.

---

## Quick start (local, for development)

> The live site is at **https://wonderwall.nestadt.org** — see
> [how it's hosted](#how-wonderwallnestadtorg-is-hosted) below. Run it locally to
> develop, or to use it from a machine whose IP CDC accepts (home or university).
> **Cloud hosts don't work**: CDC 403s requests from data-center IPs.

**Easiest:** double-click **`run-locally.bat`** (Windows). It installs deps the
first time, starts the server, and opens the browser.

**Or manually:**
```bash
npm install
npm run dev
```

Open http://localhost:3000. **No API key or account needed** for the core app.

### Try it
Click one of the **example queries** above the builder (e.g. *Suicide by sex and
race*) — each is a complete, runnable query. Then open the **Chart** and
**Stats** tabs, and press **✨ Analyze with AI** under the results.

- **🔗 Copy link** — every run puts the query in the URL fragment, so this gives
  a link that reopens *and re-runs* that exact query. Pasting one into a tab
  that already has the app open works too (the app listens for `hashchange`;
  its own navigation uses `replaceState`, which does not fire it).
- **📌 Pin to compare** — parks a result as *A*; run another query and a
  **Compare** tab appears diffing B against A. Rows are matched on their
  dimension-label tuple, so it only aligns when both queries grouped the same
  way; otherwise it compares totals and says why. Rates are never totalled.
- **Recent queries** — the last ten specs, in `localStorage` only. A spec can
  describe a narrow demographic slice and there is no reason for it to reach
  the server.

### Measures shown by default

Deaths, Population, Crude Rate **and Age-Adjusted Rate**. Age-adjustment is the
default because crude rates are not comparable across groups with different age
structures, which is most of the interesting comparisons; WONDER drops the
measure automatically when a query groups by age, where it has no meaning.
Population is requested because it is the denominator the insights engine needs
to rebuild marginal rates.

---

## Why local mode matters (CDC IP blocking)

CDC sometimes blocks requests coming from data-center / cloud IP ranges
(Vercel, AWS, Cloudflare, etc.). Because the WONDER call happens in a
server-side route, the app behaves differently depending on where that server
runs:

| Where you run it | Requests originate from | Result |
| --- | --- | --- |
| `npm run dev` / `npm start` on your computer | your home / university IP | works |
| An always-on desktop on the university network | university IP | works — **this is the live site** |
| Deployed to Vercel / Azure / any cloud host | data-center IP | **403, no data** |

Cloud hosting was tried and confirmed blocked. The same codebase works in every
case with zero changes — only the *machine it runs on* matters, because the
WONDER call happens in a server-side route.

---

## How `wonderwall.nestadt.org` is hosted

The live site runs on an always-on desktop on the university network, published
through a **Cloudflare Tunnel** (no inbound ports, free TLS). The tunnel handles
inbound traffic only; the CDC request goes out from that machine directly, which
is why the site can be public while CDC still sees an allowed IP.

**Full setup, deployment, watchdog and troubleshooting: [`docs/HOST-ON-JHU.md`](docs/HOST-ON-JHU.md).**

> Note: the 15-second CDC rate-limit spacing and the response cache are held in
> per-process memory, which is correct for the single always-on server used
> here. Running more than one instance would break the CDC pacing — see the
> comment in `app/api/wonder/route.ts`.

---

## Enabling the natural-language box

The box calls `/api/nl`, which uses the **Gemini API** (`gemini-2.5-flash-lite`)
to translate text into a `QuerySpec`. Gemini's free tier comfortably covers
personal/light use, so this typically costs nothing.

1. Get a free key at https://aistudio.google.com/apikey (sign in with any
   Google account — no billing setup required for the free tier).
2. Add it to `.env.local`:
   ```bash
   GEMINI_API_KEY=AIza...
   ```
3. Restart the dev server (or restart the `WonderPortal` service if
   self-hosted). The box lights up automatically once the key is present.

The interpreter is grounded on the real variable/value registry
(`lib/wonder/schemaContext.ts`) so it can only reference fields and codes that
actually exist in the D158 database — it can't invent a filter, and the result
is re-validated server-side against the same rules `/api/wonder` enforces
(e.g. only one cause-of-death framework per query) before being run.

The whole app is built around one typed contract — `QuerySpec`
(`lib/wonder/types.ts`) — which both the manual builder and the AI box
produce, so swapping the LLM provider later only touches `app/api/nl/route.ts`.

> Google retires Gemini model ids without notice (`gemini-2.5-flash` started
> returning 404 to new callers mid-2026). `app/api/insights/route.ts` therefore
> holds an ordered list of model ids and falls through to the next one on a 404
> rather than losing the feature. Set `GEMINI_MODEL` to prefer a different one
> without touching the code.

### Cost and quota

The analysis runs on **Flash-Lite** by default. The model is not doing the
arithmetic — every figure is supplied by the fact sheet and checked afterwards —
so the cheaper model with the higher free-tier quota is the right default, and
it answers in ~2 s rather than ~15 s.

Analyses are **cached for 24 hours on a hash of the fact sheet**, which is the
model's entire input. Identical input means an identical answer, so ten people
opening the same shared link cost one API call, not ten. The WONDER response
cache and this one are separate stores so a burst of one cannot evict the other.

At paid rates (~$0.30/M in, $2.50/M out) one analysis is about **$0.002**:
100 people running three each is well under a dollar. On the free tier, a 429
is surfaced as a plain "rate-limited, try again shortly" message and the
computed talking points — which need no API at all — carry on regardless.

## Talking points and the AI analysis

Under every result is a **Talking points** panel. It has two tiers, and both are
built on the same deterministic fact sheet:

1. **Computed bullets** (`lib/analysis/facts.ts` → `lib/insights.ts`) appear
   immediately, with no model involved. The fact sheet goes well past
   "biggest / smallest": marginal rates, category shares, per-series trends,
   count-vs-rate divergence, and observed-vs-expected cell ratios.
2. **✨ Analyze with AI** (`app/api/insights/route.ts`) sends that fact sheet —
   never a bare table — to Gemini, which decides what is worth saying and writes
   it up.

**The model never supplies a statistic.** Every number it writes back is checked
against the fact sheet by `lib/analysis/verify.ts` before the response leaves
the server: a figure must appear in the fact sheet, or be a ratio / difference /
percent change between two figures that do. A statement citing anything else is
dropped, the count of dropped statements is reported to the user, and the
dropped text is logged server-side so a bad prompt is visible. If nothing
survives, the computed bullets are returned instead.

### Age-adjusted rates in the fact sheet

An age-adjusted rate is a weighted sum over a standard age distribution, so —
unlike deaths — it cannot be re-derived by adding rows together. The fact sheet
therefore records one only when a category maps to exactly one row, and offers
the highest/lowest age-adjusted comparison only when *every* category has one.
The prompt tells the model to prefer that comparison over crude rates and to say
"age-adjusted" when it does.

### A note on population as a denominator

Population is a denominator, not a count, so `lib/analysis/facts.ts` only sums
it across dimensions that actually *split* the population (sex, age, race,
Hispanic origin — and year, where the sum is person-years, which is exactly what
a multi-year crude rate needs). Grouping by injury mechanism repeats the same
population on every row, so collapsing that dimension would inflate the
denominator by the number of mechanisms; in that case the rate is withheld
rather than computed wrongly. `lib/analysis/facts.test.ts` pins this down.

---

## How it works

```
app/
  page.tsx                 app shell (query builder | table | chart | stats tabs)
  api/wonder/route.ts      POST QuerySpec -> request_xml -> CDC WONDER -> ResultTable
  api/nl/route.ts          POST text -> QuerySpec via Gemini, re-validated server-side
  api/insights/route.ts    POST table -> fact sheet -> Gemini -> verified analysis
components/                QueryBuilder, ResultsTable, ChartPanel, StatsPanel,
                           ExampleQueries, RecentQueries, ComparePanel,
                           DataUseNotice, InsightsPanel, ...
lib/
  wonder/                  types, database registry, request builder, XML parser
    data/d158_variables.json   verified D158 variable + value-code metadata
    examples.ts            one-click starting queries
  analysis/                fact sheet (facts.ts), numeric verification (verify.ts),
                           two-query diff (compare.ts)
  stats/                   regression (r², p), correlation (Pearson/Spearman, chi-square)
  export/                  CSV + XLSX
  shareLink.ts             QuerySpec <-> URL fragment
  queryHistory.ts          recent queries (localStorage only)
  tableUtils.ts, cache.ts
```

## Tests

```bash
npm test
```

Compiles the pure-computation modules (`lib/stats`, `lib/wonder`,
`lib/analysis`) and runs them
under Node's built-in test runner — no test framework dependency. Covers the
distribution functions against published t / chi-square / F values, the
regression and ANOVA degenerate cases, the WONDER XML parser's row/column
alignment, the fact sheet's rate/denominator rules, the numeric verifier, and
the two-query comparison.
Run it after touching anything under `lib/`.

> Test modules are compiled to CommonJS without the `@/` path alias, so anything
> under `lib/` that the tests reach must use **relative** imports.

## Layout

The page is a two-column grid at `lg` and up (builder | results) and a single
column below it. On narrow screens the query builder is collapsible and folds
itself away once a result arrives, because the two cannot both be on screen.
The example and recent-query rows scroll horizontally rather than wrapping into
several rows. Wide content — tables, the comparison grid — scrolls inside its
own container; the page body never scrolls sideways.

## Development on the always-on host

`next dev` writes to **`.next-dev`**, not `.next` (see `next.config.ts`). The
production `.next` is being served by the `WonderPortal` service on the same
machine, and sharing one build directory let dev overwrite manifests the running
service reads — every API route started returning 404. Don't remove that split.

### Data notes / caveats
- **National data only.** WONDER's API blocks sub-national (state/county)
  breakdowns for privacy, so Wonderwall doesn't offer geographic grouping.
- **Aggregated counts, not records.** WONDER returns cross-tab counts, never
  individual decedents. Statistics are therefore computed on the aggregated
  cells (chi-square on count contingency tables; regression on group values with
  age-group midpoints), which is the correct approach for tabular count data.
- **Suppression / reliability.** Counts of 1–9 are suppressed and rates based on
  fewer than 20 deaths are flagged unreliable, per CDC policy. Both are surfaced
  in the table and preserved in exports.
- **One cause framework per query.** WONDER lets you use ICD-10 codes *or*
  injury intent/mechanism *or* leading causes — not a mix. The app enforces this.
- Always sanity-check numbers against the CDC portal before relying on them.

Not affiliated with, operated by, or endorsed by the CDC. Data © CDC/NCHS via
CDC WONDER, used under the [CDC WONDER Data Use
Restrictions](https://wonder.cdc.gov/datause.html).

### A note on the `xlsx` dependency
The `xlsx` (SheetJS) package carries an advisory about parsing malicious files.
Wonderwall only ever **writes** spreadsheets (export), never parses untrusted
input, so the advisory does not apply here.
