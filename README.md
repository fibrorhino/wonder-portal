# Wonderwall

A friendlier front-end for **CDC WONDER** — query the *Underlying Cause of
Death, 2018–2024, Single Race* database (API id `D158`), inspect the data as a
table/spreadsheet, build **customizable figures**, and run **basic statistics**
(regression + r², chi-square, correlation) — things the official WONDER portal
can't do.

A natural-language query box (LLM-interpreted) is scaffolded but **not enabled
yet**; everything it will eventually do can already be done with the manual
query builder.

---

## Quick start (local) — this is the way to use it for live data

> **CDC blocks the Vercel-hosted site's data queries** (it 403s requests from
> cloud/data-center IPs — confirmed on this deployment). The deployed site loads
> fine but can't fetch data. **Run it locally** and queries go from *your* IP,
> which works.

**Easiest:** double-click **`run-locally.bat`** (Windows). It installs deps the
first time, starts the server, and opens the browser.

**Or manually:**
```bash
npm install
npm run dev
```

Open http://localhost:3000. **No API key or account needed** for the core app.

### Try it
1. Click the **Suicide (intent)** cause preset.
2. Under **Group results by**, keep *Year* and add *Injury Mechanism (Method)*.
3. Click **Run query** → see the table, then open the **Chart** and **Stats** tabs.

---

## Why local mode matters (CDC IP blocking)

CDC sometimes blocks requests coming from data-center / cloud IP ranges
(Vercel, AWS, Cloudflare, etc.). Because the WONDER call happens in a
server-side route, the app behaves differently depending on where that server
runs:

| Where you run it | Requests originate from | CDC blocking risk |
| --- | --- | --- |
| `npm run dev` / `npm start` on your computer | your home / university IP | very low |
| Deployed to Vercel | Vercel's cloud IP | possible |

**The same codebase works both ways with zero changes.** Deploy to Vercel; if
CDC starts blocking it, just run it locally instead. If a query is blocked
server-side you'll get a clear error message suggesting local mode.

---

## Deploy to `wonderwall.nestadt.org` (Vercel + Cloudflare)

1. **Push to GitHub.** Create a repo and push this folder.
2. **Import into Vercel.** https://vercel.com/new → pick the repo → *Deploy*
   (Vercel auto-detects Next.js; no config needed).
3. **Add the custom domain.** In the Vercel project: *Settings → Domains* → add
   `wonderwall.nestadt.org`. Vercel shows a target value (usually
   `cname.vercel-dns.com`).
4. **Point Cloudflare at it.** In Cloudflare DNS for `nestadt.org`, add a
   `CNAME` record:
   - **Name:** `wonderwall`
   - **Target:** `cname.vercel-dns.com` (use the exact value Vercel gave you)
   - **Proxy status:** set to **DNS only** (grey cloud) at first. Cloudflare's
     orange-cloud proxy is another cloud IP in front of CDC — starting with DNS
     only keeps the request path closest to Vercel and simplifies debugging.
5. Wait for DNS + Vercel's TLS cert, then visit https://wonderwall.nestadt.org.

If the deployed site can query WONDER, you're done. If it gets blocked, fall
back to running locally (above).

> Note: the 15-second CDC rate-limit spacing and the response cache are held in
> per-instance memory. That's fine for personal / low-traffic use. For heavier
> shared use, move them to a shared store (e.g. Vercel KV).

---

## Enabling the natural-language box (later)

The box calls `/api/nl`, which is currently a stub. To turn it on you'll add an
Anthropic API key and implement the interpreter (translate text → `QuerySpec`):

```bash
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
```

The whole app is built around one typed contract — `QuerySpec`
(`lib/wonder/types.ts`) — which both the manual builder and the future LLM will
produce, so the interpreter drops in without touching the query/chart/stats code.

---

## How it works

```
app/
  page.tsx                 app shell (query builder | table | chart | stats tabs)
  api/wonder/route.ts      POST QuerySpec -> request_xml -> CDC WONDER -> ResultTable
  api/nl/route.ts          stub seam for the future LLM interpreter
components/                QueryBuilder, ResultsTable, ChartPanel, StatsPanel, ...
lib/
  wonder/                  types, database registry, request builder, XML parser
    data/d158_variables.json   verified D158 variable + value-code metadata
  stats/                   regression (r², p), correlation (Pearson/Spearman, chi-square)
  export/                  CSV + XLSX
  tableUtils.ts, cache.ts
```

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

Not affiliated with or endorsed by the CDC. Data © CDC/NCHS via CDC WONDER.

### A note on the `xlsx` dependency
The `xlsx` (SheetJS) package carries an advisory about parsing malicious files.
Wonderwall only ever **writes** spreadsheets (export), never parses untrusted
input, so the advisory does not apply here.
