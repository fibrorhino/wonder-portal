# Where to host Wonderwall: Azure App Service vs. a Hopkins Linux VM

Decision notes for the JH Research IT thread (RIT-4781). The short version:
**the requirement is not "a VM" — it is "outbound traffic to `wonder.cdc.gov`
leaves from a Hopkins-owned IP address."** Any host that satisfies that works;
any host that doesn't is useless regardless of how modern it is.

---

## 1. What the app actually does today

There is no separate "proxy through my desktop." The **entire Next.js app runs
on the desktop** and is published to the internet through a Cloudflare Tunnel
(see `docs/HOST-ON-JHU.md`):

```
visitor → wonderwall.nestadt.org → Cloudflare → tunnel → desktop:3000 → CDC WONDER
                                                            (Hopkins IP ✓)
```

The CDC call is made server-side in `app/api/wonder/route.ts`. Whatever machine
runs that file is the machine whose IP CDC sees. Vercel is not in the live path.

Consequence: **moving hosts is a lift-and-shift, not a rewrite.** The app is a
stock Next.js 16 server (`npm run build && npm start`, one port, no database, no
persistent disk, one optional env var `GEMINI_API_KEY`). It will run unchanged
on a VM, in a container, or on App Service.

---

## 2. Why Nick's suggestion probably doesn't solve the problem

Nick is right on the general principle — for an ordinary web app, App Service or
Container Apps is cheaper and far less work than a VM, and Research IT doesn't
have to patch it. If this were a normal app I'd take his advice without
argument.

But this app's whole reason for needing Hopkins hosting is the egress IP, and:

- **Azure App Service and Container Apps egress from Microsoft datacenter IP
  ranges by default.** "Sits within the Hopkins network" in his email almost
  certainly means the Hopkins Azure *tenant/subscription* (their governance,
  their billing, their access control) — not Hopkins IP space. Outbound packets
  still carry an Azure address, published by Microsoft in the `AzureCloud`
  service tag, which is exactly the kind of range CDC blocks.
- **An Azure Linux VM has the same problem.** This is the part worth being
  explicit about internally: asking for "a Linux VM" is not by itself the fix.
  An Azure VM has an Azure public IP. If Research IT grants a VM but builds it
  in Azure with default internet egress, it fails the same way the desktop's
  Vercel deployment did.

So the two things that actually work are:

1. **A host physically on the Hopkins network** (on-prem VM/hypervisor, or a
   small always-on Linux box in the department) — egress is a JHU IP by
   construction. This is what the desktop already proves works.
2. **An Azure workload whose internet egress is forced back through Hopkins.**
   Technically real: VNet integration + "route all outbound traffic" + forced
   tunneling over the ExpressRoute/VPN link to campus, so traffic exits via
   Hopkins' border NAT and shows a JHU IP. It works for App Service, Container
   Apps, or a VM. But it requires the JH network team to allow forced tunneling
   for this subnet, and it is much more coordination than a VM.

**Also note this is empirical, not documented.** CDC publishes no blocklist.
The only honest way to settle it is to test: stand up whatever they offer, run
one query, see whether it 403s. That reframing is useful in the thread — it
turns "Paul insists on a VM" into "let's verify egress before committing."

---

## 3. What to write back to Nick

Something like:

> Thanks Nick — happy to go the App Service / container route if it clears the
> one constraint that drove the request. My app is a stock containerizable
> Node/Next.js app, so packaging is not the issue. The issue is the *source IP
> of its outbound requests*: CDC WONDER's API accepts requests from university
> and residential IPs and 403s requests coming from cloud provider ranges. My
> campus desktop works today for exactly that reason.
>
> So my question is about egress rather than hosting model: if the app runs on
> Azure App Service or Container Apps in the Hopkins tenant, what public IP does
> its *outbound* traffic present to an external site — an Azure range, or a
> Hopkins range via ExpressRoute/forced tunneling? If it's an Azure range, the
> app will deploy fine but won't be able to fetch any data, which is the same
> failure I have on Vercel now.
>
> If forced tunneling to Hopkins egress is available on App Service, I'd be glad
> to use it and skip the VM entirely. If it isn't, then a small always-on Linux
> host on the Hopkins network is the thing that solves it — 1 vCPU / 2 GB RAM /
> 20 GB disk, Ubuntu LTS, outbound HTTPS only, no inbound ports needed (I
> publish via an outbound-only Cloudflare Tunnel), no PHI, no stored data.
>
> Easy way to settle it without much work on your side: I can deploy to whatever
> you provision and run a single test query — either it returns data or it
> returns a 403, and we'll know in five minutes.

That gives him a cheap path to say yes and makes the VM ask evidence-based
instead of preference-based.

---

## 4. Minimum specs to ask for (if it's a VM)

| Item | Ask | Why |
| --- | --- | --- |
| OS | Ubuntu Server 24.04 LTS | free, long support, Node runs cleanly |
| CPU / RAM | 1–2 vCPU, 2 GB (4 GB comfortable) | Next.js SSR for a handful of concurrent users; CDC throttles to 1 query/15 s anyway, so this will never be CPU-bound |
| Disk | 20–30 GB | OS + Node + app; no data is stored |
| Inbound ports | **none required** | Cloudflare Tunnel dials outbound |
| Outbound | HTTPS (443) to `wonder.cdc.gov`, `*.cloudflare.com`, `github.com`, npm registry, and `generativelanguage.googleapis.com` if the NL box stays on | |
| Data class | Public data only, **no PHI** | keeps it out of the restricted-environment review |
| Access | SSH key for me | deploys/updates |

Cost framing for the thread: this is roughly a B1s/B2s-class machine —
~$10–30/month list, less than the staff time spent debating it.

---

## 5. If you do go Azure — how to make it actually bounce through Hopkins

Two shapes. Both are fine for the app; the difference is who does the network
work.

### Option A — Azure VM, egress forced through Hopkins (closest to what you asked for)

1. Research IT provisions an Ubuntu VM in the Hopkins Azure subscription, in a
   VNet that has ExpressRoute/VPN connectivity to campus.
2. **The critical step:** the VM's subnet gets a route table with
   `0.0.0.0/0 → Virtual network gateway` (forced tunneling), and *no* public IP
   on the NIC. Internet-bound traffic then travels to campus and exits through
   Hopkins' NAT. Network team must confirm campus egress is permitted for that
   subnet — many ExpressRoute setups drop internet traffic rather than NAT it,
   which is the failure mode to ask about up front.
3. Verify before doing anything else — this is the whole ballgame:
   ```bash
   curl -s https://api.ipify.org        # must be a JHU address, not Azure
   ```
   Then the real test:
   ```bash
   git clone https://github.com/fibrorhino/wonder-portal.git && cd wonder-portal
   npm install && npm run dev
   curl -s -o /dev/null -w '%{http_code}\n' \
     -X POST http://localhost:3000/api/wonder \
     -H 'content-type: application/json' \
     -d '{"groupBy":["year"],"filters":{}}'
   ```
   `200` with data → done. `502` mentioning a CDC 403 → egress is still Azure.
4. Then follow §6 to run it as a service + tunnel.

### Option B — App Service / Container App with VNet integration + forced tunnel

Same network requirement, packaged differently:

1. Dockerize (see §7) and push the image to Azure Container Registry.
2. Deploy to App Service (Linux container) or Container Apps.
3. Enable **VNet integration** into the ExpressRoute-connected VNet and set
   `WEBSITE_VNET_ROUTE_ALL=1` (App Service) or an equivalent egress-controlled
   environment (Container Apps with a custom VNet + UDR).
4. Verify egress the same way — deploy a one-liner that hits `api.ipify.org`
   and check the address before you trust anything else.
5. Set `GEMINI_API_KEY` as an app setting if you want the NL box.
6. Point `wonderwall.nestadt.org` at it: add the custom domain in App Service,
   let it issue a managed certificate, then CNAME `wonderwall` at the App
   Service hostname in Cloudflare DNS (**grey cloud / DNS-only** during setup so
   domain validation isn't confused by the proxy).

My recommendation: **Option A if they'll give you a VM, Option B only if they
won't.** Not because containers are worse, but because Option A is one machine
you control end to end, with the deployment path already written and proven, and
because troubleshooting a 403 is far easier when you can SSH in and run `curl`.

---

## 6. Running it on a Linux host (the actual setup, either option)

Assumes Ubuntu. ~20 minutes.

```bash
# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# App
sudo mkdir -p /opt/wonderwall && sudo chown $USER /opt/wonderwall
git clone https://github.com/fibrorhino/wonder-portal.git /opt/wonderwall
cd /opt/wonderwall
npm ci
printf 'GEMINI_API_KEY=AIza...\n' > .env.local   # optional; omit to disable the NL box
npm run build
```

Run it as a systemd service so it survives reboots with nobody logged in — the
Linux equivalent of the NSSM setup in `docs/HOST-ON-JHU.md`:

```ini
# /etc/systemd/system/wonderwall.service
[Unit]
Description=Wonderwall (CDC WONDER portal)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wonder
WorkingDirectory=/opt/wonderwall
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wonderwall
curl -s localhost:3000 >/dev/null && echo up
```

Publish it without opening any inbound port:

```bash
# install cloudflared from Cloudflare's apt repo, then:
cloudflared tunnel login                       # pick the nestadt.org zone
cloudflared tunnel create wonder-portal
sudo mkdir -p /etc/cloudflared
```

```yaml
# /etc/cloudflared/config.yml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: wonderwall.nestadt.org
    service: http://localhost:3000
  - service: http_status:404
```

```bash
cloudflared tunnel route dns wonder-portal wonderwall.nestadt.org
sudo cloudflared service install
```

Then in Cloudflare DNS delete the old `wonderwall` record pointing at Vercel, so
only the `<TUNNEL_ID>.cfargotunnel.com` CNAME remains.

**Updates:** `cd /opt/wonderwall && git pull && npm ci && npm run build && sudo
systemctl restart wonderwall`.

---

## 7. If they require a container

Add this `Dockerfile` (nothing else in the app needs to change; Next.js 16
standalone output keeps the image small — add `output: "standalone"` to
`next.config.ts` first):

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

---

## 8. What you'd lose by leaving Vercel

Honestly, very little — you've already left, since the desktop serves the live
site today.

| Vercel gives you | On a Hopkins host |
| --- | --- |
| Auto-deploy on `git push` | manual `git pull && npm run build && systemctl restart` (or a small GitHub Action / cron) |
| Automatic TLS | Cloudflare Tunnel terminates TLS for you — still automatic |
| Global CDN / edge caching | irrelevant here; the bottleneck is CDC's 15-second rate limit, not latency |
| Zero server maintenance | you (or Research IT) patch the OS |
| Free | ~$10–30/month, or free if it's an existing on-prem host |
| **Working CDC queries** | ✗ on Vercel — **✓ here.** This is the entire point |

Two things genuinely improve on a single always-on host: the 15-second CDC
throttle and the response cache in `lib/cache.ts` are **per-process in-memory**
state. On Vercel's serverless model those are per-instance and unreliable
(multiple cold instances can each think they're allowed to fire, tripping CDC's
rate limit). One long-lived server makes both correct.

One thing to keep in mind, already handled in `app/api/wonder/route.ts`: a
long-running server reuses TCP connections, and a keep-alive connection that CDC
flags will 403 every subsequent request. The route sends `Connection: close` and
retries 403s for exactly this reason — that fix matters more on an always-on
host than it did on the desktop.

---

## 9. Recommendation

1. Reply to Nick reframing the ask around **egress IP**, not VM-vs-PaaS (§3).
   Offer the five-minute empirical test.
2. If Research IT can force-tunnel App Service egress through Hopkins — take it.
   Cheaper, no patching, and Nick is happy.
3. If they can't (most likely), the Linux VM ask is now justified on technical
   grounds rather than preference. Specs in §4.
4. Either way, **verify `curl https://api.ipify.org` returns a JHU address
   before building anything on top of it.** Everything else is a solved problem.
5. Keep the desktop running until the new host answers a real query. Cutover is
   one DNS record.
