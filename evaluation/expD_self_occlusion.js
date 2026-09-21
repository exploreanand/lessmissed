/*
 * Experiment D — instrument self-occlusion.
 *
 * Measures how often the tracker's own prediction dot intercepts the hit test
 * that is supposed to identify the page element under the gaze point, and
 * whether the LessMissed resolver recovers the correct element.
 *
 * The gaze dot is reproduced with the exact styles WebGazer applies
 * (position:fixed, z-index 99999, 10x10 px, opacity .7, no pointer-events
 * override) as read from the WebGazer build bundled in the extension.
 *
 * The resolver functions are copied verbatim from
 *   lessmissed_extension/src/contentScript/contentScript.ts
 *
 * Ground truth for each sample point is elementFromPoint evaluated with the
 * dot removed from the document: the element the page would report if the
 * instrument were not there.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const PAGE = "file://" + path.resolve(__dirname, "fixture.html");
const VIEWPORT = { width: 1440, height: 900 };
const STEP = 20; // sample grid pitch, px

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(PAGE);

  const result = await page.evaluate((step) => {
    // ---- verbatim from contentScript.ts -----------------------------------
    const OWN_NODE_IDS = new Set([
      "webgazerGazeDot", "webgazerFaceOverlay", "webgazerVideoFeed",
    ]);
    function isOwnNode(el) {
      if (!el) return false;
      const id = el.id ?? "";
      return OWN_NODE_IDS.has(id) || id.startsWith("__lm_");
    }
    function pageElementFromPoint(x, y) {
      const stack = document.elementsFromPoint(x, y);
      for (const el of stack) if (!isOwnNode(el)) return el;
      return null;
    }
    function resolveElementId(el) {
      if (!el) return "";
      if (el.id) return `#${el.id}`;
      const html = el;
      if (html.dataset?.lessmissedId) return html.dataset.lessmissedId;
      if (html.dataset?.id) return html.dataset.id;
      const cls = el.classList[0] ? `.${el.classList[0]}` : "";
      return `${el.tagName.toLowerCase()}${cls}`;
    }
    // -----------------------------------------------------------------------

    // WebGazer's dot, styled exactly as the library does.
    const dot = document.createElement("div");
    dot.id = "webgazerGazeDot";
    dot.style.display = "block";
    dot.style.position = "fixed";
    dot.style.zIndex = 99999;
    dot.style.left = "-5px";
    dot.style.top = "-5px";
    dot.style.background = "red";
    dot.style.borderRadius = "100%";
    dot.style.opacity = "0.7";
    dot.style.width = "10px";
    dot.style.height = "10px";

    const pts = [];
    for (let y = step / 2; y < window.innerHeight; y += step)
      for (let x = step / 2; x < window.innerWidth; x += step) pts.push([x, y]);

    let naiveOnInstrument = 0, lmOnInstrument = 0;
    let naiveMatchesTruth = 0, lmMatchesTruth = 0, resolvable = 0;
    const naiveRanking = {}, lmRanking = {}, truthRanking = {};
    const bump = (m, k) => { m[k] = (m[k] || 0) + 1; };

    for (const [x, y] of pts) {
      // ground truth: no instrument in the document
      dot.remove();
      const truth = document.elementFromPoint(x, y);
      if (!truth) continue;
      resolvable++;
      const truthId = resolveElementId(truth);
      bump(truthRanking, truthId);

      // instrument present, following the gaze point as WebGazer does
      document.body.appendChild(dot);
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;

      const naive = document.elementFromPoint(x, y);
      const lm = pageElementFromPoint(x, y);

      const naiveId = resolveElementId(naive);
      const lmId = resolveElementId(lm);
      bump(naiveRanking, naiveId);
      bump(lmRanking, lmId);

      if (naive === dot) naiveOnInstrument++;
      if (lm === dot) lmOnInstrument++;
      if (naive === truth) naiveMatchesTruth++;
      if (lm === truth) lmMatchesTruth++;
    }
    dot.remove();

    const top = (m) =>
      Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([k, v]) => ({ element: k, samples: v }));

    return {
      sampled: pts.length,
      resolvable,
      naiveOnInstrument, lmOnInstrument,
      naiveMatchesTruth, lmMatchesTruth,
      distinctTruth: Object.keys(truthRanking).length,
      distinctNaive: Object.keys(naiveRanking).length,
      distinctLm: Object.keys(lmRanking).length,
      topTruth: top(truthRanking),
      topNaive: top(naiveRanking),
      topLm: top(lmRanking),
    };
  }, STEP);

  // --- calibration overlay: does the same client-side test cover it? -------
  const calib = await page.evaluate(() => {
    const OWN_NODE_IDS = new Set([
      "webgazerGazeDot", "webgazerFaceOverlay", "webgazerVideoFeed",
    ]);
    const isOwnNode = (el) =>
      !!el && (OWN_NODE_IDS.has(el.id ?? "") || (el.id ?? "").startsWith("__lm_"));
    // server-side test, verbatim from lib/insights/describeElement.js
    const INSTRUMENT_IDS = new Set(["#webgazerGazeDot", "#webgazerFaceOverlay", "#webgazerVideoFeed"]);
    const INSTRUMENT_PREFIXES = ["#webgazer", "#__lm_", ".__lm_"];
    const resolveElementId = (el) => {
      if (!el) return "";
      if (el.id) return `#${el.id}`;
      const cls = el.classList[0] ? `.${el.classList[0]}` : "";
      return `${el.tagName.toLowerCase()}${cls}`;
    };
    const isOverlayElement = (id) =>
      !!id && (INSTRUMENT_IDS.has(id) || INSTRUMENT_PREFIXES.some((p) => id.startsWith(p)));

    // the calibration overlay exactly as contentScript.startCalibration builds it
    const overlay = document.createElement("div");
    overlay.id = "webgazer-calibration-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.75);pointer-events:all;";
    document.body.appendChild(overlay);

    const hit = document.elementsFromPoint(700, 400)[0];
    const out = {
      topOfStack: resolveElementId(hit),
      clientSideTestCatchesIt: isOwnNode(hit),
      serverSideTestCatchesIt: isOverlayElement(resolveElementId(hit)),
    };
    overlay.remove();
    return out;
  });

  await browser.close();

  const pct = (n, d) => ((100 * n) / d).toFixed(1);
  const out = {
    viewport: VIEWPORT,
    gridPitchPx: STEP,
    ...result,
    naiveMisattributionPct: pct(result.naiveOnInstrument, result.resolvable),
    lmMisattributionPct: pct(result.lmOnInstrument, result.resolvable),
    naiveAgreementPct: pct(result.naiveMatchesTruth, result.resolvable),
    lmAgreementPct: pct(result.lmMatchesTruth, result.resolvable),
    calibrationOverlay: calib,
  };
  fs.writeFileSync(path.join(__dirname, "expD_result.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})();
