// Deciding whether a page has actually changed.
//
// Two tiers, because the cheap answer is right almost all of the time:
//
//   Tier 1  hash the served HTML's structure. One HTTP request, no browser.
//           Runs daily per page. Catches copy edits, new sections, removed CTAs.
//   Tier 2  render, then compare images. Only runs when tier 1 says something
//           moved, or when the baseline is simply old.
//
// The point of the split is that capture volume tracks *change* rather than
// traffic. A page visited ten thousand times and never edited costs ten
// thousand nothing-happened HTTP requests a year and zero renders.

import crypto from "node:crypto";
import sharp from "sharp";

// The magenta the renderer paints over masked regions. Any pixel this colour in
// either image is excluded from the comparison, which is how admin-declared
// dynamic content (timestamps, cart counts, rotating heroes) stops generating
// daily false positives.
const MASK_RGB = [255, 0, 255];
const MASK_TOLERANCE = 8;

// Per-channel difference below which two pixels are "the same". Absorbs JPEG
// ringing and sub-pixel antialiasing, which are not changes anyone can see.
const PIXEL_TOLERANCE = 12;

/**
 * Structural fingerprint of a page's HTML.
 *
 * Deliberately not a hash of the bytes. Real pages carry a CSRF token, a build
 * id, a nonce and a timestamp that change on every request while the page is
 * visually identical; hashing raw HTML would report drift constantly and the
 * escalation to a real render would stop being cheap.
 *
 * What survives: the tag skeleton, and the visible text. What is dropped:
 * scripts, styles, comments, and the attribute values most likely to be
 * per-request noise.
 */
export function contentHash(html) {
  if (!html) return null;

  const normalized = String(html)
    // Script and style bodies are not content, and are where nonces live.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script/>")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style/>")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Per-request identifiers, cache-busting query strings and integrity hashes.
    .replace(/\b(nonce|csrf[-_]?token|data-csrf|integrity|data-build|data-timestamp)="[^"]*"/gi, "")
    .replace(/\b(src|href)="([^"?]*)\?[^"]*"/gi, '$1="$2"')
    // Framework-generated class and id suffixes: "css-1x2y3z", "sc-AbCdEf".
    .replace(/\b(css|sc|jsx|emotion)-[a-z0-9]{4,}\b/gi, "$1-x")
    .replace(/\s+/g, " ")
    .trim();

  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Does the served HTML actually describe what a user sees?
 *
 * For a client-rendered SPA the answer is no — the response is a near-empty
 * shell, so its hash never changes no matter what the page displays, and tier 1
 * would report "unchanged" forever. Such pages are flagged once at baseline and
 * put on a slower browser-based check instead.
 */
export function isContentHashReliable(servedHtml, renderedText) {
  const servedText = String(servedHtml ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const rendered = String(renderedText ?? "").trim();
  if (rendered.length < 200) return true; // too little either way to judge
  return servedText.length >= rendered.length * 0.3;
}

/**
 * Perceptual hash (64-bit dHash) of an image.
 *
 * Compares each pixel to its right-hand neighbour in a 9x8 greyscale
 * reduction, so the hash encodes gradients rather than absolute values. That
 * makes it stable across re-encoding and brightness shifts, where a byte hash
 * would change for reasons nobody can see.
 */
export async function perceptualHash(buffer) {
  const { data } = await sharp(buffer)
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col];
      const right = data[row * 9 + col + 1];
      bits += left > right ? "1" : "0";
    }
  }

  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/** Hamming distance between two dHashes. 0 identical, 64 maximally different. */
export function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * Compare two captures pixel by pixel, ignoring masked areas.
 *
 * Returns the share of comparable pixels that changed, plus bounding boxes of
 * where, so the dashboard can show an admin *what* moved rather than only that
 * something did.
 *
 * A height change is reported rather than papered over: once a page reflows,
 * comparing row N of one image to row N of the other is meaningless below the
 * first inserted element, so the comparison is limited to the overlapping
 * region and flagged as lower confidence.
 */
export async function imageDiff(previousBuffer, nextBuffer, { gridSize = 32 } = {}) {
  const [prevMeta, nextMeta] = await Promise.all([
    sharp(previousBuffer).metadata(),
    sharp(nextBuffer).metadata(),
  ]);

  const width = Math.min(prevMeta.width, nextMeta.width);
  const height = Math.min(prevMeta.height, nextMeta.height);
  const heightChanged = prevMeta.height !== nextMeta.height;
  const widthChanged = prevMeta.width !== nextMeta.width;

  if (!width || !height) {
    return { changedPct: 100, changedBoxes: [], heightChanged, widthChanged };
  }

  const extract = (buffer) =>
    sharp(buffer)
      .extract({ left: 0, top: 0, width, height })
      .removeAlpha()
      .raw()
      .toBuffer();

  const [prev, next] = await Promise.all([extract(previousBuffer), extract(nextBuffer)]);

  // Accumulate changes per grid cell rather than per pixel, so the result is a
  // handful of boxes an admin can look at instead of a million coordinates.
  const cols = Math.ceil(width / gridSize);
  const rows = Math.ceil(height / gridSize);
  const cells = new Uint32Array(cols * rows);

  let comparable = 0;
  let changed = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;

      if (isMasked(prev, i) || isMasked(next, i)) continue;
      comparable++;

      const delta =
        Math.abs(prev[i] - next[i]) +
        Math.abs(prev[i + 1] - next[i + 1]) +
        Math.abs(prev[i + 2] - next[i + 2]);

      if (delta > PIXEL_TOLERANCE * 3) {
        changed++;
        cells[Math.floor(y / gridSize) * cols + Math.floor(x / gridSize)]++;
      }
    }
  }

  const changedPct = comparable ? (changed / comparable) * 100 : 0;

  // A cell counts as changed only if a real share of it moved; one stray
  // antialiased edge should not produce a box.
  const cellThreshold = gridSize * gridSize * 0.15;
  const changedBoxes = mergeBoxes(
    cells,
    cols,
    rows,
    gridSize,
    cellThreshold,
    width,
    height
  );

  return { changedPct, changedBoxes, heightChanged, widthChanged };
}

function isMasked(data, i) {
  return (
    Math.abs(data[i] - MASK_RGB[0]) <= MASK_TOLERANCE &&
    Math.abs(data[i + 1] - MASK_RGB[1]) <= MASK_TOLERANCE &&
    Math.abs(data[i + 2] - MASK_RGB[2]) <= MASK_TOLERANCE
  );
}

/**
 * Collapse changed grid cells into a small number of rectangles.
 *
 * Row-runs merged vertically: good enough to point at "the hero" or "the third
 * pricing card", which is all the dashboard needs, and far cheaper than proper
 * connected-component labelling.
 */
function mergeBoxes(cells, cols, rows, gridSize, threshold, maxWidth, maxHeight) {
  const runs = [];

  for (let row = 0; row < rows; row++) {
    let start = -1;
    for (let col = 0; col <= cols; col++) {
      const hot = col < cols && cells[row * cols + col] >= threshold;
      if (hot && start === -1) start = col;
      if (!hot && start !== -1) {
        runs.push({ row, from: start, to: col - 1 });
        start = -1;
      }
    }
  }

  const boxes = [];
  for (const run of runs) {
    const previous = boxes.find(
      (box) =>
        box.rowEnd === run.row - 1 &&
        run.from <= box.colEnd &&
        run.to >= box.colStart
    );
    if (previous) {
      previous.rowEnd = run.row;
      previous.colStart = Math.min(previous.colStart, run.from);
      previous.colEnd = Math.max(previous.colEnd, run.to);
    } else {
      boxes.push({ rowStart: run.row, rowEnd: run.row, colStart: run.from, colEnd: run.to });
    }
  }

  return boxes
    .map((box) => ({
      x: box.colStart * gridSize,
      y: box.rowStart * gridSize,
      w: Math.min((box.colEnd - box.colStart + 1) * gridSize, maxWidth - box.colStart * gridSize),
      h: Math.min((box.rowEnd - box.rowStart + 1) * gridSize, maxHeight - box.rowStart * gridSize),
    }))
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, 25);
}
