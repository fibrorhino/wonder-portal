// Visitor-facing wording for failures that happen on CDC's side.
//
// These messages are read by people who did not build this site, so they must
// make clear WHOSE problem it is and what to do next. The previous 403 text —
// "CDC's edge is refusing requests from this server... restarting the app
// typically resolves it" — read like the site was broken and suggested an
// action only the operator can take.
//
// The technical detail is not lost: the raw status and CDC's own message still
// go to /api/health and to logs/queries.jsonl.

/** How long to tell someone to wait before retrying a throttled request. */
const RETRY_HINT = "about a minute";

/**
 * Message for a non-OK HTTP response from CDC WONDER.
 *
 * @param status  HTTP status CDC returned.
 * @param detail  CDC's own error text, if the response carried one.
 */
export function cdcHttpErrorMessage(status: number, detail: string | null): string {
  // 403 is CDC's edge turning the request away — rate limiting or reputation,
  // not anything the visitor did. The route has already retried twice by now.
  if (status === 403) {
    return (
      `CDC WONDER's servers are busy and turned this request away. ` +
      `This is a limit on CDC's side, not a problem with this site — ` +
      `please wait ${RETRY_HINT} and run the query again.`
    );
  }

  // CDC refuses a query it will not run with a 500 AND an explanation. Asking
  // for state-level data is the standing example ("Only national data are
  // available for this dataset when using the WONDER web service"). Telling the
  // visitor CDC is "temporarily unavailable, try again in a minute" sent them
  // round in circles: the same query fails the same way every time, and the
  // one sentence that says why was being thrown away.
  if (isQueryRejection(status, detail)) {
    return `CDC WONDER could not run this query: ${withFullStop(detail!)}`;
  }

  // 429 is an explicit rate limit; a 5xx with nothing to say for itself is CDC
  // being unwell. Same advice.
  if (status === 429 || status >= 500) {
    return (
      `CDC WONDER is temporarily unavailable (their server returned ${status}). ` +
      `This is a problem on CDC's side, not with this site — ` +
      `please try again in ${RETRY_HINT}.`
    );
  }

  // Anything else usually means CDC understood the request and objected to it,
  // so surface their explanation — that one IS about the query.
  return detail
    ? `CDC WONDER could not run this query: ${withFullStop(detail)}`
    : `CDC WONDER could not run this query (their server returned ${status}). Please try again shortly.`;
}

/** CDC's messages sometimes end in a full stop and sometimes do not. */
function withFullStop(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * True when CDC answered with an error status but told us what was wrong with
 * the query. That is CDC working as intended and refusing a request, not CDC
 * being down, so it must not count against the health check either.
 *
 * 403 and 429 are excluded whatever they carry: those come from CDC's edge and
 * are about this server's traffic, never about the query.
 */
export function isQueryRejection(status: number, detail: string | null): boolean {
  if (status === 403 || status === 429) return false;
  return status >= 400 && Boolean(detail && detail.trim());
}

/** Message for a request this site declined to queue: too many already waiting. */
export function cdcBusyMessage(): string {
  return (
    "Several queries are already waiting. CDC allows one request every 15 seconds, " +
    "so this one could not be started in time. Please run it again in about a minute."
  );
}

/** Message for a request that never got a usable response at all. */
export function cdcNetworkErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  // AbortSignal.timeout() rejects with a TimeoutError. Big cross-tabs genuinely
  // can take longer than CDC will hold the connection open for.
  if (name === "TimeoutError" || /timed? ?out|aborted/i.test(message)) {
    return (
      "CDC WONDER took too long to respond and the request timed out. " +
      "Large queries can be slow on their side — please try again, or narrow " +
      "the query (fewer group-by fields, or a shorter year range)."
    );
  }

  return (
    "Could not reach CDC WONDER. Their service may be temporarily unavailable — " +
    `please try again in ${RETRY_HINT}.`
  );
}
