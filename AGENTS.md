<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

This is a single Next.js 16 app (`wonderwall`), package manager npm. No local database. Standard scripts live in `package.json` (`dev`, `build`, `start`, `lint`).

- Run the dev server with `npm run dev` (serves on port 3000). Start it in a background/tmux session; it does not exit on its own.
- Core functionality (query builder, table, chart, stats) needs no env vars or accounts. The only optional env var is `GEMINI_API_KEY` in `.env.local`, which enables the natural-language box (`/api/nl`); without it `/api/nl` returns `{"enabled": false}` and the manual builder still works.
- The app proxies queries to the external CDC WONDER API (`wonder.cdc.gov`) via `/api/wonder`. This must be reachable at runtime for real data. CDC often 403s cloud/data-center IPs, but in this Cursor Cloud VM outbound requests to CDC WONDER succeeded and returned live data.
- Non-obvious gotcha: `/api/wonder` enforces a ~15.5s minimum gap between consecutive outbound CDC calls (per-process, in-memory). Successive queries can appear to "hang" for up to ~15s while throttled — this is expected, not a bug. Results are cached in-memory for 12h.
- `npm run lint` currently reports pre-existing lint errors in `components/` (unrelated to environment setup).
- `run-locally.bat`, `tools/`, and `docs/HOST-ON-JHU.md` are Windows/Cloudflare-Tunnel production hosting helpers — not needed for local development.
