# Finish setup tomorrow — WONDER Portal on this machine

Everything that can be prepped ahead of time is **already done** (survives the
reboot):
- ✅ Production build (`.next/`) is built.
- ✅ `tools\cloudflared.exe` (tunnel) and `tools\wonder-portal-svc.exe` +
  `wonder-portal-svc.xml` (app service wrapper) downloaded.
- ✅ `tools\install-services.bat` (the Admin installer) ready.
- ✅ `tools\config.template.yml` ready to become `config.yml`.

## What's left (do this together with Claude tomorrow — ~10 min)

**1. Log in to Cloudflare from cloudflared** (opens a browser — you click Approve
for the `nestadt.org` zone):
```
cd C:\dev\wonderwall\tools
cloudflared.exe tunnel login
```

**2. Create the tunnel** (prints a Tunnel ID + a credentials .json path):
```
cloudflared.exe tunnel create wonder-portal
```
Claude will then fill `config.yml` from the template with that Tunnel ID and
put the credentials .json in `tools\`.

**3. Route the domain to the tunnel** (creates the Cloudflare DNS record):
```
cloudflared.exe tunnel route dns wonder-portal wonderwall.nestadt.org
```

**4. Install both services — RIGHT-CLICK `tools\install-services.bat` →
"Run as administrator".** This installs the app + tunnel as boot-level Windows
services (they auto-start after every reboot, including the Tuesday patch reboot,
with no login needed).

**5. In the Cloudflare dashboard → DNS:** delete the OLD `wonderwall` record that
points at Vercel (`cname.vercel-dns.com` / `76.76.21.21`). Keep the new tunnel
record (`<id>.cfargotunnel.com`), DNS only (grey cloud).

**6. Test:** open https://wonderwall.nestadt.org and run a query — you should get
**live CDC data** (served from this machine's allowed IP).

---

### After it's live
- It survives reboots automatically (both services start at boot).
- To deploy code updates later: `git pull && npm run build`, then restart the
  app service (`net stop WonderPortal && net start WonderPortal`, as Admin).
- Full reference: `docs/HOST-ON-JHU.md`.
