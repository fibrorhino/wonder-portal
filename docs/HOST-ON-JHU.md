# Hosting WONDER Portal on an always-on JHU machine (live data + public domain)

**Why:** CDC WONDER blocks cloud/data-center IPs (Vercel, AWS, …), so the hosted
Vercel site can't fetch data. A machine on the **JHU network has an allowed IP**.
Running the app there and exposing it through a **Cloudflare Tunnel** gives you
`wonderwall.nestadt.org` serving **live data**, with no open ports.

```
visitor → wonderwall.nestadt.org → Cloudflare → Tunnel → JHU machine :3000 → CDC WONDER
                                                                (allowed IP ✓)
```

Do this once on the always-on machine (a JHU desktop left powered on, or a VM
from JHU IT). Assumes Windows; Linux notes at the bottom.

---

## Step 0 — Confirm this machine's IP isn't blocked (2 min, do this FIRST)

No point building the tunnel if CDC blocks this machine too.

```bash
git clone https://github.com/fibrorhino/wonder-portal.git
cd wonder-portal
npm install
npm run dev
```
Open http://localhost:3000, run any query. **If data comes back, this machine's
IP works** — continue. If you get a 403, this machine is also blocked (unlikely
on campus, but if so, try a different JHU host).

Stop the dev server (Ctrl-C) once confirmed.

---

## Step 1 — Run the app as a boot-level Windows service (survives unattended reboot)

The machine reboots unattended (e.g. weekly patch reboot) with **no one logged
in**, so the app must run as a real **Windows service** that starts at *boot*,
not a "startup" item that waits for login. We use **NSSM** (Non-Sucking Service
Manager) to wrap the Next.js production server as a service.

1. Build the production server:
   ```bash
   npm run build
   ```
2. Download NSSM from https://nssm.cc/download (unzip; use `win64\nssm.exe`).
3. In an **Administrator** terminal, install the service (adjust paths):
   ```bat
   nssm install WonderPortal "C:\Program Files\nodejs\node.exe" "node_modules\next\dist\bin\next start -p 3000"
   nssm set WonderPortal AppDirectory "C:\dev\wonderwall"
   nssm set WonderPortal Start SERVICE_AUTO_START
   nssm set WonderPortal AppStdout "C:\dev\wonderwall\logs\app.log"
   nssm set WonderPortal AppStderr "C:\dev\wonderwall\logs\app.err.log"
   nssm start WonderPortal
   ```
The app now serves http://localhost:3000 and **auto-starts on every boot**,
before any login. Manage it with `nssm restart WonderPortal` /
`nssm stop WonderPortal`, or Windows "Services".

To update after code changes: `git pull && npm run build`, then
`nssm restart WonderPortal`.

---

## Step 2 — Install Cloudflare Tunnel

Download `cloudflared` for Windows:
https://github.com/cloudflare/cloudflared/releases (the `cloudflared-windows-amd64.exe`
— rename it to `cloudflared.exe` and put it somewhere on PATH, e.g. `C:\cloudflared\`).

```bash
cloudflared tunnel login          # opens a browser: pick the nestadt.org zone
cloudflared tunnel create wonder-portal
```
`create` prints a **Tunnel ID** and writes a credentials JSON. Note the ID.

Create a config file at `C:\Users\<you>\.cloudflared\config.yml`:
```yaml
tunnel: <TUNNEL_ID>
credentials-file: C:\Users\<you>\.cloudflared\<TUNNEL_ID>.json

ingress:
  - hostname: wonderwall.nestadt.org
    service: http://localhost:3000
  - service: http_status:404
```

Point the domain at the tunnel (auto-creates the Cloudflare DNS record):
```bash
cloudflared tunnel route dns wonder-portal wonderwall.nestadt.org
```

Run the tunnel as a Windows service so it's always up:
```bash
cloudflared service install
```

---

## Step 3 — Switch the domain from Vercel to the tunnel

In **Cloudflare → DNS**, you'll now see a new CNAME for `wonderwall` pointing to
`<TUNNEL_ID>.cfargotunnel.com` (created by Step 2). **Delete the old record** that
pointed to Vercel (`cname.vercel-dns.com` or the `76.76.21.21` A record) so only
the tunnel record remains. Keep it **DNS only** (grey cloud).

In **Vercel**, you can leave the project as-is (a backup/demo) or remove the
`wonderwall.nestadt.org` domain from it to avoid confusion.

---

## Done

`https://wonderwall.nestadt.org` now serves the app from the JHU machine and
**returns live CDC data**. It stays up as long as the machine is powered on
(PM2 + the cloudflared service both auto-start on boot).

### If the machine reboots
Both services are set to auto-start, so it recovers on its own. Verify with
`pm2 status` and `cloudflared tunnel info wonder-portal`.

### Linux VM instead of Windows
- App: same, but use `pm2 startup systemd` instead of `pm2-windows-startup`.
- Tunnel: `cloudflared` has a native package; `sudo cloudflared service install`
  runs it via systemd. Everything else is identical.

### Security note
The app has no login. Anyone with the URL can run queries (all data is public
CDC aggregate data, so this is fine). If you ever want to restrict it, put
**Cloudflare Access** in front of the hostname — a few clicks in the Cloudflare
Zero Trust dashboard, no code changes.
