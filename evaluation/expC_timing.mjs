/*
 * Experiment C — pipeline cost.
 *
 * Times the offline half of the LessMissed pipeline on real pages:
 *   1. full-page capture (the extension's scroll-and-stitch procedure)
 *   2. Tesseract OCR of the stitched screenshot
 *   3. region-map construction from the observed rectangles
 *   4. (optional) one Florence-2 caption, if the label service is running
 *
 * Capture time is reported twice: total wall clock, and with the mandated
 * 520 ms inter-capture spacing removed. The browser caps captureVisibleTab at
 * two calls per second, so that wait is a platform constraint rather than a
 * cost of this pipeline, and conflating the two overstates the algorithm.
 *
 * Usage:
 *   node expC_timing.mjs urls.txt [--repo /path/to/LESSMISSED] [--out resultsC.json]
 *                                 [--label-service http://127.0.0.1:8077]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { createWorker } from "tesseract.js";

const args = process.argv.slice(2);
const urlsFile = args[0];
if (!urlsFile) {
  console.error("usage: node expC_timing.mjs urls.txt [--repo PATH] [--out FILE] [--label-service URL]");
  process.exit(1);
}
const flag = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const OUT = flag("--out", "resultsC.json");
const LABEL_SERVICE = flag("--label-service", "http://127.0.0.1:8077");
const VIEWPORT = { width: 1440, height: 900 };
const CAPTURE_GAP_MS = 520;   // the extension's rate-limit spacing
const MAX_DOC_PX = 15000;     // the extension's document-height cap

const urls = fs.readFileSync(urlsFile, "utf8").split("\n").map(s => s.trim())
  .filter(s => s && !s.startsWith("#"));

const ms = () => Number(process.hrtime.bigint() / 1000000n);
const browser = await chromium.launch();
const rows = [];

for (const url of urls) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2000);

    // ---------- 1. scroll-and-stitch capture -----------------------------
    const tCap0 = ms();
    const dims = await page.evaluate((cap) => ({
      viewportHeight: window.innerHeight,
      documentHeight: Math.min(cap, Math.max(
        document.body.scrollHeight, document.documentElement.scrollHeight,
        document.body.offsetHeight, document.documentElement.offsetHeight,
        window.innerHeight)),
    }), MAX_DOC_PX);

    // suppress fixed/sticky elements, as HIDE_FIXED_ELEMENTS does
    await page.evaluate(() => {
      const s = document.createElement("style");
      s.id = "__lm_hide_fixed";
      s.textContent = "[data-lm-hide]{visibility:hidden!important}";
      document.head.appendChild(s);
      for (const el of document.querySelectorAll("*")) {
        const p = getComputedStyle(el).position;
        if (p === "fixed" || p === "sticky") el.dataset.lmHide = "1";
      }
    });

    const steps = Math.ceil(dims.documentHeight / dims.viewportHeight);
    const segments = [];
    let gapTotal = 0;
    for (let i = 0; i < steps; i++) {
      await page.evaluate(y => window.scrollTo({ top: y, behavior: "instant" }), i * dims.viewportHeight);
      const tGap = ms();
      await page.waitForTimeout(CAPTURE_GAP_MS);
      gapTotal += ms() - tGap;
      segments.push(await page.screenshot({ type: "jpeg", quality: 82 }));
    }
    await page.evaluate(() => {
      document.querySelectorAll("[data-lm-hide]").forEach(el => delete el.dataset.lmHide);
      document.getElementById("__lm_hide_fixed")?.remove();
    });
    const captureMs = ms() - tCap0;

    // stitch (the extension does this on an OffscreenCanvas; here, in-page)
    const tStitch0 = ms();
    const stitched = await page.evaluate(async ({ segs, vh, dh, vw }) => {
      const c = new OffscreenCanvas(vw, dh);
      const ctx = c.getContext("2d");
      for (let i = 0; i < segs.length; i++) {
        const blob = await (await fetch(segs[i])).blob();
        const bmp = await createImageBitmap(blob);
        const dstH = Math.min(vh, dh - i * vh);
        if (dstH > 0) {
          const srcH = Math.round(dstH * bmp.height / vh);
          ctx.drawImage(bmp, 0, 0, bmp.width, srcH, 0, i * vh, vw, dstH);
        }
        bmp.close();
      }
      const out = await c.convertToBlob({ type: "image/jpeg", quality: 0.82 });
      const buf = new Uint8Array(await out.arrayBuffer());
      let s = ""; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
      return btoa(s);
    }, {
      segs: segments.map(b => `data:image/jpeg;base64,${b.toString("base64")}`),
      vh: dims.viewportHeight, dh: dims.documentHeight, vw: VIEWPORT.width,
    });
    const stitchMs = ms() - tStitch0;
    const shotBytes = Buffer.from(stitched, "base64").length;
    const shotFile = path.join(process.cwd(), `shot_${rows.length}.jpg`);
    fs.writeFileSync(shotFile, Buffer.from(stitched, "base64"));

    // ---------- 2. OCR ----------------------------------------------------
    const tOcr0 = ms();
    const worker = await createWorker("eng");
    const { data } = await worker.recognize(shotFile);
    await worker.terminate();
    const ocrMs = ms() - tOcr0;
    const words = (data.words ?? []).filter(w => w.confidence >= 70);

    // ---------- 3. optional VLM caption ----------------------------------
    let vlmMs = null;
    try {
      const crop = fs.readFileSync(shotFile).toString("base64");
      const t0 = ms();
      const r = await fetch(`${LABEL_SERVICE}/label`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: crop, task: "<CAPTION>" }),
        signal: AbortSignal.timeout(60000),
      });
      if (r.ok) { await r.json(); vlmMs = ms() - t0; }
    } catch { /* service not running — reported as null */ }

    rows.push({
      url,
      documentHeightPx: dims.documentHeight,
      captureSteps: steps,
      captureMsTotal: captureMs,
      captureMsExcludingRateLimit: captureMs - gapTotal,
      rateLimitWaitMs: gapTotal,
      stitchMs,
      screenshotBytes: shotBytes,
      ocrMs,
      ocrWordsTotal: (data.words ?? []).length,
      ocrWordsAboveConfidence70: words.length,
      vlmCaptionMs: vlmMs,
    });
    console.log(`✓ ${url}  ${steps} steps  capture ${captureMs}ms (${captureMs - gapTotal}ms excl. rate limit)  stitch ${stitchMs}ms  OCR ${ocrMs}ms`);
  } catch (e) {
    console.error(`✗ ${url}: ${e.message}`);
    rows.push({ url, error: e.message });
  } finally {
    await page.close();
  }
}
await browser.close();

const ok = rows.filter(r => !r.error);
const med = (f) => {
  const v = ok.map(f).filter(x => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const medians = {
  pages: ok.length,
  documentHeightPx: med(r => r.documentHeightPx),
  captureMsTotal: med(r => r.captureMsTotal),
  captureMsExcludingRateLimit: med(r => r.captureMsExcludingRateLimit),
  stitchMs: med(r => r.stitchMs),
  screenshotBytes: med(r => r.screenshotBytes),
  ocrMs: med(r => r.ocrMs),
  ocrWordsAboveConfidence70: med(r => r.ocrWordsAboveConfidence70),
  vlmCaptionMs: med(r => r.vlmCaptionMs),
};
fs.writeFileSync(OUT, JSON.stringify({ viewport: VIEWPORT, medians, pages: rows }, null, 2));
console.log("\n=== MEDIANS ===");
console.log(JSON.stringify(medians, null, 2));
console.log(`\nwritten: ${OUT}`);
