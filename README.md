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

## Datasets

A dropdown switches which CDC WONDER database the app queries. This is not a
filter: it changes which variables exist, which measures are available, and how
the numbers must be read, so switching rebuilds the query rather than carrying
the old one over.

| | `D158` Final | `D176` Provisional | `D76` Historical | `COMBINED` |
| --- | --- | --- | --- | --- |
| Years | 2018–2024 | 2018–present | **1999–2020** | **1999–present** |
| Grammar | expanded | expanded | **classic** | n/a (composite) |
| Age-adjusted rate | yes | **no** (`M_4` absent) | yes | yes, computed past 2024 |
| Race | single, 6/15/31 | single, 6/15 | **bridged, 4** | **none** |
| Weekday / autopsy | yes | no | yes | no |
| Education / 15-leading-causes | yes | no | no | no |

**Race does not carry across.** D76 uses the four *bridged* categories — deaths
recorded under multiple races assigned to one, and Asian merged with Pacific
Islander. The newer files use single-race categories and split those two. The
app therefore keys it `raceBridged`, not `race6`, so a spec written for one file
cannot silently run against the other, and cross-dataset comparison is refused.

**Two parameter dialects.** The classic grammar (`D76`) has no `dataset_code`,
`dataset_label`, `saved_id`, `O_dates` or `O_race` — race is a plain value
variable there rather than a selector, and the age-adjustment block crosses
`V8` where the newer files cross `V42`. `DatabaseDef.grammar` picks the dialect;
`registry.test.ts` asserts the classic request carries none of the modern
parameters and no other database's ids.

**Every WONDER database is a separate API.** The numbering differs, the required
parameters differ, and nothing is documented. D176 rejects a D158-shaped request
with *"Missing parameter O_PR"*, and rejects a reconstructed one with HTTP 500
until roughly fifty further scaffolding parameters are present — multiple-cause
and occurrence-geography variables the app does not even expose. So D176 carries
a **verified request template** (`lib/wonder/data/d176_base.json`) captured from
a working call, which the builder seeds from before applying group-by, measures
and filters over the top. Adding a third dataset means the same probing
exercise; expect it to take a session, not an afternoon.

`lib/wonder/db/registry.ts` **adapts** D158 from `lib/wonder/databases.ts`
rather than copying it. That module is the result of months of verification
against the live API and re-typing it would risk a silent transcription error in
exactly the values hardest to notice being wrong.

### The combined series

`COMBINED` is not a database. It is a **composite**: one query against it
becomes one query per source file, each asked only for the years it covers, and
the results are concatenated (`lib/wonder/composite.ts`, `lib/wonder/stitch.ts`).
Cut points are 1999–2017 from D76, 2018–2024 from D158, 2025 on from D176.

The overlap is what makes this defensible. D76 and D158 both cover 2018–2020,
and for those years they return **identical** deaths, population and
age-adjusted rates — so the join is not reconciling two estimates, it is
choosing which vintage to read a year from. The later, final file wins wherever
it has the year, since later vintages carry later corrections; provisional data
is used only where nothing final exists.

Two things are given up to get the span:

**Race is not offered at all.** D76's bridged categories are not the newer
files' single-race ones. Measured on the 2018–2020 overlap, where the same
141,834 suicides are coded both ways, simply collapsing the newer categories
understates American Indian or Alaska Native by 13.3% and Asian or Pacific
Islander by 9.5%. Hispanic origin *is* consistent across all three and is
available.

**Age-adjusted rates past 2024 are computed here, not published.** D176 does
not publish the measure, so `lib/stats/ageAdjust.ts` does it by direct
standardisation to the 2000 US standard population: the composite issues one
extra query with age added to the grouping and standardises over the strata.
Validated against the years CDC does publish, the method agrees to within 0.02
per 100,000 (2022: 14.240 computed vs 14.221 published; 2023: 14.131 vs 14.129;
2024: 13.737 vs 13.732 — the residual is WONDER rounding the age-specific rates
it standardises over). The 2024 case is pinned in `stitch.test.ts`.

An age group **absent** from the strata counts as zero deaths, not as missing
data. WONDER omits age groups with no records, so a suicide query returns
nothing at all for under-5s; rescaling by the range that came back would assume
infants die of suicide at the same rate as everyone else. Below 80% coverage of
the standard population no rate is returned at all, rather than a different
number wearing the name.

Because these figures are not CDC's, they are never presented as though they
were. `ResultTable.sourceNotes` is deliberately separate from `caveats` (which
are CDC's own words returned with the data), renders above them as *"How this
series was assembled"*, and is fed to the AI fact sheet so the narration cannot
cite a computed rate as a published one.

Cost: three or four sequential requests, spaced by CDC's own fifteen-second
minimum — about 35–50 seconds. The loading state says so, because otherwise it
reads as a hang. `lib/wonder/composite.test.ts` drives the whole path against a
stub fetcher, so year-slicing, the companion age query, the join and the notes
are checked on every run without spending a CDC call.

### Not breaking the working dataset

`lib/wonder/d158Snapshot.test.ts` pins the exact bytes D158 puts on the wire —
every parameter name, the group-by tokens, the `O_` selectors, the finder
scaffolding. It does not assert the request is *correct*; it asserts it is
*unchanged*. Needing to edit those expectations is a signal to stop and
re-verify against the live API, not to update the snapshot.

### Provisional data is dangerous by default

WONDER labels incomplete periods in the label itself — `2026 (provisional and
partial)`. That row is a fraction of a year sitting at the end of a series, and
a naive first-to-last trend reports it as a **36% decline**. The numeric
verifier cannot catch that: the figure is genuinely in the table. So:

- partial periods are excluded from every trend, per-series direction and
  largest-move figure, and both the bullets and the fact sheet say which period
  was left out and why;
- a period whose population is identical to the previous one is flagged, because
  CDC carries the last estimate forward rather than publishing a new one, so any
  rate for it has a stale denominator;
- comparing a provisional result against a final one is **refused**, not warned
  about — the overlap differs only by processing lag, and a difference table
  looks authoritative whatever caption sits above it;
- partial periods are drawn faded on charts and tagged "incomplete", because the
  shape of a line is what people actually read, not the caption.

### Year-to-date is how you use the current year

The months a partial year *does* cover can be compared with the same months of
earlier years, which is what NCHS itself publishes. A **Compare year-to-date**
button re-runs the query grouped by year and month and the analysis then reports
that comparison.

**Trailing incomplete months are dropped from every year in it, and how many is
decided by the data.** Each month of the partial year is compared with the same
month a year earlier; months falling below 80% of that level have not finished
being processed. Assuming "the last month is incomplete" is not enough, because
the lag depends entirely on what you are counting:

| | lag |
| --- | --- |
| All-cause deaths | about one month |
| **Suicide** | **about six months** — manner of death needs a coroner's ruling |

In the data this was written against, provisional 2026 suicide counts ran at 95%
of the previous year in January and February, **21% in March, and were absent
from April onward**. Dropping only the newest month there would have compared
seven months against seven and reported a ~70% collapse in suicides. The rule
compares Jan–Jul for all-cause and Jan–Feb for suicide, from the same dataset,
automatically. When nothing survives, no year-to-date figure is offered at all.

For all-cause deaths the four ways to state the current year:

| | change |
| --- | --- |
| Naive full year (8 months vs 12) | −36.3% — nonsense |
| Annualised ×12/8 | −4.5% — *plausible and wrong*: deaths peak in winter, and the last month is short |
| Jan–Aug vs Jan–Aug | −5.3% — honest, but dented by August |
| **Jan–Jul vs Jan–Jul** | **−2.9% — what the app reports** |

A year missing any of the compared months is excluded from the comparison
entirely, rather than appearing low because a month is absent.

The button is explicit rather than a background fetch: it is a second CDC call,
and CDC enforces 15 seconds between them.

### Chart axis types are declared, not inferred

`lib/chartAxes.ts` decides the Plotly axis type, and it is unit-tested because
getting it wrong loses data with no error anywhere. Left undefined, Plotly
infers the type from the values — and a list of year labels looks numeric, so it
picks `linear` and then **silently drops every label that does not parse as a
number**. On the provisional dataset that removed `2025 (provisional)` and
`2026 (provisional and partial)` from every trend chart while 2018–2024 stayed:
the points were in the trace, the axis simply would not plot them.

Category labels therefore get an explicit `type: "category"` everywhere except
scatter and bubble, which plot a genuine number on x, and horizontal bars, which
swap the roles of the two axes.

### Trend lines and joinpoint

A **Trend line** control appears whenever the x axis is ordered (year, month,
age). Both options fit on **ln(y)**, so the slope is an *annual percent change*
rather than a constant number of deaths per year, which is how mortality trends
are reported. Incomplete periods are excluded from the fit.

- **Linear** — one slope across the whole span.
- **Joinpoint** — a continuous piecewise-linear fit that finds where the trend
  turned, choosing the number of bends by BIC so a straight series is not given
  one it has not earned. Each segment reports its own APC, plus an overall AAPC.

On US all-cause deaths 2018–2024 the difference is the point of the feature:

| | fit |
| --- | --- |
| Linear | up 1.3%/yr, **r² = 0.13** |
| Joinpoint | 2018–2021 up 7.5%/yr, then 2021–2024 down 4.5%/yr, **r² = 0.84** |

It locates the 2021 peak unaided. **This is not the NCI Joinpoint Regression
Program**: it selects the number of joinpoints by BIC rather than by that
program's permutation test, and gives no confidence interval on the location of
a turn. It describes where a trend bends; it is not a substitute for that
software in a publication, and the UI says so next to the control.

`lib/stats/joinpoint.ts` is unit-tested against series with a known APC and a
known bend.

### Uncertainty

Three things that were being asserted without it, now carry it.

- **Rate ratios** (`lib/stats/rates.ts`) get a Poisson confidence interval, built
  on the log scale because the ratio's distribution is skewed. "2.41 (95% CI
  2.36–2.54)" — and where the interval includes 1, both the bullets and the
  prompt forbid calling the difference real. A twofold gap on four deaths and
  one on four hundred previously read identically.
- **Annual percent change** carries an interval from the fitted slope's standard
  error, using a t quantile rather than 1.96 because these fits have single-digit
  degrees of freedom. A segment whose interval spans zero is labelled *not
  significant*. Note these treat the joinpoint locations as known rather than
  estimated, which makes them narrower than the NCI program's.
- **Error bars** plot the confidence interval WONDER already returns with every
  rate. The parser had always kept it and nothing ever drew it, so a rate built
  on nine deaths looked exactly as firm as one built on ninety thousand. Drawn
  only when every point in a series has one.

### Seasonality

For monthly data covering two or more years, `lib/stats/seasonality.ts` runs a
classical multiplicative decomposition: a centred 12-month moving average as
trend, the ratio to it taken by calendar month, normalised to average 1.

Two details that matter. Counts are corrected for **month length** first —
February is nearly 10% shorter than January, which otherwise appears as a
seasonal dip that is purely calendar. And the index for each month is the
**median** across years, not the mean, so one pandemic April cannot redefine
April.

On US suicide deaths 2015–2020 it recovers the documented pattern: a peak in
June–August and a trough in November–December — the opposite of the common
belief about the holidays, and invisible in a raw monthly chart because the
seasonal swing is larger than the trend beneath it.

**To see it:** run the *Suicide seasonality* example, or group any query by Year
and Month over two or more years, then open the **Stats** tab — a *Seasonality*
mode appears, and is selected by default when the data supports it, showing the
twelve monthly indices with a bar centred on the yearly average. It also gets a
sentence in the talking points.

### Rate precision

`O_precision` is sent as **3**, not WONDER's default of 1. At one decimal place
every rate below 0.05 comes back as `"0.0"`, so rare causes — and every
cause-specific rate in a partial period — arrived as a literal zero and plotted
flat on the axis as though nothing had happened. Suicide by drowning in 2026
reads 0.016 rather than 0.0. Changing this altered the D158 wire request, which
is why `d158Snapshot.test.ts` carries a dated note explaining the change: that
test failing is meant to stop you, and the answer was to re-verify against the
live API, which was done for both databases.

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
