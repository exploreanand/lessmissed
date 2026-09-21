// SSRF guard tests.
//
// The capture worker is a browser that fetches operator-supplied URLs from
// inside our network, which is the textbook SSRF shape. Three of the cases
// below were live bypasses in the first draft of urlSafety.js and were found by
// running these assertions rather than by reading the code — they are kept as
// regression tests because each one defeats the obvious implementation:
//
//   * URL.hostname returns IPv6 literals bracketed ("[::1]"), which net.isIP
//     rejects, so the address skipped the range check and fell through to DNS.
//   * The URL parser rewrites "::ffff:127.0.0.1" as "::ffff:7f00:1", so a
//     dotted-quad regex missed it and the cloud metadata endpoint was reachable
//     as http://[::ffff:169.254.169.254]/.
//   * Anything net.isIP could not classify used to fail open.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertSafeUrl,
  isBlockedAddress,
  isBlockedLiteralHost,
  hostMatches,
} from "../../Web-App/lessmissed/lib/capture/urlSafety.js";

const BLOCKED = [
  "127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1",
  "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
  "::1", "::", "fe80::1", "febf::1", "fc00::1", "fd12:3456::1", "ff02::1",
  "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe",
  "not-an-ip", "", "999.1.1.1",
];

const ALLOWED = [
  "8.8.8.8", "1.1.1.1", "93.184.216.34",
  // Just outside the RFC1918 172.16.0.0/12 block, on both sides.
  "172.15.0.1", "172.32.0.1",
  "2606:4700::1111", "::ffff:808:808", "fe00::1",
];

test("isBlockedAddress rejects every non-routable range", () => {
  for (const address of BLOCKED) {
    assert.equal(isBlockedAddress(address), true, `${address || "(empty)"} must be blocked`);
  }
});

test("isBlockedAddress allows public addresses", () => {
  for (const address of ALLOWED) {
    assert.equal(isBlockedAddress(address), false, `${address} must be allowed`);
  }
});

test("hostMatches binds a URL to its project domain", () => {
  assert.equal(hostMatches("acme.com", "acme.com"), true);
  assert.equal(hostMatches("www.acme.com", "acme.com"), true);
  assert.equal(hostMatches("shop.eu.acme.com", "acme.com"), true);
  assert.equal(hostMatches("acme.com", "www.acme.com"), true);
  // The two that matter: neither a prefix nor a suffix may impersonate.
  assert.equal(hostMatches("notacme.com", "acme.com"), false);
  assert.equal(hostMatches("acme.com.evil.com", "acme.com"), false);
});

async function rejectedWith(url, code, options) {
  await assert.rejects(
    () => assertSafeUrl(url, options),
    (err) => {
      assert.equal(err.code, code, `${url} should fail as ${code}, got ${err.code}`);
      return true;
    },
    `${url} must be rejected`
  );
}

test("assertSafeUrl blocks private and loopback destinations", async () => {
  await rejectedWith("http://127.0.0.1:3000", "blocked_address");
  await rejectedWith("http://localhost:3000", "blocked_address");
  await rejectedWith("http://169.254.169.254/latest/meta-data/", "blocked_address");
  await rejectedWith("http://192.168.1.1/", "blocked_address");
});

test("assertSafeUrl blocks bracketed and mapped IPv6 (regression)", async () => {
  await rejectedWith("http://[::1]:8080/", "blocked_address");
  await rejectedWith("http://[::ffff:127.0.0.1]/", "blocked_address");
  await rejectedWith("http://[::ffff:169.254.169.254]/", "blocked_address");
  await rejectedWith("http://[fe80::1]/", "blocked_address");
  await rejectedWith("http://[fd00::1]/", "blocked_address");
});

test("assertSafeUrl blocks alternate IPv4 spellings", async () => {
  // The URL parser normalises these to a dotted quad before we see them, but
  // that is an implementation detail of the parser — assert the outcome.
  await rejectedWith("http://2130706433/", "blocked_address");
  await rejectedWith("http://0177.0.0.1/", "blocked_address");
  await rejectedWith("http://0x7f.0.0.1/", "blocked_address");
});

test("assertSafeUrl blocks non-http schemes and embedded credentials", async () => {
  await rejectedWith("file:///etc/passwd", "bad_protocol");
  await rejectedWith("data:text/html,<h1>x", "bad_protocol");
  await rejectedWith("ftp://example.com/", "bad_protocol");
  await rejectedWith("http://user:pw@example.com", "credentials_in_url");
  await rejectedWith("nonsense", "invalid_url");
});

test("assertSafeUrl enforces origin binding", async () => {
  await rejectedWith("https://evil.com/x", "wrong_origin", { expectedHostname: "acme.com" });
  await rejectedWith("https://acme.com.evil.com/", "wrong_origin", { expectedHostname: "acme.com" });
});

// Network-dependent: skipped automatically when DNS is unavailable, so the
// suite stays runnable offline.
test("assertSafeUrl allows a real public URL", async (t) => {
  try {
    const result = await assertSafeUrl("https://example.com/pricing", {
      expectedHostname: "example.com",
    });
    assert.equal(result.url.hostname, "example.com");
    assert.ok(result.addresses.length > 0, "should report the resolved addresses");
  } catch (err) {
    if (err.code === "dns_failure") return t.skip("no DNS in this environment");
    throw err;
  }
});

// Regression: the subresource guard once used isBlockedAddress on a *hostname*.
// That function fails closed on anything that is not a literal IP, so every
// stylesheet, font and image — all served from domain names — was aborted, and
// pages rendered as bare unstyled HTML.
test("isBlockedLiteralHost lets ordinary domain names through", () => {
  for (const host of [
    "cdn.shopify.com",
    "www.suvria.com",
    "fonts.gstatic.com",
    "fonts.googleapis.com",
    "images.unsplash.com",
    "d1234abcd.cloudfront.net",
  ]) {
    assert.equal(
      isBlockedLiteralHost(host),
      false,
      `${host} is a hostname, not an address — it must not be blocked here`
    );
  }
});

test("isBlockedLiteralHost still blocks literal private addresses", () => {
  for (const host of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "[::1]", "[fd00::1]"]) {
    assert.equal(isBlockedLiteralHost(host), true, `${host} must be blocked`);
  }
  assert.equal(isBlockedLiteralHost("8.8.8.8"), false, "a public literal IP is fine");
  assert.equal(isBlockedLiteralHost(""), false, "an empty host is not a literal IP");
});
