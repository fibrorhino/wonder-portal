// Tests for the User-Agent classifier used by the usage log.
// Order matters in the parser: Edge and Opera both claim to be Chrome, and
// Chrome claims to be Safari, so these guard against a regression that would
// silently reclassify most visitors.

import test from "node:test";
import assert from "node:assert/strict";
import { parseUserAgent } from "./queryLog";

const UA = {
  chromeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  edgeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  firefoxLinux:
    "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  ipad:
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/604.1",
  uptimeRobot: "Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)",
  curl: "curl/8.5.0",
};

test("browsers that impersonate each other are told apart", () => {
  assert.equal(parseUserAgent(UA.edgeWin).browser, "Edge", "Edge also says Chrome");
  assert.equal(parseUserAgent(UA.chromeWin).browser, "Chrome", "Chrome also says Safari");
  assert.equal(parseUserAgent(UA.safariMac).browser, "Safari");
  assert.equal(parseUserAgent(UA.firefoxLinux).browser, "Firefox");
});

test("operating systems are identified", () => {
  assert.equal(parseUserAgent(UA.chromeWin).os, "Windows");
  assert.equal(parseUserAgent(UA.safariMac).os, "macOS");
  assert.equal(parseUserAgent(UA.safariIphone).os, "iOS");
  assert.equal(parseUserAgent(UA.firefoxLinux).os, "Linux");
  assert.equal(parseUserAgent(UA.chromeAndroid).os, "Android");
});

test("device class distinguishes mobile, tablet and desktop", () => {
  assert.equal(parseUserAgent(UA.chromeWin).device, "desktop");
  assert.equal(parseUserAgent(UA.safariIphone).device, "mobile");
  assert.equal(parseUserAgent(UA.chromeAndroid).device, "mobile");
  assert.equal(parseUserAgent(UA.ipad).device, "tablet");
  // Android without "Mobile" in the UA is the tablet convention.
  assert.equal(parseUserAgent(UA.androidTablet).device, "tablet");
});

test("monitors and scripts are flagged as bots, not as real visitors", () => {
  // Otherwise the uptime checks would dominate the usage figures.
  assert.equal(parseUserAgent(UA.uptimeRobot).device, "bot");
  assert.equal(parseUserAgent(UA.curl).device, "bot");
  assert.equal(parseUserAgent(UA.curl).browser, "bot");
});

test("a missing or unrecognised User-Agent does not throw", () => {
  assert.deepEqual(parseUserAgent(""), {
    browser: "unknown",
    os: "unknown",
    device: "unknown",
  });
  const odd = parseUserAgent("something-nobody-has-seen");
  assert.equal(odd.browser, "other");
  assert.equal(odd.os, "other");
});
