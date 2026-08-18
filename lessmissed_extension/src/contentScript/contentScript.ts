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

function queueEvent(partial: Omit<RawEvent, 'timestamp' | 'session_id'>) {
  if (!currentSessionId) return;
  eventQueue.push({
    timestamp: new Date().toISOString(),
    session_id: currentSessionId,
    ...partial,
  });
  if (eventQueue.length >= BATCH_MAX) flushBatch();
}

function flushBatch() {
  if (!eventQueue.length || !currentSessionId) return;
  const batch = eventQueue.splice(0);
  chrome.runtime.sendMessage({ action: 'EVENTS_BATCH', events: batch });
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

// ── SPA route detection ──────────────────────────────────────────────────────
function onRouteChange() {
  const newUrl = location.pathname + location.search;
  if (newUrl === currentUrl) return;
  queueEvent({ type: 'page_change', page_url: currentUrl, data: { from: currentUrl, to: newUrl } });
  currentUrl = newUrl;
  prevScrollY = window.scrollY || 0;
}

const _pushState = history.pushState.bind(history);
history.pushState = (...args: Parameters<typeof history.pushState>) => {
  _pushState(...args);
  onRouteChange();
};

const _replaceState = history.replaceState.bind(history);
history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
  _replaceState(...args);
  onRouteChange();
};

window.addEventListener('popstate', onRouteChange);

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

  if (request.action === 'GET_PAGE_DIMS') {
    sendResponse({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentHeight: Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight,
        window.innerHeight
      ),
      scrollY: window.scrollY,
      pageUrl: window.location.pathname,
    });
    return false;
  }

  if (request.action === 'SCROLL_TO') {
    window.scrollTo({ top: request.y ?? 0, behavior: 'instant' as ScrollBehavior });
    setTimeout(() => sendResponse({ ok: true, scrollY: window.scrollY }), 80);
    return true;
  }

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

  if (request.action === 'START' && !isTracking) {
    if (!webgazer) {
      sendResponse({ status: 'error', error: 'WebGazer not found' });
      return false;
    }
    currentSessionId = request.session_id ?? null;
    currentUrl = location.pathname + location.search;
    prevScrollY = window.scrollY;

    webgazer.begin().then(() => {
      webgazer.params.applyKalmanFilter = true;
      webgazer.params.saveDataAcrossSessions = true;
      webgazer.showPredictionPoints(isDotVisible);
      webgazer.showVideoPreview(false);
      webgazer.showFaceOverlay(false);
      webgazer.showFaceFeedbackBox(false);
      isTracking = true;
      resetSmoothingState();
      sendResponse({ status: 'started', session_id: currentSessionId });
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

  if (request.action === 'HIDE_FIXED_ELEMENTS') {
    const styleEl = document.createElement('style');
    styleEl.id = '__lm_hide_fixed';
    styleEl.textContent = '[data-lm-hide]{visibility:hidden!important}';
    document.head.appendChild(styleEl);

    let count = 0;
    let headerHeight = 0;
    document.querySelectorAll<HTMLElement>('*').forEach(el => {
      const pos = window.getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') {
        const rect = el.getBoundingClientRect();
        if (rect.top <= 5 && rect.bottom > headerHeight) {
          headerHeight = rect.bottom;
        }
        el.dataset.lmHide = '1';
        count++;
      }
    });
    sendResponse({ ok: true, count, headerHeight: Math.round(headerHeight) });
    return false;
  }

  if (request.action === 'SHOW_FIXED_ELEMENTS') {
    document.querySelectorAll<HTMLElement>('[data-lm-hide]').forEach(el => {
      delete el.dataset.lmHide;
    });
    document.getElementById('__lm_hide_fixed')?.remove();
    sendResponse({ ok: true });
    return false;
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