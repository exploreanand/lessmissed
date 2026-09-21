/*
 * Experiments A and B — selector collision and labelling-ladder coverage,
 * measured on real pages.
 *
 * A: how often does one DOM selector cover several distinct components, and
 *    do positional keys / region boxes separate them?
 * B: which rung of the labelling ladder names each component?
 *
 * Both measure the LessMissed code itself: the element resolvers are copied
 * verbatim from contentScript.ts, and the label comes from the project's own
 * describeElement.js, imported from the repo.
 *
 * Usage:
 *   node expAB_identity.mjs urls.txt [--repo /path/to/LESSMISSED] [--out resultsAB.json]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const urlsFile = args[0];
if (!urlsFile) {
  console.error("usage: node expAB_identity.mjs urls.txt [--repo PATH] [--out FILE]");
  process.exit(1);
}
const flag = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const REPO = path.resolve(flag("--repo", path.join(process.cwd(), "..")));
const OUT = flag("--out", "resultsAB.json");
const VIEWPORT = { width: 1440, height: 900 };
const MIN_PX = 24; // matches MIN_REGION_PX in regionMap.js

const describeMod = path.join(REPO, "Web-App/lessmissed/lib/insights/describeElement.js");
if (!fs.existsSync(describeMod)) {
  console.error(`describeElement.js not found under --repo (${describeMod}).`);
  process.exit(1);
}
const { describeElement } = await import(pathToFileURL(describeMod).href);

const urls = fs.readFileSync(urlsFile, "utf8").split("\n").map(s => s.trim())
  .filter(s => s && !s.startsWith("#"));

const browser = await chromium.launch();
const pages = [];

for (const url of urls) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2500);           // let lazy content settle
    await page.evaluate(async () => {          // trigger lazy loading
      for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 220));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(800);

    const comps = await page.evaluate((MIN_PX) => {
      // ---- verbatim from contentScript.ts --------------------------------
      function resolveElementId(el) {
        if (!el) return "";
        if (el.id) return `#${el.id}`;
        if (el.dataset?.lessmissedId) return el.dataset.lessmissedId;
        if (el.dataset?.id) return el.dataset.id;
        const cls = el.classList[0] ? `.${el.classList[0]}` : "";
        return `${el.tagName.toLowerCase()}${cls}`;
      }
      function resolveElementKey(el) {
        if (!el) return "";
        const parts = [];
        let node = el;
        for (let i = 0; i < 4 && node && node !== document.body; i++) {
          if (node.id) { parts.unshift(`#${node.id}`); break; }
          const tag = node.tagName.toLowerCase();
          const parent = node.parentElement;
          if (parent) {
            const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
            const idx = sameTag.indexOf(node);
            parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${idx + 1})` : tag);
          } else parts.unshift(tag);
          node = parent;
        }
        return parts.join(">");
      }
      // --------------------------------------------------------------------

      const ATOMIC = new Set(["IMG","BUTTON","A","INPUT","SELECT","TEXTAREA","VIDEO","SVG","PICTURE"]);

      function ownText(el) {
        let t = "";
        for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
        return t.replace(/\s+/g, " ").trim();
      }

      // A "component" is something a user could fixate as one thing: visible,
      // at least MIN_PX on a side, and either an atomic control/media element,
      // or a node carrying its own text, or a node painting its own image.
      const candidates = [];
      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
        const r = el.getBoundingClientRect();
        if (r.width < MIN_PX || r.height < MIN_PX) continue;
        const atomic = ATOMIC.has(el.tagName);
        const texty = ownText(el).length >= 2;
        const painted = cs.backgroundImage && cs.backgroundImage !== "none";
        if (!atomic && !texty && !painted) continue;
        candidates.push(el);
      }
      // keep the leaf-most qualifying node so containers are not double-counted
      const set = new Set(candidates);
      const comps = candidates.filter(el => ![...el.querySelectorAll("*")].some(d => set.has(d)));

      return comps.map(el => {
        const r = el.getBoundingClientRect();
        const img = el;
        return {
          selectorKey: resolveElementId(el),
          positionalKey: resolveElementKey(el),
          rect: {
            x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY),
            w: Math.round(r.width), h: Math.round(r.height),
          },
          // shaped exactly as contentScript.describeTarget sends it
          element_id: resolveElementId(el),
          element_tag: el.tagName.toLowerCase(),
          element_text: (el.innerText ?? "").trim().slice(0, 80),
          element_alt: (img.alt ?? "").trim().slice(0, 80),
          element_aria: (el.getAttribute("aria-label") ?? "").trim().slice(0, 80),
          element_title: (el.getAttribute("title") ?? "").trim().slice(0, 80),
          element_src: (img.currentSrc || img.src || "").split("?")[0].split("/").pop()?.slice(0, 80) ?? "",
        };
      });
    }, MIN_PX);

    // ---- Experiment A: identity collision ---------------------------------
    const bucket = (arr, key) => arr.reduce((m, c) => {
      (m[c[key]] ||= []).push(c); return m;
    }, {});
    const bySelector = bucket(comps, "selectorKey");
    const byPositional = bucket(comps, "positionalKey");
    const byBox = bucket(
      comps.map(c => ({ ...c, boxKey: `${c.rect.x},${c.rect.y},${c.rect.w},${c.rect.h}` })),
      "boxKey"
    );
    const collided = Object.values(bySelector).filter(v => v.length > 1);
    const worst = Object.entries(bySelector).sort((a, b) => b[1].length - a[1].length)[0];

    // ---- Experiment B: which rung names it --------------------------------
    const rungs = {};
    for (const c of comps) {
      const { source } = describeElement(c);
      rungs[source] = (rungs[source] || 0) + 1;
    }

    const n = comps.length;
    pages.push({
      url,
      components: n,
      distinctSelectors: Object.keys(bySelector).length,
      distinctPositionalKeys: Object.keys(byPositional).length,
      distinctBoxes: Object.keys(byBox).length,
      componentsSharingASelector: collided.reduce((a, v) => a + v.length, 0),
      selectorCollisionRate: n ? +(collided.reduce((a, v) => a + v.length, 0) / n).toFixed(4) : 0,
      largestSelectorBucket: worst ? { selector: worst[0], components: worst[1].length } : null,
      labelSource: rungs,
      needsPixelEvidence: rungs.selector ?? 0, // fell through every DOM rung
    });
    console.log(`✓ ${url}  components=${n}  selectors=${Object.keys(bySelector).length}  collision=${(100*(pages.at(-1).selectorCollisionRate)).toFixed(1)}%`);
  } catch (e) {
    console.error(`✗ ${url}: ${e.message}`);
    pages.push({ url, error: e.message });
  } finally {
    await page.close();
  }
}
await browser.close();

const ok = pages.filter(p => !p.error);
const sum = (f) => ok.reduce((a, p) => a + f(p), 0);
const allRungs = {};
for (const p of ok) for (const [k, v] of Object.entries(p.labelSource)) allRungs[k] = (allRungs[k] || 0) + v;

const totals = {
  pages: ok.length,
  components: sum(p => p.components),
  distinctSelectors: sum(p => p.distinctSelectors),
  distinctPositionalKeys: sum(p => p.distinctPositionalKeys),
  distinctBoxes: sum(p => p.distinctBoxes),
  componentsSharingASelector: sum(p => p.componentsSharingASelector),
  overallSelectorCollisionRate:
    +(sum(p => p.componentsSharingASelector) / Math.max(1, sum(p => p.components))).toFixed(4),
  labelSource: allRungs,
};
fs.writeFileSync(OUT, JSON.stringify({ viewport: VIEWPORT, minPx: MIN_PX, totals, pages }, null, 2));
console.log("\n=== TOTALS ===");
console.log(JSON.stringify(totals, null, 2));
console.log(`\nwritten: ${OUT}`);
