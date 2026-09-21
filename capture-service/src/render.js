// Turning a URL into a deterministic, full-page image.
//
// This module is the seam that replaces `captureFullPage` in the extension's
// service worker. That function scrolled the page in viewport-sized steps,
// called chrome.tabs.captureVisibleTab once per step at a mandated 520 ms
// spacing, and stitched the JPEGs onto a canvas by hand. Every failure mode it
// had came from that shape: seams where adjacent bands disagreed, a document
// height measured once before any lazy content loaded, a hard truncation at
// 15000 px reported as if it were the real height, and DPR inferred from bitmap
// dimensions rather than known.
//
// Playwright's `fullPage` screenshot removes all of it at once. One call, one
// image, no scroll loop, no rate limit, no stitching, no DPR arithmetic.
// What remains is the genuinely hard part, which the old code barely attempted:
// making the page *stop changing* before the shutter opens.

import { chromium } from "playwright";
import sharp from "sharp";
import { profileFor } from "../../Web-App/lessmissed/lib/capture/breakpoints.js";
import { assertSafeUrl, isBlockedLiteralHost, UnsafeUrlError } from "../../Web-App/lessmissed/lib/capture/urlSafety.js";
import { config } from "./config.js";

// Third-party noise that changes on every load and is never part of the page's
// own design. Blocked at the network layer rather than hidden after paint:
// cheaper, and it also removes the layout shift these cause when they arrive.
const BLOCKED_HOSTS = [
  "googletagmanager.com", "google-analytics.com", "analytics.google.com",
  "doubleclick.net", "googlesyndication.com", "googleadservices.com",
  "facebook.net", "facebook.com/tr", "connect.facebook.net",
  "hotjar.com", "fullstory.com", "mouseflow.com", "clarity.ms",
  "segment.com", "segment.io", "mixpanel.com", "amplitude.com",
  "intercom.io", "intercomcdn.com", "drift.com", "crisp.chat",
  "zdassets.com", "zendesk.com", "livechatinc.com", "tawk.to",
  "optimizely.com", "vwo.com", "criteo.com", "taboola.com", "outbrain.com",
];

// Consent walls, in rough order of market share. These are photographed instead
// of the page if they are not dismissed, and they are the single most common
// reason a baseline looks wrong to an admin.
const CONSENT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  "button#didomi-notice-agree-button",
  ".didomi-continue-without-agreeing",
  "#truste-consent-button",
  "button[aria-label='Accept all']",
  "button[aria-label='Accept cookies']",
  "[data-testid='uc-accept-all-button']",
  ".cc-btn.cc-allow",
  "#hs-eu-confirmation-button",
];

// Most consent walls are not from a known vendor — they are a div someone wrote
// with Tailwind and a button that says "Accept All", carrying no id, no
// aria-label and no test id. No selector list reaches those, so fall back to
// matching the button by its accessible name.
//
// The phrases are deliberately specific. A bare /accept/ would also click
// "Accept terms" in a signup form or "Accept invitation" on a dashboard, and
// clicking the wrong button changes what we photograph.
const CONSENT_TEXTS = [
  /^accept all( cookies)?$/i,
  /^allow all( cookies)?$/i,
  /^accept( cookies)?$/i,
  /^i agree$/i,
  /^agree( and close)?$/i,
  /^got it$/i,
  /^understood$/i,
  /^ok, got it$/i,
];

/** One Chromium process, many contexts. Launching per job would dominate cost. */
export class BrowserPool {
  constructor() {
    this.browser = null;
  }

  async get() {
    if (this.browser?.isConnected()) return this.browser;
    this.browser = await chromium.launch({
      args: [
        // The default /dev/shm in a container is 64 MB, which Chromium exhausts
        // on large pages and then crashes in ways that look like render bugs.
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--hide-scrollbars",
        "--mute-audio",
      ],
    });
    return this.browser;
  }

  async close() {
    if (this.browser?.isConnected()) await this.browser.close();
    this.browser = null;
  }
}

/**
 * Render one page.
 *
 * @param {object} args
 * @param {BrowserPool} args.pool
 * @param {string} args.url
 * @param {string} args.breakpoint
 * @param {string[]} [args.maskSelectors]
 * @param {string[]} [args.dismissSelectors]
 * @param {string} [args.expectedHostname]
 * @param {() => void} [args.onProgress] called between phases, to heartbeat the lease
 * @returns {Promise<{ buffer: Buffer, thumbnail: Buffer, viewportWidth: number,
 *   viewportHeight: number, documentHeight: number, imageWidth: number,
 *   imageHeight: number, deviceScaleFactor: number, truncated: boolean,
 *   html: string, finalUrl: string, durationMs: number }>}
 */
export async function renderPage({
  pool,
  url,
  breakpoint = "desktop",
  maskSelectors = [],
  dismissSelectors = [],
  expectedHostname,
  onProgress = () => {},
}) {
  const startedAt = Date.now();
  const profile = profileFor(breakpoint);

  // Validate before we open anything. Re-validated per navigation below, which
  // is what catches a public host redirecting into private space.
  await assertSafeUrl(url, { expectedHostname });

  const browser = await pool.get();
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    // 1, not 2. See breakpoints.js: the image is written at CSS-pixel scale
    // regardless, so a 2x raster is discarded work — and on a tall page it is
    // enough work to stall the render outright.
    deviceScaleFactor: profile.device_scale_factor,
    // Pinned so a capture is reproducible: locale and timezone change prices,
    // dates and sometimes the entire layout.
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    reducedMotion: "reduce",
    javaScriptEnabled: true,
    ignoreHTTPSErrors: false,
    serviceWorkers: "block",
  });

  try {
    context.setDefaultTimeout(config.navigationTimeoutMs);
    await installGuards(context, expectedHostname);

    const page = await context.newPage();

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeoutMs,
    });
    if (response && !response.ok()) {
      throw new RenderError(
        `${url} returned HTTP ${response.status()}`,
        response.status() === 404 ? "not_found" : "bad_status"
      );
    }
    onProgress();

    await settle(page, dismissSelectors, onProgress);

    // Measure only after settling. The old code measured before scrolling, so
    // anything lazy-loaded below the fold was never included in the canvas
    // height and the tail of the page was simply cut off.
    const metrics = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
      documentHeight: Math.max(
        document.body?.scrollHeight ?? 0,
        document.documentElement.scrollHeight,
        document.body?.offsetHeight ?? 0,
        document.documentElement.offsetHeight,
        window.innerHeight
      ),
    }));

    const truncated = metrics.documentHeight > config.maxDocumentHeightPx;
    const captureHeight = truncated ? config.maxDocumentHeightPx : metrics.documentHeight;

    // A truncated capture is clipped explicitly rather than by letting fullPage
    // run away. Unlike the old 15000 px cap, the honest document height is
    // still returned to the caller, so "this page is taller than we captured"
    // is a fact the system knows rather than one it hides.
    const shotOptions = {
      type: "png", // lossless into the diff; JPEG happens once, on write
      animations: "disabled",
      caret: "hide",
      scale: "device",
      mask: maskSelectors.map((selector) => page.locator(selector)),
      maskColor: "#ff00ff",
    };
    if (truncated) {
      shotOptions.clip = { x: 0, y: 0, width: metrics.viewportWidth, height: captureHeight };
    } else {
      shotOptions.fullPage = true;
    }

    const raw = await page.screenshot(shotOptions);
    onProgress();

    // The page's own HTML, for the tier-1 content hash. Taken from the rendered
    // DOM rather than re-fetched so it reflects what was actually captured.
    const html = await page.content();
    const finalUrl = page.url();

    // The components on the page, measured in the same render as the image.
    // This is the denominator "missed elements" never had: you cannot count
    // what went unseen without knowing what was there.
    const elements = await enumerateElements(page, captureHeight);

    // Force the image to CSS-pixel dimensions. At deviceScaleFactor 1 this is
    // already true and the resize is a no-op, but it is kept as the guarantee
    // rather than an assumption: the stored image is exactly
    // viewport_width x captured_height, which is what every consumer from
    // HeatmapViewer to sharp.extract in relabel-pages.mjs depends on.
    const buffer = await sharp(raw)
      .resize(metrics.viewportWidth, captureHeight, { fit: "fill" })
      .jpeg({ quality: config.jpegQuality, mozjpeg: true })
      .toBuffer();

    const thumbnail = await sharp(buffer)
      .resize(config.thumbWidth, null, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();

    // Trust nothing: read the dimensions back off the encoded bytes. The old
    // upload endpoint never decoded the image it stored, so a malformed or
    // spoofed capture poisoned every downstream consumer silently.
    const meta = await sharp(buffer).metadata();

    return {
      buffer,
      thumbnail,
      viewportWidth: metrics.viewportWidth,
      viewportHeight: metrics.viewportHeight,
      documentHeight: metrics.documentHeight,
      captureHeight,
      imageWidth: meta.width,
      imageHeight: meta.height,
      deviceScaleFactor: profile.device_scale_factor,
      truncated,
      html,
      elements,
      finalUrl,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await context.close();
  }
}

export class RenderError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RenderError";
    this.code = code;
  }
}

/**
 * Network-level guards: drop known noise, and re-check every navigation.
 *
 * The per-navigation check is the part that matters for security. Validating
 * only the URL the admin typed is the classic SSRF bypass — a public hostname
 * that 302s to 169.254.169.254 sails straight past it.
 */
async function installGuards(context, expectedHostname) {
  await context.route("**/*", async (route, request) => {
    const requestUrl = request.url();

    if (["websocket", "media", "eventsource"].includes(request.resourceType())) {
      return route.abort();
    }

    let parsed;
    try {
      parsed = new URL(requestUrl);
    } catch {
      return route.abort();
    }

    if (!["http:", "https:"].includes(parsed.protocol)) return route.abort();

    if (BLOCKED_HOSTS.some((host) => parsed.hostname.includes(host))) {
      return route.abort();
    }

    // Only main-frame navigations get the full DNS re-check: it costs a lookup,
    // and a subresource cannot change what the page *is*.
    if (request.isNavigationRequest() && request.frame() === request.frame().page()?.mainFrame()) {
      try {
        await assertSafeUrl(requestUrl, { expectedHostname });
      } catch (err) {
        if (err instanceof UnsafeUrlError) return route.abort();
        throw err;
      }
    } else if (isBlockedLiteralHost(parsed.hostname)) {
      // Subresources get the cheap literal-IP check only — no DNS, and domain
      // names pass. They must pass: stylesheets, fonts and images are all
      // served from hostnames, and blocking them renders the page as bare
      // unstyled HTML.
      return route.abort();
    }

    return route.continue();
  });
}

/**
 * Wait until the page has genuinely stopped changing.
 *
 * This is the replacement for the old `sleep(1200)`, which was a guess and
 * routinely photographed half-rendered pages. Each step here addresses a
 * specific way a page keeps moving after load.
 */
async function settle(page, dismissSelectors, onProgress) {
  // 1. Kill motion first, so animations cannot keep the page busy or land
  //    mid-transition in the shot.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      scroll-behavior: auto !important;
      caret-color: transparent !important;
    }`,
  }).catch(() => {});

  // 2. Clear consent walls before waiting on anything else — they often block
  //    scrolling, which would defeat the lazy-load priming below.
  await dismissConsent(page, dismissSelectors);
  onProgress();

  // 3. Prime lazy-loading. Most images below the fold are behind an
  //    IntersectionObserver and will never load — leaving grey boxes in the
  //    capture — unless something scrolls past them first.
  await evaluateWithDeadline(
    page,
    async () => {
      const step = window.innerHeight;
      const limit = Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight);
      for (let y = 0; y < limit; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 150));
    },
    30000
  );
  onProgress();

  // 4. Now that everything has been requested, wait for the network to go quiet.
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

  // 5. Fonts, then images. A page that swaps in a webfont after the shot
  //    reflows every text block; an <img> that has loaded but not decoded can
  //    still paint blank.
  //
  //    Both waits are capped *inside* the page. page.evaluate has no timeout in
  //    Playwright — setDefaultTimeout does not apply to it — so an evaluate that
  //    awaits a promise which never settles hangs the render forever, with no
  //    error and nothing in the log. That is not hypothetical: a single broken
  //    <img> is enough, because img.decode() on an image that never loads never
  //    resolves and never rejects, and Promise.allSettled waits for all of them.
  await evaluateWithDeadline(page, () => document.fonts?.ready, 5000);
  await evaluateWithDeadline(
    page,
    async () => {
      const images = Array.from(document.images).filter((img) => !img.complete);
      await Promise.allSettled(images.map((img) => img.decode?.() ?? Promise.resolve()));
    },
    8000
  );

  // 6. Pause any video that survived the media block, so a frame grab is stable.
  await page.evaluate(() => {
    document.querySelectorAll("video").forEach((video) => {
      try { video.pause(); video.currentTime = 0; } catch { /* cross-origin */ }
    });
  }).catch(() => {});

  // 7. Consent, one last time — immediately before the shutter, which is the
  //    only moment that actually guarantees anything.
  //
  //    The first pass runs moments after domcontentloaded so a modal cannot
  //    block the priming scroll, but a banner injected by a late script is not
  //    in the DOM yet then. An intermediate pass is no better: several seconds
  //    of font and image settling follow it, and the banner can appear during
  //    exactly that window — which is how one page came out clean and its
  //    sibling came out with a cookie wall across the hero.
  await dismissConsent(page, dismissSelectors);

  await page.waitForTimeout(300);
  onProgress();
}

/**
 * Run an in-page function, but never wait on it forever.
 *
 * Playwright does not time out page.evaluate — setDefaultTimeout has no effect
 * on it — so an evaluate awaiting a promise that never settles wedges the whole
 * render silently. That is not hypothetical: one broken <img> does it, because
 * img.decode() on an image that never loads neither resolves nor rejects, and
 * Promise.allSettled waits for every one of them.
 *
 * The race is run here rather than inside the page on purpose. Injecting a
 * timeout wrapper into the page would need `new Function`, which a site's
 * Content-Security-Policy is entitled to block — and then every settle step
 * would quietly become a no-op on exactly the strict sites we most want to
 * render correctly. Losing the race simply abandons the evaluate; it rejects
 * later when the context closes, which is caught.
 *
 * Failures are swallowed deliberately: each caller is a best-effort settle
 * step, and a page that never finishes loading its fonts is still worth
 * photographing.
 */
async function evaluateWithDeadline(page, fn, deadlineMs) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(resolve, deadlineMs);
    timer.unref?.();
  });

  try {
    await Promise.race([page.evaluate(fn).catch(() => {}), deadline]);
  } catch {
    // Navigation mid-evaluate or a detached frame — not a reason to stop.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Close a consent wall, by known vendor selector first and accessible name
 * second.
 *
 * Called twice during settle: once early so a modal cannot block the priming
 * scroll, and once after the network quiets, because many banners are injected
 * by a script a second or two after load and are not in the DOM for the first
 * look.
 */
async function dismissConsent(page, dismissSelectors) {
  for (const selector of [...dismissSelectors, ...CONSENT_SELECTORS]) {
    try {
      const target = page.locator(selector).first();
      if (await target.isVisible({ timeout: 250 })) {
        await target.click({ timeout: 1000, noWaitAfter: true });
        await page.waitForTimeout(200);
        return true;
      }
    } catch {
      // A selector that is absent is the normal case, not an error.
    }
  }

  for (const pattern of CONSENT_TEXTS) {
    try {
      const button = page.getByRole("button", { name: pattern }).first();
      if (await button.isVisible({ timeout: 200 })) {
        await button.click({ timeout: 1000, noWaitAfter: true });
        await page.waitForTimeout(250);
        return true;
      }
    } catch {
      // Nothing matching, or it vanished as we reached for it.
    }
  }

  return false;
}

// ── Element inventory ────────────────────────────────────────────────────────

// Matches MIN_REGION_PX in regionMap.js and MIN_PX in the evaluation harness, so
// "an element" means the same thing in the paper, the region map and here.
const MIN_ELEMENT_PX = 24;
// A page with thousands of qualifying nodes is almost always a product grid or
// a long list; past this the inventory stops adding information and starts
// adding document size.
const MAX_ELEMENTS = 2000;
const INVENTORY_DEADLINE_MS = 8000;

/**
 * Every component a visitor could look at as one thing, with document-space
 * boxes.
 *
 * The definition is the evaluation harness's, verbatim
 * (evaluation/expAB_identity.mjs): visible, at least 24 px on a side, and either
 * an atomic control/media element, a node carrying its own text, or a node
 * painting its own background image; then only the leaf-most qualifying node,
 * so a card and the button inside it are not both counted.
 *
 * One change: the harness finds leaves by running querySelectorAll("*") under
 * every candidate, which is quadratic and can stall a large page. Here each
 * candidate marks its ancestors instead — same result, one pass.
 *
 * Best-effort. If it fails or runs long the capture still succeeds and missed %
 * shows "unknown" rather than blocking a screenshot on an optional extra.
 */
async function enumerateElements(page, captureHeight) {
  const work = page.evaluate(
    ({ minPx, maxElements, maxY }) => {
      const ATOMIC = new Set([
        "IMG", "SVG", "VIDEO", "CANVAS", "PICTURE", "IFRAME",
        "BUTTON", "INPUT", "SELECT", "TEXTAREA", "A",
      ]);

      const ownText = (el) => {
        let t = "";
        for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
        return t.replace(/\s+/g, " ").trim();
      };

      const candidates = [];
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
        const r = el.getBoundingClientRect();
        if (r.width < minPx || r.height < minPx) continue;
        const atomic = ATOMIC.has(el.tagName.toUpperCase());
        const texty = ownText(el).length >= 2;
        const painted = cs.backgroundImage && cs.backgroundImage !== "none";
        if (!atomic && !texty && !painted) continue;
        candidates.push(el);
      }

      // A candidate with a candidate beneath it is a container, not a leaf.
      const candidateSet = new Set(candidates);
      const hasCandidateBelow = new Set();
      for (const el of candidates) {
        for (let up = el.parentElement; up; up = up.parentElement) {
          if (candidateSet.has(up)) hasCandidateBelow.add(up);
        }
      }

      const out = [];
      for (const el of candidates) {
        if (hasCandidateBelow.has(el)) continue;
        const r = el.getBoundingClientRect();
        const y = Math.round(r.top + scrollY);
        // Outside the captured image there is nothing to overlay against.
        if (y >= maxY) continue;
        const label =
          el.getAttribute("aria-label") || el.getAttribute("alt") ||
          el.getAttribute("title") || ownText(el) || (el.innerText || "");
        out.push({
          tag: el.tagName.toLowerCase(),
          label: String(label).replace(/\s+/g, " ").trim().slice(0, 80),
          bbox: {
            x: Math.round(r.left + scrollX),
            y,
            w: Math.round(r.width),
            h: Math.round(r.height),
          },
        });
        if (out.length >= maxElements) break;
      }
      return out;
    },
    { minPx: MIN_ELEMENT_PX, maxElements: MAX_ELEMENTS, maxY: captureHeight }
  );

  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), INVENTORY_DEADLINE_MS);
    timer.unref?.();
  });

  try {
    const result = await Promise.race([work.catch(() => null), deadline]);
    return Array.isArray(result) ? result : null;
  } finally {
    clearTimeout(timer);
  }
}
