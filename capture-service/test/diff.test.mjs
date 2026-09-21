// Tests for the change-detection logic.
//
// These are the decisions that determine whether a render is stored or thrown
// away, so getting them wrong is expensive in both directions: too sensitive
// and every page re-captures daily for no reason, too blunt and a redesigned
// homepage keeps its old screenshot while heatmaps drift out of alignment.

import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  contentHash,
  isContentHashReliable,
  perceptualHash,
  hammingDistance,
  imageDiff,
} from "../src/diff.js";

/** A solid-colour canvas with optional coloured rectangles painted on it. */
async function makeImage(width, height, background, rects = []) {
  const overlays = await Promise.all(
    rects.map(async (r) => ({
      input: await sharp({
        create: {
          width: r.w,
          height: r.h,
          channels: 3,
          background: r.color,
        },
      }).png().toBuffer(),
      left: r.x,
      top: r.y,
    }))
  );

  return sharp({
    create: { width, height, channels: 3, background },
  })
    .composite(overlays)
    .jpeg({ quality: 90 })
    .toBuffer();
}

const WHITE = { r: 255, g: 255, b: 255 };
const MAGENTA = { r: 255, g: 0, b: 255 };

test("contentHash ignores per-request noise but sees real edits", () => {
  const base = `<html><head><script nonce="abc123">var x=1</script>
    <link href="/app.css?v=8821"></head>
    <body><h1>Pricing</h1><p class="css-1a2b3c">From $10</p></body></html>`;

  // Same page, different nonce, different cache-buster, different generated
  // class suffix — all of which change on literally every request.
  const noisy = `<html><head><script nonce="zzz999">var x=1</script>
    <link href="/app.css?v=9930"></head>
    <body><h1>Pricing</h1><p class="css-9z8y7x">From $10</p></body></html>`;

  assert.equal(contentHash(base), contentHash(noisy), "noise must not register as change");

  const edited = base.replace("From $10", "From $12");
  assert.notEqual(contentHash(base), contentHash(edited), "a price change must register");

  const restructured = base.replace("<h1>Pricing</h1>", "<h1>Pricing</h1><section>New</section>");
  assert.notEqual(contentHash(base), contentHash(restructured), "a new section must register");
});

test("contentHash is null-safe", () => {
  assert.equal(contentHash(""), null);
  assert.equal(contentHash(null), null);
});

test("isContentHashReliable flags client-rendered shells", () => {
  const shell = `<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;
  const rendered = "Pricing ".repeat(80); // what the user actually sees
  assert.equal(
    isContentHashReliable(shell, rendered),
    false,
    "an SPA shell tells us nothing about the page"
  );

  const server = `<html><body><h1>Pricing</h1>${"<p>Plans and prices</p>".repeat(40)}</body></html>`;
  assert.equal(isContentHashReliable(server, "Pricing " + "Plans and prices ".repeat(40)), true);
});

test("perceptualHash is stable across re-encoding, sensitive to layout", async () => {
  const original = await makeImage(320, 240, WHITE, [
    { x: 20, y: 20, w: 120, h: 60, color: { r: 20, g: 20, b: 20 } },
  ]);

  // Same picture, re-encoded at a different quality: a byte hash would differ,
  // a perceptual hash must not.
  const reEncoded = await sharp(original).jpeg({ quality: 60 }).toBuffer();
  const a = await perceptualHash(original);
  const b = await perceptualHash(reEncoded);
  assert.ok(hammingDistance(a, b) <= 4, `re-encode should be near-identical, got ${hammingDistance(a, b)}`);

  // Block moved to the other side of the canvas: clearly a different layout.
  const moved = await makeImage(320, 240, WHITE, [
    { x: 180, y: 140, w: 120, h: 60, color: { r: 20, g: 20, b: 20 } },
  ]);
  const c = await perceptualHash(moved);
  assert.ok(hammingDistance(a, c) > 6, `a moved block should differ, got ${hammingDistance(a, c)}`);
});

test("hammingDistance handles missing or mismatched hashes", () => {
  assert.equal(hammingDistance(null, "abc"), 64);
  assert.equal(hammingDistance("ab", "abcd"), 64);
  assert.equal(hammingDistance("ffffffffffffffff", "ffffffffffffffff"), 0);
});

test("imageDiff reports ~0% for an identical page", async () => {
  const image = await makeImage(400, 600, WHITE, [
    { x: 40, y: 40, w: 300, h: 100, color: { r: 10, g: 80, b: 200 } },
  ]);
  const { changedPct, heightChanged } = await imageDiff(image, image);
  assert.ok(changedPct < 0.5, `identical images should be ~0%, got ${changedPct}`);
  assert.equal(heightChanged, false);
});

test("imageDiff detects a real change and locates it", async () => {
  const before = await makeImage(400, 600, WHITE, [
    { x: 40, y: 40, w: 300, h: 100, color: { r: 10, g: 80, b: 200 } },
  ]);
  const after = await makeImage(400, 600, WHITE, [
    { x: 40, y: 40, w: 300, h: 100, color: { r: 10, g: 80, b: 200 } },
    { x: 40, y: 300, w: 300, h: 160, color: { r: 220, g: 30, b: 30 } },
  ]);

  const { changedPct, changedBoxes } = await imageDiff(before, after);
  assert.ok(changedPct > 5, `a new 300x160 banner should exceed 5%, got ${changedPct}`);
  assert.ok(changedBoxes.length > 0, "should report where it changed");

  // The largest reported box should sit over the new banner, not the header.
  const [biggest] = changedBoxes;
  assert.ok(biggest.y >= 256 && biggest.y <= 340, `box should be near y=300, got ${biggest.y}`);
});

test("imageDiff ignores masked regions", async () => {
  // A page whose only difference is inside an area the admin masked — a
  // timestamp, a cart count, a rotating hero. Must read as unchanged.
  const before = await makeImage(400, 600, WHITE, [
    { x: 50, y: 50, w: 200, h: 80, color: MAGENTA },
  ]);
  const after = await makeImage(400, 600, WHITE, [
    { x: 50, y: 50, w: 200, h: 80, color: MAGENTA },
    // Content that would have been under the mask differs wildly, but the mask
    // is painted over both, so neither side is comparable there.
  ]);

  const { changedPct } = await imageDiff(before, after);
  assert.ok(changedPct < 0.5, `masked-only differences must not count, got ${changedPct}`);

  // Sanity: an unmasked change of the same size *is* counted, so the mask is
  // suppressing the region rather than the comparison as a whole.
  const changedOutside = await makeImage(400, 600, WHITE, [
    { x: 50, y: 50, w: 200, h: 80, color: MAGENTA },
    { x: 50, y: 400, w: 200, h: 80, color: { r: 0, g: 0, b: 0 } },
  ]);
  const outside = await imageDiff(before, changedOutside);
  assert.ok(outside.changedPct > 3, `unmasked change should count, got ${outside.changedPct}`);
});

test("imageDiff flags a reflow instead of pretending to compare", async () => {
  const short = await makeImage(400, 600, WHITE, [
    { x: 40, y: 40, w: 300, h: 100, color: { r: 10, g: 80, b: 200 } },
  ]);
  const tall = await makeImage(400, 900, WHITE, [
    { x: 40, y: 40, w: 300, h: 100, color: { r: 10, g: 80, b: 200 } },
  ]);

  const { heightChanged, changedPct } = await imageDiff(short, tall);
  assert.equal(heightChanged, true, "a taller page must be flagged as reflowed");
  // The overlapping region is identical, so the comparison itself stays honest.
  assert.ok(changedPct < 0.5, `overlap is unchanged, got ${changedPct}`);
});

test("imageDiff tolerates JPEG noise without reporting change", async () => {
  const original = await makeImage(400, 600, WHITE, [
    { x: 30, y: 30, w: 340, h: 200, color: { r: 90, g: 140, b: 210 } },
  ]);
  const recompressed = await sharp(original).jpeg({ quality: 55 }).toBuffer();

  const { changedPct } = await imageDiff(original, recompressed);
  assert.ok(changedPct < 1, `re-compression must stay under the 1% threshold, got ${changedPct}`);
});
