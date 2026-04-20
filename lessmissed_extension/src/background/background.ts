// LessMissed — Background Service Worker
// Handles: screenshot capture, event batching to API, session lifecycle

const WEBAPP_URL = __API_BASE__;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convert a Blob to a base64 data URL without FileReader (not available in SW) */
async function blobToDataURL(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...(bytes.subarray(i, i + CHUNK) as unknown as number[]));
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

/** Send a message to the content script in a tab, with error handling */
async function sendToTab(tabId: number, message: object): Promise<any> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      resolve(chrome.runtime.lastError ? null : response);
    });
  });
}

/** Capture the visible tab in the given window — must pass windowId explicitly so
 *  the popup stealing focus doesn't redirect the capture to the wrong window. */
function captureVisibleTab(windowId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 82 }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!dataUrl) {
        reject(new Error('Chrome did not return a screenshot data URL'));
      } else {
        resolve(dataUrl);
      }
    });
  });
}

// chrome.storage.local uses callback-based API in these type definitions —
// wrap get/set/remove into Promises for async/await ergonomics.
function storageGet<T>(key: string, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (items) => resolve((items[key] ?? fallback) as T));
  });
}
function storageSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
}
function storageRemove(key: string): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.remove(key, resolve));
}

// ---------------------------------------------------------------------------
// Full-page screenshot: scroll → capture each viewport → stitch
// ---------------------------------------------------------------------------

interface PageDims {
  viewportWidth: number;
  viewportHeight: number;
  documentHeight: number;
  scrollY: number;
  pageUrl: string;
}

interface ScreenshotResult {
  dataUrl: string;
  viewportWidth: number;
  viewportHeight: number;
  documentHeight: number;
  headerDataUrl: string;
  headerHeight: number;
}

async function captureFullPage(tabId: number, windowId: number): Promise<ScreenshotResult> {
  const dims: PageDims | null = await sendToTab(tabId, { action: 'GET_PAGE_DIMS' });
  if (!dims) throw new Error('Could not get page dimensions — content script not ready');

  const { viewportWidth, viewportHeight, documentHeight, scrollY: originalScrollY } = dims;
  const maxHeight = Math.min(documentHeight, 15000);
  const totalSteps = Math.ceil(maxHeight / viewportHeight);

  await sendToTab(tabId, { action: 'SCROLL_TO', y: 0 });
  await sleep(200);

  // Capture first viewport WITH fixed elements visible — used as the sticky nav overlay in the viewer
  const headerFullDataUrl = await captureVisibleTab(windowId);
  await sleep(520); // rate-limit gap (Chrome allows 2 captureVisibleTab/sec)

  // Hide fixed/sticky elements; response includes the height of top-fixed elements (nav bar)
  const hideResult = await sendToTab(tabId, { action: 'HIDE_FIXED_ELEMENTS' });
  const headerHeightCSS: number = hideResult?.headerHeight ?? 0;
  await sleep(80); // allow CSS to apply before first capture

  const segments: Array<{ scrollY: number; dataUrl: string }> = [];
  try {
    for (let step = 0; step < totalSteps; step++) {
      const targetScrollY = step * viewportHeight;
      // scrollRes.scrollY is the actual scroll position after clamping to page limits
      const scrollRes = await sendToTab(tabId, { action: 'SCROLL_TO', y: targetScrollY });
      const actualScrollY: number = scrollRes?.scrollY ?? targetScrollY;

      // Page can't scroll further — no new content to capture
      if (step > 0 && actualScrollY <= segments[segments.length - 1].scrollY) break;

      await sleep(520); // Chrome caps captureVisibleTab at 2 calls/sec
      segments.push({ scrollY: actualScrollY, dataUrl: await captureVisibleTab(windowId) });
    }
  } finally {
    // Always restore fixed elements — even if a capture throws mid-loop
    await sendToTab(tabId, { action: 'SHOW_FIXED_ELEMENTS' });
    await sendToTab(tabId, { action: 'SCROLL_TO', y: originalScrollY });
  }

  // Stitch segments onto a CSS-pixel-dimensioned canvas
  const canvas = new OffscreenCanvas(viewportWidth, maxHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context from OffscreenCanvas');

  for (const seg of segments) {
    const blob = await (await fetch(seg.dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const dstH = Math.min(viewportHeight, maxHeight - seg.scrollY);
    if (dstH > 0) {
      // bitmap dimensions are physical pixels (2× on Retina); scale source height proportionally
      const srcH = Math.round(dstH * bitmap.height / viewportHeight);
      ctx.drawImage(bitmap, 0, 0, bitmap.width, srcH, 0, seg.scrollY, viewportWidth, dstH);
    }
    bitmap.close();
  }

  const finalBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });

  // Crop the header capture to just the nav bar height
  let headerDataUrl = '';
  if (headerHeightCSS > 0) {
    const hBlob = await (await fetch(headerFullDataUrl)).blob();
    const hBitmap = await createImageBitmap(hBlob);
    const dpr = hBitmap.width / viewportWidth;
    const hCanvas = new OffscreenCanvas(viewportWidth, headerHeightCSS);
    const hCtx = hCanvas.getContext('2d');
    if (hCtx) {
      hCtx.drawImage(hBitmap, 0, 0, hBitmap.width, Math.round(headerHeightCSS * dpr), 0, 0, viewportWidth, headerHeightCSS);
    }
    hBitmap.close();
    headerDataUrl = await blobToDataURL(await hCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 }));
  }

  return {
    dataUrl: await blobToDataURL(finalBlob),
    viewportWidth,
    viewportHeight,
    documentHeight: maxHeight,
    headerDataUrl,
    headerHeight: headerHeightCSS,
  };
}

async function uploadScreenshot(
  projectId: string,
  pageUrl: string,
  pageSlug: string,
  screenshot: ScreenshotResult
): Promise<{ url: string } | null> {
  try {
    const res = await fetch(`${WEBAPP_URL}/api/extension/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        page_url: pageUrl,
        page_slug: pageSlug,
        image_base64: screenshot.dataUrl,
        viewport_width: screenshot.viewportWidth,
        viewport_height: screenshot.viewportHeight,
        document_height: screenshot.documentHeight,
        header_image_base64: screenshot.headerDataUrl || undefined,
        header_height: screenshot.headerHeight || undefined,
      }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Event batch transmission + offline buffer
// ---------------------------------------------------------------------------

async function postEventBatch(events: unknown[]): Promise<void> {
  if (!events.length) return;
  try {
    const res = await fetch(`${WEBAPP_URL}/api/extension/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: (events[0] as any).session_id, events }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    // Network unavailable — buffer locally, capped at 2000 entries
    const offlineQueue = await storageGet<unknown[]>('offlineQueue', []);
    await storageSet('offlineQueue', [...offlineQueue, ...events].slice(-2000));
  }
}

// Retry offline buffer every 30 seconds
setInterval(async () => {
  const offlineQueue = await storageGet<unknown[]>('offlineQueue', []);
  if (!offlineQueue.length) return;
  try {
    const res = await fetch(`${WEBAPP_URL}/api/extension/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: (offlineQueue[0] as any).session_id, events: offlineQueue }),
    });
    if (res.ok) await storageRemove('offlineQueue');
  } catch {
    // Still offline — will retry next interval
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Session lifecycle helpers
// ---------------------------------------------------------------------------

async function startSession(payload: {
  project_id: string;
  consumer_id: string;
  task_id?: string;
  page_url?: string;
}): Promise<string | null> {
  try {
    const res = await fetch(`${WEBAPP_URL}/api/extension/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, started_at: new Date().toISOString() }),
    });
    if (!res.ok) return null;
    const { session_id } = await res.json();
    await storageSet('activeSessionId', session_id);
    return session_id;
  } catch {
    return null;
  }
}

async function endSession(session_id: string, extras: {
  ended_at?: string;
  max_scroll_depth_pct?: number;
  pages_visited?: Array<{ path: string; entered_at: string }>;
} = {}): Promise<void> {
  try {
    await fetch(`${WEBAPP_URL}/api/extension/sessions/${session_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ended_at: new Date().toISOString(), ...extras }),
    });
  } catch {
    // Non-fatal — session summary will be incomplete but raw events are stored
  }
  await storageRemove('activeSessionId');
}

// ---------------------------------------------------------------------------
// Message handler — popup ↔ background ↔ content script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {

  // ── Full-page screenshot ──────────────────────────────────────────────────
  if (request.action === 'TAKE_SCREENSHOT') {
    const { projectId, pageUrl, pageSlug } = request;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) { sendResponse({ ok: false, error: 'No active tab' }); return; }

      sendResponse({ ok: true, status: 'capturing' });

      try {
        const screenshot = await captureFullPage(tab.id, tab.windowId ?? chrome.windows.WINDOW_ID_CURRENT);
        const result = await uploadScreenshot(projectId, pageUrl, pageSlug, screenshot);
        chrome.storage.local.set({
          lastScreenshot: { ok: !!result, url: result?.url ?? null, pageSlug, capturedAt: Date.now() },
        });
      } catch (err: any) {
        console.error('[LessMissed] captureFullPage error:', err.message);
        chrome.storage.local.set({
          lastScreenshot: { ok: false, error: err.message, pageSlug, capturedAt: Date.now() },
        });
      }
    });

    return true;
  }

  // ── Event batch from content script ──────────────────────────────────────
  if (request.action === 'EVENTS_BATCH') {
    postEventBatch(request.events ?? []);
    return false; // synchronous acknowledgment
  }

  // ── Session start (called by popup before sending START to content script) ─
  if (request.action === 'SESSION_START') {
    const { project_id, consumer_id, task_id, page_url } = request;

    (async () => {
      const session_id = await startSession({ project_id, consumer_id, task_id, page_url });
      if (!session_id) {
        sendResponse({ ok: false, error: 'Failed to create session' });
        return;
      }

      // Forward START to the active tab's content script, including session_id
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.id) { sendResponse({ ok: false, error: 'No active tab' }); return; }
        chrome.tabs.sendMessage(tab.id, { action: 'START', session_id }, (csResponse) => {
          sendResponse({ ok: true, session_id, tracking: csResponse?.status === 'started' });
        });
      });
    })();

    return true;
  }

  // ── Session end (called by popup after sending STOP to content script) ────
  if (request.action === 'SESSION_END') {
    const { session_id, max_scroll_depth_pct, pages_visited } = request;

    (async () => {
      await endSession(session_id, { max_scroll_depth_pct, pages_visited });
      sendResponse({ ok: true });
    })();

    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    console.log('[LessMissed] Extension installed');
  }
});