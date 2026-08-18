// OCR the page screenshot and expose the text with its coordinates.
//
// This is the rung of the labelling ladder that finally names images. On a
// commerce page the components a brand cares about carry their text inside the
// pixels — "FLAT ₹300 OFF", "U.S. POLO ASSN. Up To 50% Off", "10% Instant
// Discount" — so the DOM offers nothing (an <img> has no textContent) while the
// screenshot offers everything.
//
// Word boxes, not line boxes: Tesseract merges a row of side-by-side tiles into
// one full-width "line", which would smear six different components into a
// single label. Words carry their own coordinates, so we re-group them
// ourselves and keep neighbouring components apart.
//
// Runs offline, once per screenshot version, never in a request path.
// tesseract.js is pure WASM: no system Tesseract, no Python, no API key.

import { createWorker } from "tesseract.js";

// Small text over photography reliably OCRs as garbage ("sosoxor" for
// "50-80% OFF"). Only trust words the engine is confident about — a missing
// label is recoverable by the VLM rung, a wrong one silently misinforms.
const MIN_WORD_CONFIDENCE = 70;

// Grouping thresholds, in px, tuned against a 1440-wide desktop screenshot.
const SAME_LINE_TOLERANCE = 18; // vertical drift still counted as one line
// Generous, because a low-confidence word dropped from the middle of a phrase
// ("FLAT ₹300 OFF" loses "₹300") leaves a hole we still want to bridge.
const WORD_GAP = 130;           // horizontal gap that still joins two words

// Components extend well past their text, so a fixation lands near a caption
// rather than inside it.
const PROXIMITY_PX = 160;

function isMeaningful(text) {
  const t = (text ?? "").trim();
  if (t.length < 2) return false;
  // Percentages and prices are meaningful at any length. Plain letters need
  // three or more: two-letter fragments like "aN" are texture read as glyphs.
  if (/\d\s*%/.test(t) || /[₹$€£]\s*\d/.test(t)) return true;
  return /[a-z]{3,}/i.test(t);
}

function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const r = Math.max(a.x + a.w, b.x + b.w);
  const bt = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: r - x, h: bt - y };
}

function toBox(b) {
  return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

/**
 * Run OCR over a full-page screenshot and return text phrases with boxes.
 *
 * @param {Buffer|string} image buffer or path to the stitched screenshot
 * @returns {Promise<Array<{text:string, confidence:number, bbox:{x,y,w,h}}>>}
 *          phrases in document coordinates, aligned to the screenshot
 */
export async function ocrScreenshot(image) {
  const worker = await createWorker("eng");
  let words;
  try {
    const { data } = await worker.recognize(image, {}, { blocks: true });
    // Support both the flat and the block-nested shapes across tesseract.js
    // versions, so a minor upgrade can't silently yield zero words.
    words =
      data.words ??
      (data.blocks ?? []).flatMap((b) =>
        (b.paragraphs ?? []).flatMap((p) =>
          (p.lines ?? []).flatMap((l) => l.words ?? [])
        )
      );
  } finally {
    await worker.terminate();
  }

  const kept = words
    .filter((w) => (w.confidence ?? 0) >= MIN_WORD_CONFIDENCE && isMeaningful(w.text))
    .map((w) => ({ text: w.text.trim(), confidence: w.confidence, bbox: toBox(w.bbox) }));

  return groupWords(kept);
}

// Re-group loose words into phrases: same visual line, small horizontal gap.
function groupWords(words) {
  // Sort by visual line band, then left to right. Sorting on raw y would put a
  // word 1px higher ahead of the word that visually precedes it, splitting
  // "SHOP BY CATEGORY" into two phrases in the wrong order.
  const band = (w) => Math.round(w.bbox.y / SAME_LINE_TOLERANCE);
  const sorted = [...words].sort(
    (a, b) => band(a) - band(b) || a.bbox.x - b.bbox.x
  );

  const phrases = [];
  for (const w of sorted) {
    const last = phrases[phrases.length - 1];
    const sameLine =
      last &&
      Math.abs(w.bbox.y - last.bbox.y) <= SAME_LINE_TOLERANCE &&
      w.bbox.x - (last.bbox.x + last.bbox.w) <= WORD_GAP &&
      w.bbox.x >= last.bbox.x;

    if (sameLine) {
      last.text += ` ${w.text}`;
      last.bbox = union(last.bbox, w.bbox);
      last._conf.push(w.confidence);
    } else {
      phrases.push({ text: w.text, bbox: w.bbox, _conf: [w.confidence] });
    }
  }

  return phrases
    .map((p) => ({
      text: p.text.replace(/\s+/g, " ").trim(),
      confidence: Math.round(p._conf.reduce((s, c) => s + c, 0) / p._conf.length),
      bbox: p.bbox,
    }))
    .filter((p) => isMeaningful(p.text));
}

function centerOf(b) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/**
 * Find the OCR phrase that best explains a point on the page.
 *
 * Containment wins outright; otherwise the nearest phrase within range is used,
 * with horizontal distance penalised — text far to the side belongs to another
 * column, whereas text directly above is usually the caption for this thing.
 */
export function textNearPoint(phrases, x, y) {
  let best = null;
  let bestScore = Infinity;

  for (const p of phrases) {
    const b = p.bbox;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return p;

    const c = centerOf(b);
    const dx = Math.abs(x - c.x);
    const dy = Math.abs(y - c.y);
    // Prefer short, title-like text. Without this a long run of body copy
    // sitting near an image wins on distance alone and the region ends up
    // labelled with a sentence fragment.
    const lengthPenalty = Math.max(0, p.text.length - 30) * 3;
    // Text starting mid-sentence is a fragment of a paragraph, not a caption.
    const fragmentPenalty = /^[a-z]/.test(p.text) ? 120 : 0;
    const score = dy + dx * 1.8 + lengthPenalty + fragmentPenalty;
    if (dy <= PROXIMITY_PX && dx <= PROXIMITY_PX * 2 && score < bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best;
}
