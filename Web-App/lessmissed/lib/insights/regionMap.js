// Screenshot regions: the unit attention is reported against.
//
// Reporting attention per DOM selector is misleading on real sites. On the
// Myntra home page a single selector, "img.image-image", covers the hero
// carousel, the promo strip and all twelve category tiles — 488 gaze samples
// collapsed into one meaningless row. Regions fix that: a fixation is
// attributed by its document coordinates, so those three components separate
// even though the DOM calls them the same thing.
//
// Fixation center_x/center_y are absolute document pixels that align to the
// stitched screenshot with no scaling (SRS §11.6) — the same assumption the
// gaze heatmap and firstFixation.js already make.

// Relative (with extension) so this module also loads under plain Node in the
// backfill/labelling scripts, not just through the Next bundler.
import { describeElement, isInstrumentElement, truncateLabel } from "./describeElement.js";
import { textNearPoint } from "./ocrPage.js";

// The labelling ladder, cheapest first. DOM semantics are trusted over pixels
// because an author-written alt/heading beats anything inferred; OCR only runs
// where the DOM gave us nothing, which on a commerce page is exactly the
// images. Anything still unnamed is left for the VLM rung.
function labelFor(fixation, ocrPhrases) {
  const described = describeElement(fixation);
  if (described.source !== "selector") return described;

  if (ocrPhrases?.length && fixation.center_x != null) {
    const hit = textNearPoint(ocrPhrases, fixation.center_x, fixation.center_y);
    if (hit) {
      const kind = (fixation.element_tag ?? "").toLowerCase() === "img" ? "Image" : null;
      return {
        label: truncateLabel(kind ? `${kind}: ${hit.text}` : hit.text),
        source: "ocr",
        instrument: false,
      };
    }
  }

  return described;
}

// Two boxes are the same component if they overlap this much of the smaller one.
const MERGE_IOU = 0.6;
// Elements thinner than this are dividers/spacers, not components worth naming.
const MIN_REGION_PX = 24;

function area(b) {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

function intersection(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bt = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || bt <= y) return 0;
  return (r - x) * (bt - y);
}

// Overlap relative to the smaller box, so a small tile fully inside a big
// container counts as contained rather than as a weak match.
function overlapRatio(a, b) {
  const inter = intersection(a, b);
  if (!inter) return 0;
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 ? inter / smaller : 0;
}

export function containsPoint(bbox, x, y) {
  return x >= bbox.x && x < bbox.x + bbox.w && y >= bbox.y && y < bbox.y + bbox.h;
}

/**
 * Attribute a point to a region. Smallest matching region wins so a tile beats
 * the section that contains it — the specific label is always more useful.
 */
export function resolveRegion(regions, x, y) {
  let best = null;
  for (const r of regions) {
    if (!r?.bbox) continue;
    if (!containsPoint(r.bbox, x, y)) continue;
    if (!best || area(r.bbox) < area(best.bbox)) best = r;
  }
  return best;
}

function slugifyId(label, index) {
  const base = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `r${index}-${base || "region"}`;
}

// Rough component type, used to group rows in the UI. Deliberately simple —
// the label carries the meaning, this is only for sorting and iconography.
function classify({ tag, label, bbox }, pageWidth, foldHeight) {
  const t = (tag ?? "").toLowerCase();
  const l = label.toLowerCase();
  if (t === "a" || t === "button" || /shop now|buy|add to|sign up|log in|explore/.test(l)) return "cta";
  if (t === "nav" || /menu|navigation/.test(l)) return "nav";
  if (t === "footer" || (foldHeight && bbox.y > foldHeight * 4)) return "footer";
  if (t === "input" || t === "select" || t === "textarea" || t === "form") return "form";
  if (pageWidth && bbox.w >= pageWidth * 0.6 && bbox.y < (foldHeight ?? Infinity)) return "hero";
  if (/off|discount|sale|offer|%/.test(l)) return "promo";
  if (t === "img") return "media";
  if (/^heading/.test(l)) return "heading";
  return "content";
}

/**
 * Build regions from element bounding boxes recorded on fixations.
 *
 * This is the exact path — it needs the extension to send element_rect. For
 * historical sessions no rect exists, so callers should fall back to
 * buildRegionsFromClusters().
 *
 * @param {Array} fixations lean Fixation docs for one page
 * @param {{width:number, fold:number}} page screenshot dimensions
 */
export function buildRegionsFromRects(fixations, page = {}, ocrPhrases = []) {
  const candidates = [];

  for (const f of fixations) {
    const r = f.element_rect;
    if (!r || r.x == null || r.y == null || !r.w || !r.h) continue;
    if (r.w < MIN_REGION_PX || r.h < MIN_REGION_PX) continue;
    if (isInstrumentElement(f.element_id)) continue;

    const bbox = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
    const existing = candidates.find((c) => overlapRatio(c.bbox, bbox) >= MERGE_IOU);
    if (existing) {
      existing.weight += 1;
      // Keep the richer description if this sample carries one.
      if (existing.described.source === "selector") {
        const d = labelFor(f, ocrPhrases);
        if (d.source !== "selector") {
          existing.described = d;
          existing.tag = f.element_tag;
        }
      }
      continue;
    }

    candidates.push({
      bbox,
      tag: f.element_tag,
      described: labelFor(f, ocrPhrases),
      weight: 1,
    });
  }

  return candidates
    .sort((a, b) => b.weight - a.weight)
    .map((c, i) => ({
      region_id: slugifyId(c.described.label, i),
      label: c.described.label,
      category: classify({ tag: c.tag, label: c.described.label, bbox: c.bbox }, page.width, page.fold),
      bbox: c.bbox,
      source: c.described.source,
      confidence: c.described.source === "selector" ? 0.2 : 0.8,
    }));
}

/**
 * Fallback for historical data: no element rects exist, so infer components by
 * clustering fixation coordinates into a grid of occupied cells and merging
 * adjacent ones. Coarser than real boxes, but it still separates the hero from
 * the tiles, which is the whole point.
 *
 * @param {Array} fixations lean Fixation docs for one page
 * @param {{width:number, docHeight:number, cell?:number}} page
 */
export function buildRegionsFromClusters(fixations, page = {}, ocrPhrases = []) {
  const width = page.width || 1440;
  // How far apart two fixations sharing a label can be and still be treated as
  // the same component. Roughly one viewport-height band.
  const SPLIT_DISTANCE = page.splitDistance || 400;
  const PAD = 40;

  // Group by label first, then split each label into spatially separate
  // clusters. Grouping this way rather than on a fixed grid means one component
  // yields one region: a tall banner does not fragment into rows, and a label
  // that genuinely appears twice on the page (a repeated "Shop Now") still
  // produces two regions.
  const byLabel = new Map();
  for (const f of fixations) {
    if (f.center_x == null || f.center_y == null) continue;
    if (isInstrumentElement(f.element_id)) continue;
    const d = labelFor(f, ocrPhrases);
    const entry = byLabel.get(d.label) ?? { described: d, tag: f.element_tag, points: [] };
    // Prefer the richest source seen for this label.
    if (entry.described.source === "selector" && d.source !== "selector") {
      entry.described = d;
      entry.tag = f.element_tag;
    }
    entry.points.push({ x: f.center_x, y: f.center_y });
    byLabel.set(d.label, entry);
  }

  const regions = [];
  for (const entry of byLabel.values()) {
    // Split vertically separated occurrences of the same label.
    const pts = [...entry.points].sort((a, b) => a.y - b.y);
    let cluster = [pts[0]];
    const flush = () => {
      const xs = cluster.map((p) => p.x);
      const ys = cluster.map((p) => p.y);
      const x = Math.max(0, Math.min(...xs) - PAD);
      const y = Math.max(0, Math.min(...ys) - PAD);
      regions.push({
        bbox: {
          x,
          y,
          w: Math.min(width - x, Math.max(...xs) - Math.min(...xs) + PAD * 2),
          h: Math.max(...ys) - Math.min(...ys) + PAD * 2,
        },
        described: entry.described,
        tag: entry.tag,
        weight: cluster.length,
      });
    };

    for (let i = 1; i < pts.length; i++) {
      if (pts[i].y - pts[i - 1].y > SPLIT_DISTANCE) {
        flush();
        cluster = [pts[i]];
      } else {
        cluster.push(pts[i]);
      }
    }
    flush();
  }

  return regions
    .sort((a, b) => b.weight - a.weight)
    .map((r, i) => ({
      region_id: slugifyId(r.described.label, i),
      label: r.described.label,
      category: classify({ tag: r.tag, label: r.described.label, bbox: r.bbox }, width, page.fold),
      bbox: r.bbox,
      source: r.described.source,
      confidence: r.described.source === "selector" ? 0.15 : 0.6,
    }));
}
