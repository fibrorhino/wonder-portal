// Safely parse a fetch Response that is expected to be JSON. Gateway layers
// (Cloudflare tunnel, service restarts) can return HTML error pages; blindly
// calling res.json() then surfaces "Unexpected token '<'..." to the user.
// Returns a friendly error instead.

export async function safeJson<T>(res: Response): Promise<
  { ok: true; data: T } | { ok: false; error: string }
> {
  const text = await res.text();
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    const gateway =
      res.status >= 500 || /<!DOCTYPE|<html/i.test(text.slice(0, 100));
    return {
      ok: false,
      error: gateway
        ? "The server is temporarily unavailable (it may be restarting or busy). Please try again in a minute."
        : `Unexpected response from server (HTTP ${res.status}).`,
    };
  }
}
