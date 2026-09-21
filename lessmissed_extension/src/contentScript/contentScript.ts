console.log('[LessMissed] Content script injected');

const webgazer = (window as any).webgazer;
let isTracking = false;
let isDotVisible = true;

// ── Gaze smoothing state ─────────────────────────────────────────────────────
const BUFFER_SIZE = 8;
const OUTLIER_THRESHOLD = 100;
const bufX: number[] = [];
const bufY: number[] = [];
let anchorX = 0;
let anchorY = 0;
let hasAnchor = false;
let lastGazeTime = 0;

function resetSmoothingState() {
  bufX.length = 0;
  bufY.length = 0;
  hasAnchor = false;
  lastGazeTime = 0;
}

// ── Session & event queue ────────────────────────────────────────────────────
let currentSessionId: string | null = null;
let currentUrl: string = location.pathname + location.search;

interface RawEvent {
  timestamp: string;
  session_id: string;
  type: string;
  page_url: string;
  data: Record<string, unknown>;
}

const eventQueue: RawEvent[] = [];
const BATCH_MAX = 50;

// Dropping an event because there is no session id is a bug, not a normal
// outcome: tracking is running, the camera is on, the consumer is being
// recorded — and none of it is being kept. It used to happen in silence, which
// is how a whole site's worth of gaze went missing with every page still
// looking like it was working. Say so, once, loudly enough to find.
let droppedWithoutSession = 0;

function queueEvent(partial: Omit<RawEvent, 'timestamp' | 'session_id'>) {
  if (!currentSessionId) {
    if (isTracking && droppedWithoutSession++ === 0) {
      console.error(
        '[LessMissed] Tracking is running but no session id was supplied — ' +
          'every event on this page is being discarded. The SESSION_HELLO reply ' +
          'had no session_id.'
      );
      reportResumeFailure('tracking_without_session');
    }
    return;
  }
  eventQueue.push({
    timestamp: new Date().toISOString(),
    session_id: currentSessionId,
    ...partial,
  });
  if (eventQueue.length >= BATCH_MAX) flushBatch();
}

// A ceiling on the buffer. Without it a re-queue bug grows without bound —
// which is exactly what happened once — and a genuinely offline tab would eat
// memory until the tab died. Oldest samples go first: recent gaze is the part
// still worth having.
const QUEUE_MAX = 5000;

function flushBatch() {
  if (!eventQueue.length || !currentSessionId) return;
  const batch = eventQueue.splice(0);

  chrome.runtime.sendMessage({ action: 'EVENTS_BATCH', events: batch }, (response) => {
    // Re-queue only on a real delivery failure. The worker acknowledges with
    // {ok:true}; a missing acknowledgement means it never received this.
    // Checking lastError alone is not enough — a handler that returns without
    // calling sendResponse also sets it, and treating that as failure replays
    // every successful batch forever.
    if (chrome.runtime.lastError || !response?.ok) {
      eventQueue.unshift(...batch);
      if (eventQueue.length > QUEUE_MAX) {
        eventQueue.splice(0, eventQueue.length - QUEUE_MAX);
      }
    }
  });
}

/** Tell the worker a page could not resume, so it is visible off-device. */
function reportResumeFailure(reason: string) {
  try {
    chrome.runtime.sendMessage(
      { action: 'RESUME_FAILED', reason, url: location.href },
      () => void chrome.runtime.lastError
    );
  } catch {
    // The worker is gone; the console message above is all we have.
  }
}

// Flush on a 1-second heartbeat regardless of batch size
setInterval(flushBatch, 1000);

// ── Element resolution ───────────────────────────────────────────────────────

// Nodes we inject ourselves. document.elementFromPoint() sits under the gaze
// dot, so without this every sample would report our own overlay as the thing
// the user was looking at.
const OWN_NODE_IDS = new Set(['webgazerGazeDot', 'webgazerFaceOverlay', 'webgazerVideoFeed']);

function isOwnNode(el: Element | null): boolean {
  if (!el) return false;
  const id = (el as HTMLElement).id ?? '';
  return OWN_NODE_IDS.has(id) || id.startsWith('__lm_');
}

// Resolve the page element under a point, stepping past our own overlay rather
// than reporting it. Hiding the dot for the hit-test is the only reliable way:
// elementsFromPoint order is not guaranteed to skip it.
function pageElementFromPoint(x: number, y: number): Element | null {
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (!isOwnNode(el)) return el;
  }
  return null;
}

function resolveElementId(el: Element | null): string {
  if (!el) return '';
  if (el.id) return `#${el.id}`;
  const html = el as HTMLElement;
  if (html.dataset?.lessmissedId) return html.dataset.lessmissedId;
  if (html.dataset?.id) return html.dataset.id;
  const cls = el.classList[0] ? `.${el.classList[0]}` : '';
  return `${el.tagName.toLowerCase()}${cls}`;
}

// A positionally unique key for the element.
//
// resolveElementId() alone collapses every unclassed <p> on a page into the
// single bucket "p", so the dashboard reported one row of 26 fixations spread
// across unrelated paragraphs. Walking up with nth-of-type keeps distinct
// components distinct while staying stable across reloads.
function resolveElementKey(el: Element | null): string {
  if (!el) return '';
  const parts: string[] = [];
  let node: Element | null = el;
  for (let i = 0; i < 4 && node && node !== document.body; i++) {
    if (node.id) {
      parts.unshift(`#${node.id}`);
      break;
    }
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      const idx = sameTag.indexOf(node);
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${idx + 1})` : tag);
    } else {
      parts.unshift(tag);
    }
    node = parent;
  }
  return parts.join('>');
}

// Everything the labelling pipeline needs to name this element. An <img> has no
// textContent, so alt/aria/title/src are the only DOM-side signals that can name
// it; the rect lets the backend match it against the page screenshot.
function describeTarget(el: Element | null) {
  if (!el) {
    return {
      element_id: '', element_key: '', element_xpath: '', element_tag: '',
      element_text: '', element_alt: '', element_aria: '', element_title: '',
      element_src: '', element_rect: null as null | { x: number; y: number; w: number; h: number },
    };
  }

  const html = el as HTMLElement;
  const img = el as HTMLImageElement;
  let rect: { x: number; y: number; w: number; h: number } | null = null;
  try {
    const r = el.getBoundingClientRect();
    // Document-space, so it lines up with the stitched screenshot directly.
    rect = {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  } catch {
    rect = null;
  }

  return {
    element_id: resolveElementId(el),
    element_key: resolveElementKey(el),
    element_xpath: resolveXPath(el),
    element_tag: el.tagName.toLowerCase(),
    element_text: html.innerText?.trim().slice(0, 80) ?? '',
    element_alt: (img.alt ?? '').trim().slice(0, 80),
    element_aria: (el.getAttribute('aria-label') ?? '').trim().slice(0, 80),
    element_title: (el.getAttribute('title') ?? '').trim().slice(0, 80),
    // Basename only — full CDN URLs are long and carry no extra meaning.
    element_src: (img.currentSrc || img.src || '').split('?')[0].split('/').pop()?.slice(0, 80) ?? '',
    element_rect: rect,
  };
}

function resolveXPath(el: Element | null): string {
  if (!el || el === document.body) return '';
  const parts: string[] = [];
  let node: Element | null = el;
  for (let i = 0; i < 3 && node && node !== document.body; i++) {
    const tag = node.tagName.toLowerCase();
    const suffix = node.id ? `#${node.id}` : node.classList[0] ? `.${node.classList[0]}` : '';
    parts.unshift(`${tag}${suffix}`);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

// ── Mouse / cursor (8 fps) ───────────────────────────────────────────────────
let lastMouseTime = 0;
const MOUSE_INTERVAL = 125;

document.addEventListener('mousemove', (e) => {
  if (!isTracking || Date.now() - lastMouseTime < MOUSE_INTERVAL) return;
  lastMouseTime = Date.now();
  queueEvent({
    type: 'cursor',
    page_url: currentUrl,
    data: { viewport_x: e.clientX, viewport_y: e.clientY, scroll_x: window.scrollX, scroll_y: window.scrollY },
  });
});

// ── Scroll (4 fps + on-stop) ─────────────────────────────────────────────────
let lastScrollTime = 0;
let scrollStopTimer: ReturnType<typeof setTimeout> | null = null;
let prevScrollY = window.scrollY;
const SCROLL_INTERVAL = 250;

function getDocHeight() {
  return Math.max(
    document.body.scrollHeight, document.documentElement.scrollHeight,
    document.body.offsetHeight, document.documentElement.offsetHeight,
    document.body.clientHeight, document.documentElement.clientHeight
  );
}

window.addEventListener('scroll', (e) => {
  if (!isTracking) return;

  let currentScrollY = window.scrollY;
  let scrollH = getDocHeight() - window.innerHeight;

  if (e.target !== document && e.target !== window && (e.target as HTMLElement).scrollHeight) {
      const el = e.target as HTMLElement;
      currentScrollY = el.scrollTop;
      scrollH = el.scrollHeight - el.clientHeight;
  }

  const depth = scrollH > 0 ? Math.round((currentScrollY / scrollH) * 100) : 0;
  const direction = currentScrollY >= prevScrollY ? 'down' : 'up';
  prevScrollY = currentScrollY;

  if (scrollStopTimer) clearTimeout(scrollStopTimer);

  if (Date.now() - lastScrollTime >= SCROLL_INTERVAL) {
    lastScrollTime = Date.now();
    queueEvent({ type: 'scroll', page_url: currentUrl, data: { depth_pct: depth, direction } });
  }

  scrollStopTimer = setTimeout(() => {
    queueEvent({ type: 'scroll', page_url: currentUrl, data: { depth_pct: depth, direction, is_stop: true } });
  }, 200);
}, { passive: true, capture: true });

// ── Clicks (every event, capture phase) ─────────────────────────────────────
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'label', 'summary']);

document.addEventListener('click', (e) => {
  if (!isTracking) return;
  const el = e.target as HTMLElement;
  queueEvent({
    type: 'click',
    page_url: currentUrl,
    data: {
      viewport_x: e.clientX,
      viewport_y: e.clientY,
      scroll_x: window.scrollX,
      scroll_y: window.scrollY,
      ...describeTarget(el),
      is_interactive: INTERACTIVE_TAGS.has(el.tagName.toLowerCase()),
    },
  });
}, { capture: true });

// ── Visibility change ────────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (!isTracking) return;
  queueEvent({ type: 'visibility', page_url: currentUrl, data: { visible: !document.hidden } });
  if (document.hidden) flushBatch(); // flush immediately before browser suspends the tab
});

// ── Page unload ──────────────────────────────────────────────────────────────
// The 1-second batch heartbeat would otherwise drop up to a second of gaze at
// every navigation — and with site-wide tracking there is now a navigation every
// few seconds. pagehide is the last point at which a message can still be posted.
window.addEventListener('pagehide', () => {
  if (!isTracking) return;
  queueEvent({ type: 'visibility', page_url: currentUrl, data: { visible: false, unloading: true } });
  flushBatch();
  chrome.runtime.sendMessage({
    action: 'PAGE_LEAVE',
    path: currentUrl,
    at: new Date().toISOString(),
  });
});

// ── SPA route detection ──────────────────────────────────────────────────────
//
// A client-side route change is not a page load: this script is never rebuilt,
// so unless something tells it otherwise `currentUrl` stays at whatever page the
// consumer entered on and every later event is filed under the wrong page.
//
// This used to patch history.pushState. That can never work. Content scripts run
// in an **isolated world** — they share the DOM but not the JS context — so the
// patch lands on this world's binding of History.prototype.pushState, while the
// page calls its own. On a Next.js site every in-app link is exactly that call,
// so the handler never fired once: there is not a single page_change event in
// the entire database. Back/forward appeared to work only because `popstate` is
// a DOM event, and those do cross into this world.
//
// So: don't try to observe the page's own calls. Two sources that actually work
// — the worker, which sees every navigation through chrome.tabs.onUpdated and is
// already right about them, and a cheap poll for anything it misses.
function onRouteChange(nextUrl?: string) {
  const newUrl = nextUrl ?? location.pathname + location.search;
  if (newUrl === currentUrl) return;

  // Flush before moving. Anything already queued happened on the old page, and
  // re-labelling it here would file it under the page they just arrived at.
  queueEvent({ type: 'page_change', page_url: currentUrl, data: { from: currentUrl, to: newUrl } });
  flushBatch();

  currentUrl = newUrl;
  prevScrollY = window.scrollY || 0;
  resetSmoothingState();
}

window.addEventListener('popstate', () => onRouteChange());

// The worker tells us where we are; it is the authority on navigation and needs
// no cooperation from the page.
chrome.runtime.onMessage.addListener((request) => {
  if (request?.action === 'URL_CHANGED' && typeof request.path === 'string') {
    onRouteChange(request.path);
  }
  return false;
});

// Safety net, on the flush heartbeat that already runs: correctness should not
// depend on a message arriving.
setInterval(() => onRouteChange(), 1000);

// ── Starting tracking ────────────────────────────────────────────────────────

// The one place tracking begins, reached two ways: the popup's explicit START,
// and the SESSION_HELLO handshake at the bottom of this file that resumes an
// in-flight session after the consumer navigates to another page.
//
// Camera permission and WebGazer's calibration model are both per-origin —
// permission is remembered by the browser, and the model persists to
// localStorage via saveDataAcrossSessions — so resuming within one site costs a
// model reload but no prompt and no re-calibration. Crossing to a different
// subdomain does lose the calibration.
// ── Serve WebGazer's face models from the extension, not the network ─────────
//
// webgazer.begin() loads BlazeFace, FaceMesh and Iris weights from tfhub.dev,
// which now 302s to a signed Kaggle storage URL that expires in three hours.
// Every navigation is a fresh JS context, so that is ~6 MB re-downloaded on
// *every page load* — and it happens from the page's origin, because MV3
// content scripts do not inherit the extension's host permissions. When it
// fails, begin() rejects with "TypeError: Failed to fetch" and that page
// silently collects nothing for the rest of the session.
//
// The models are vendored in the extension, so map those requests onto
// chrome-extension:// URLs and take the network out of the startup path.
const TFHUB_MODEL_MAP: Array<[RegExp, string]> = [
  [/tfhub\.dev\/tensorflow\/tfjs-model\/blazeface\//i, 'models/blazeface/'],
  [/tfhub\.dev\/mediapipe\/tfjs-model\/facemesh\//i, 'models/facemesh/'],
  [/tfhub\.dev\/mediapipe\/tfjs-model\/iris\//i, 'models/iris/'],
];

function localModelUrl(url: string): string | null {
  for (const [pattern, dir] of TFHUB_MODEL_MAP) {
    if (!pattern.test(url)) continue;
    // tfjs asks for ".../model.json?tfjs-format=file" and then the weight
    // shard named in the manifest. Only the basename matters here.
    const file = url.split('?')[0].split('/').pop();
    if (!file) return null;
    return chrome.runtime.getURL(dir + file);
  }
  return null;
}

let modelFetchPatched = false;

function patchModelFetch() {
  if (modelFetchPatched) return;
  modelFetchPatched = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url;
    const local = typeof url === 'string' ? localModelUrl(url) : null;
    return local ? nativeFetch(local, init) : nativeFetch(input, init);
  }) as typeof window.fetch;
}

function beginTracking(sessionId: string | null): Promise<boolean> {
  if (isTracking) return Promise.resolve(true);
  if (!webgazer) return Promise.resolve(false);

  currentSessionId = sessionId;
  currentUrl = location.pathname + location.search;
  prevScrollY = window.scrollY;

  patchModelFetch();

  return beginWithRetry()
    .then(() => {
      webgazer.params.applyKalmanFilter = true;
      webgazer.params.saveDataAcrossSessions = true;
      webgazer.showPredictionPoints(isDotVisible);
      webgazer.showVideoPreview(false);
      webgazer.showFaceOverlay(false);
      webgazer.showFaceFeedbackBox(false);
      isTracking = true;
      resetSmoothingState();
      return true;
    })
    .catch((err: unknown) => {
      console.warn('[LessMissed] WebGazer failed to start:', err);
      currentSessionId = null;
      return false;
    });
}

/**
 * Start WebGazer, retrying a transient failure.
 *
 * With the models served locally this should not be needed — but a camera that
 * is briefly still held by the previous page is a real race, and losing a whole
 * page of a consumer's journey to it is too expensive to accept.
 */
function beginWithRetry(attempt = 0): Promise<void> {
  return webgazer.begin().catch((err: unknown) => {
    if (attempt >= 2) throw err;
    return new Promise<void>((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
      .then(() => beginWithRetry(attempt + 1));
  });
}

// ── Calibration ──────────────────────────────────────────────────────────────
let calibrationSendResponse: ((response: any) => void) | null = null;
let calibrationDotsRemaining = 0;

function startCalibration(sendResponse: (response: any) => void) {
  calibrationSendResponse = sendResponse;

  const overlay = document.createElement('div');
  overlay.id = 'webgazer-calibration-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(0,0,0,0.75);
    pointer-events: all;
  `;

  const instruction = document.createElement('p');
  instruction.textContent = 'Click each dot to calibrate eye tracking';
  instruction.style.cssText = `
    color: #fff; text-align: center; font-family: sans-serif;
    font-size: 16px; margin-top: 20px; pointer-events: none;
  `;
  overlay.appendChild(instruction);

  const positions = [
    [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
    [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
    [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
  ];
  calibrationDotsRemaining = positions.length;

  positions.forEach(([xf, yf]) => {
    const dot = document.createElement('div');
    const xPx = Math.round(window.innerWidth * xf);
    const yPx = Math.round(window.innerHeight * yf);
    dot.style.cssText = `
      position: fixed;
      left: ${xPx}px; top: ${yPx}px;
      width: 20px; height: 20px;
      margin-left: -10px; margin-top: -10px;
      border-radius: 50%;
      background: #4CAF50;
      box-shadow: 0 0 0 4px rgba(76,175,80,0.4);
      cursor: pointer;
    `;
    dot.addEventListener('click', () => {
      webgazer.recordScreenPosition(xPx, yPx, 'click');
      dot.remove();
      calibrationDotsRemaining--;
      if (calibrationDotsRemaining === 0) {
        overlay.remove();
        calibrationSendResponse?.({ status: 'calibrated' });
        calibrationSendResponse = null;
      }
    });
    overlay.appendChild(dot);
  });

  document.body.appendChild(overlay);
}

// ── Message listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {

  if (request.action === 'STATUS') {
    sendResponse({ status: isTracking ? 'started' : 'stopped', dotVisible: isDotVisible, session_id: currentSessionId });
    return false;
  }

  if (request.action === 'TOGGLE_DOT') {
    isDotVisible = !isDotVisible;
    webgazer?.showPredictionPoints(isDotVisible);
    sendResponse({ dotVisible: isDotVisible });
    return false;
  }

  if (request.action === 'START') {
    beginTracking(request.session_id ?? null).then((ok) => {
      sendResponse(
        ok
          ? { status: 'started', session_id: currentSessionId }
          : { status: 'error', error: 'WebGazer not found' }
      );
    });
    return true;
  }

  if (request.action === 'STOP' && isTracking) {
    isTracking = false;
    flushBatch(); // drain queue before stopping
    webgazer?.pause();
    resetSmoothingState();
    const stoppedSessionId = currentSessionId;
    currentSessionId = null;
    sendResponse({ status: 'stopped', session_id: stoppedSessionId });
    return false;
  }

  if (request.action === 'CALIBRATE') {
    startCalibration(sendResponse);
    return true;
  }

  return false;
});

// ── Gaze listener: moving average + outlier rejection + 10 fps ───────────────
if (webgazer) {
  webgazer.setGazeListener((data: any, _clock: number) => {
    if (data == null || !isTracking) return;

    if (!hasAnchor) {
      anchorX = data.x; anchorY = data.y;
      hasAnchor = true;
    } else {
      const dist = Math.sqrt((data.x - anchorX) ** 2 + (data.y - anchorY) ** 2);
      if (dist > OUTLIER_THRESHOLD) {
        // Saccade: gaze jumped to a new area — reset buffer to track the new fixation
        bufX.length = 0; bufY.length = 0;
        anchorX = data.x; anchorY = data.y;
      }
    }
    bufX.push(data.x); bufY.push(data.y);
    if (bufX.length > BUFFER_SIZE) { bufX.shift(); bufY.shift(); }

    anchorX = bufX.reduce((s, v) => s + v, 0) / bufX.length;
    anchorY = bufY.reduce((s, v) => s + v, 0) / bufY.length;

    const now = Date.now();
    if (now - lastGazeTime < 100) return; // 10 fps throttle
    lastGazeTime = now;

    // Step past our own gaze dot — it sits directly under this point.
    const el = pageElementFromPoint(Math.round(anchorX), Math.round(anchorY));
    queueEvent({
      type: 'gaze',
      page_url: currentUrl,
      data: {
        x: Math.round(anchorX),
        y: Math.round(anchorY),
        scroll_x: window.scrollX,
        scroll_y: window.scrollY,
        ...describeTarget(el),
      },
    });
  });
} else {
  console.warn('[LessMissed] WebGazer not found on this page');
}

// ── Resume an in-flight session ──────────────────────────────────────────────
//
// This is what makes site-wide tracking work. A full page load destroys this
// script and builds a fresh one with isTracking = false, so a session started on
// the home page would silently die the moment the consumer clicked a link. The
// background worker is the only thing that outlives the navigation, so we ask it
// on every load whether a session is running for this tab and this site.
//
// The worker may be asleep, or starting, or mid-reload when this fires, and the
// message is simply lost — so a single attempt is not enough. Giving up on the
// first failure silently costs that page its entire session, which is exactly
// how site-wide tracking came to collect nothing beyond the page the consumer
// started on.
const HELLO_ATTEMPTS = 5;
const HELLO_BACKOFF_MS = [0, 250, 750, 2000, 4000];

function sayHello(attempt = 0): void {
  chrome.runtime.sendMessage({ action: 'SESSION_HELLO', url: location.href }, (response) => {
    if (chrome.runtime.lastError || response == null) {
      if (attempt + 1 < HELLO_ATTEMPTS) {
        setTimeout(() => sayHello(attempt + 1), HELLO_BACKOFF_MS[attempt + 1]);
      } else {
        console.warn('[LessMissed] no answer from the worker; this page is not being tracked');
      }
      return;
    }

    // A definite "no" — not this tab, not this site, or no session running.
    if (!response.tracking) return;

    if (!response.session_id) {
      // Tracking without an id would start the camera and throw every sample
      // away. Refuse rather than pretend.
      console.error('[LessMissed] worker said tracking but sent no session_id — not starting');
      reportResumeFailure('hello_without_session_id');
      return;
    }

    void beginTracking(response.session_id).then((ok) => {
      if (!ok) reportResumeFailure('webgazer_begin_failed');
    });
  });
}

sayHello();