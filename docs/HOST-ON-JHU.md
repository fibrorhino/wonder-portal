# Running Wonderwall on the always-on desktop

**This describes the live setup**, not a plan. The site has been serving from
this machine since 2026-07-08.

**Why this machine:** CDC WONDER refuses API requests from cloud/data-center IPs
(Vercel, Azure, AWS — confirmed). A desktop on the university network has an
allowed IP. A Cloudflare Tunnel publishes it to the internet with no inbound
ports open.

```
visitor → wonderwall.nestadt.org → Cloudflare ──┐
                                                 │  tunnel opened OUTBOUND
                                                 ▼  by this machine
                                        desktop :3000
                                                 │
                                                 ▼  separate, direct → allowed IP ✓
                                          wonder.cdc.gov
```

The tunnel carries traffic **in**. It has nothing to do with the CDC request,
which goes **out** from this machine directly. That separation is the whole
reason the site can be public while CDC still sees a university address.

---

## Where everything lives

| | |
| --- | --- |
| App folder | `C:\dev\wonderwall` — **the only copy to edit** |
| Logs | `C:\dev\wonderwall\logs` |
| Tunnel binaries, config, credentials | `C:\dev\wonderwall\tools` |
| Gemini API key (optional feature) | `C:\dev\wonderwall\.env.local` |
| Public URL | https://wonderwall.nestadt.org |

**Not in git, exists only on this machine:** everything in `tools\` (the `.exe`
files, `config.yml`, and the tunnel credentials `.json`) plus `.env.local`. The
tunnel credentials are the irreplaceable part — lose them and you must create a
new tunnel and re-point DNS. Keep a copy somewhere else.

## The two services

Both are **Windows services** wrapped with [WinSW](https://github.com/winsw/winsw),
set to `Automatic`, so they start at boot with nobody logged in. That is why the
site comes back on its own after the weekly patch reboot. Both are also set to
restart themselves 10 seconds after a crash.

| Service | What it runs |
| --- | --- |
| `WonderPortal` | `node next start -p 3000` in `C:\dev\wonderwall` |
| `WonderTunnel` | `cloudflared … tunnel run wonder-portal` |

Definitions live in `tools\wonder-portal-svc.xml` and `tools\wonder-tunnel-svc.xml`.
They were installed by `tools\install-services.bat` (Run as administrator).

Check them at any time:

```
sc query WonderPortal
sc query WonderTunnel
```

Both should say `RUNNING`.

---

## Deploying a code change

```
cd /d C:\dev\wonderwall
git status            REM must be clean before you start
git pull
npm install
npm run build
```

Then, in an **Administrator** Command Prompt:

```
net stop WonderPortal && net start WonderPortal
```

Only the app service needs restarting — leave `WonderTunnel` alone. Wait ~30
seconds, then load the site and run a real query.

A restart also opens fresh connections to CDC, which is the cure for the
keep-alive 403 problem (see the comment in `app/api/wonder/route.ts`).

### Rolling back

Find the commit you want (`git log --oneline`), then:

```
cd /d C:\dev\wonderwall
git reset --hard <commit>
npm run build
```
followed by the same `net stop` / `net start` as Administrator.

### `cd` gotcha

In Command Prompt, `cd` does **not** switch drives. From `H:\`, typing
`cd C:\dev\wonderwall` leaves you on `H:` and every git command then reports
"not a git repository". Always use `cd /d`, and check the prompt.

---

## Keeping it up

The failure mode here is *silent*: if the app won't start, WinSW retries every
10 seconds forever and nothing tells you. Two guards:

**1. External monitoring — two monitors, watching different things.**

*Is the site up?* A free UptimeRobot **keyword** monitor on
`https://wonderwall.nestadt.org`, alerting when the keyword `WONDER Portal` is
absent. Keyword rather than plain HTTP because Cloudflare will answer even when
this machine is gone; that string comes from the app's own header, so it only
appears if the app really rendered. This is the one that tells you a reboot went
badly. (If you change the header text, update the monitor.)

*Do queries still work?* The home page renders fine while every CDC query 403s,
so a page check cannot see that. Point a second monitor at
`https://wonderwall.nestadt.org/api/health` — keyword `"cdc":"ok"`, or a plain
HTTP monitor, since the endpoint returns **503** when queries are failing.

`/api/health` reports the app's own view of CDC, based on queries real users
already ran — it never calls CDC itself (see `lib/wonderHealth.ts`; a monitor
firing its own WONDER query every few minutes is how an IP gets blocked). It
reports `failing` only after **two consecutive** failures, so one transient 403
— which the route already retries — does not page you. A quiet period with no
queries reports `ok`, not `unknown`, so an idle night never alerts.

```json
{ "ok": true, "cdc": "ok", "detail": "last query succeeded",
  "lastSuccess": "2026-08-05T14:22:10.000Z", "consecutiveFailures": 0,
  "queries": { "cdcCalls": 42, "failed": 1, "cacheHits": 17 },
  "uptimeSeconds": 86400 }
```

Counters are per-process and reset when `WonderPortal` restarts, the same as
the response cache.

**2. Local watchdog.** `tools\healthcheck.ps1` checks the app on
`localhost:3000`, restarts `WonderPortal` if it is unresponsive, and starts
`WonderTunnel` if it has stopped. Install it as a scheduled task that runs every
10 minutes:

```
Right-click tools\install-healthcheck.bat → Run as administrator
```

It appends to `logs\healthcheck.log`. To see what it has been doing:

```
type C:\dev\wonderwall\logs\healthcheck.log
```

To remove it: `schtasks /delete /tn WonderPortalHealthcheck /f`

### What is still unguarded

- **A real power cut.** The machine will not power itself back on. The BIOS
  setting for this ("restore on AC power loss") is locked on a managed desktop.
  A software reboot is fine — the machine restarts on its own and the services
  follow.
- **Someone physically shutting the desktop down.** Label it.

---

## Troubleshooting

**Site is down.** Check `sc query WonderPortal` and `sc query WonderTunnel`
first. If `WonderPortal` is stopped or cycling, look at `logs\app.err.log`. The
usual cause is a failed build — run `npm run build` by hand and read the error.

**Site loads but queries fail with a 403.** CDC is refusing this machine's
requests. Restarting `WonderPortal` opens fresh connections and normally clears
it. If it persists across a restart, the IP itself may be blocked — test with
`npm run dev` and a single query.

**Tunnel service running but the domain doesn't resolve.** Confirm the DNS
record for `wonderwall` in Cloudflare still points at
`<TUNNEL_ID>.cfargotunnel.com`.

---

## Rebuilding from scratch

If this machine is ever lost: clone the repo, `npm install`, restore `tools\`
and `.env.local` from backup, `npm run build`, then run
`tools\install-services.bat` as administrator. Without the backed-up `tools\`
folder you also need to re-run `cloudflared tunnel login`, create a tunnel, and
re-point the DNS record.
