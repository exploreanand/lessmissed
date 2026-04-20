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
function resolveElementId(el: Element | null): string {
  if (!el) return '';
  if (el.id) return `#${el.id}`;
  const html = el as HTMLElement;
  if (html.dataset?.lessmissedId) return html.dataset.lessmissedId;
  if (html.dataset?.id) return html.dataset.id;
  const cls = el.classList[0] ? `.${el.classList[0]}` : '';
  return `${el.tagName.toLowerCase()}${cls}`;
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
    data: { viewport_x: e.clientX, viewport_y: e.clientY },
  });
});

// ── Scroll (4 fps + on-stop) ─────────────────────────────────────────────────
let lastScrollTime = 0;
let scrollStopTimer: ReturnType<typeof setTimeout> | null = null;
let prevScrollY = window.scrollY;
const SCROLL_INTERVAL = 250;

document.addEventListener('scroll', () => {
  if (!isTracking) return;

  const scrollH = document.body.scrollHeight - window.innerHeight;
  const depth = scrollH > 0 ? Math.round((window.scrollY / scrollH) * 100) : 0;
  const direction = window.scrollY >= prevScrollY ? 'down' : 'up';
  prevScrollY = window.scrollY;

  if (scrollStopTimer) clearTimeout(scrollStopTimer);

  if (Date.now() - lastScrollTime >= SCROLL_INTERVAL) {
    lastScrollTime = Date.now();
    queueEvent({ type: 'scroll', page_url: currentUrl, data: { depth_pct: depth, direction } });
  }

  // Record the resting scroll depth ~200ms after scrolling stops
  scrollStopTimer = setTimeout(() => {
    const h = document.body.scrollHeight - window.innerHeight;
    const d = h > 0 ? Math.round((window.scrollY / h) * 100) : 0;
    queueEvent({ type: 'scroll', page_url: currentUrl, data: { depth_pct: d, direction, is_stop: true } });
  }, 200);
}, { passive: true });

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
      element_id: resolveElementId(el),
      element_xpath: resolveXPath(el),
      element_tag: el.tagName.toLowerCase(),
      element_text: el.textContent?.trim().slice(0, 40) ?? '',
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

  // Background uses this for screenshot scroll-stitch
  if (request.action === 'GET_PAGE_DIMS') {
    sendResponse({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentHeight: Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
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
    // session_id comes from background after it creates the session via the API
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
        // Track bottom edge of top-anchored fixed elements (nav bars)
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
      bufX.push(data.x); bufY.push(data.y);
    } else {
      const dist = Math.sqrt((data.x - anchorX) ** 2 + (data.y - anchorY) ** 2);
      if (dist > OUTLIER_THRESHOLD) return;
      bufX.push(data.x); bufY.push(data.y);
      if (bufX.length > BUFFER_SIZE) { bufX.shift(); bufY.shift(); }
    }

    anchorX = bufX.reduce((s, v) => s + v, 0) / bufX.length;
    anchorY = bufY.reduce((s, v) => s + v, 0) / bufY.length;

    const now = Date.now();
    if (now - lastGazeTime < 100) return; // 10 fps throttle
    lastGazeTime = now;

    const el = document.elementFromPoint(Math.round(anchorX), Math.round(anchorY));
    queueEvent({
      type: 'gaze',
      page_url: currentUrl,
      data: {
        x: Math.round(anchorX),
        y: Math.round(anchorY),
        element_id: resolveElementId(el),
        element_xpath: resolveXPath(el),
        element_tag: el?.tagName.toLowerCase() ?? '',
        element_text: (el as HTMLElement)?.innerText?.trim().slice(0, 40) ?? '',
      },
    });
  });
} else {
  console.warn('[LessMissed] WebGazer not found on this page');
}