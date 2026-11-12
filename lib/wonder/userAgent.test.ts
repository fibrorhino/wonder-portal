import test from "node:test";
import assert from "node:assert/strict";
import { wonderUserAgent } from "./userAgent";

test("the default identifies the site and is never Node's own", () => {
  const ua = wonderUserAgent(undefined);
  assert.ok(ua.length > 0);
  // CDC's edge answers "User-Agent: node" with 403.
  assert.notEqual(ua.toLowerCase(), "node");
  // Saying what the client is, not pretending to be a browser.
  assert.ok(!/mozilla|chrome|safari/i.test(ua), ua);
  assert.match(ua, /^[A-Za-z][\w.-]*\/\d/, "a product token: Name/version");
});

test("an override is used, cleaned of anything a header cannot carry", () => {
  assert.equal(
    wonderUserAgent("MortalityDataPortal/1.0 (+https://example.org/contact)"),
    "MortalityDataPortal/1.0 (+https://example.org/contact)",
  );
  assert.equal(wonderUserAgent("  Portal/2.0\r\nX-Injected: 1 "), "Portal/2.0X-Injected: 1");
});

test("a blank override, or one that is the refused string, falls back", () => {
  const fallback = wonderUserAgent(undefined);
  assert.equal(wonderUserAgent(""), fallback);
  assert.equal(wonderUserAgent("   "), fallback);
  assert.equal(wonderUserAgent("node"), fallback);
  assert.equal(wonderUserAgent("Node"), fallback);
});
