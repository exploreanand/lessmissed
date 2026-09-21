// LessMissed — Background Service Worker
//
// Owns the tracking session. This is the piece that makes site-wide capture
// possible: the content script is destroyed and rebuilt on every navigation, so
// it cannot remember that a session is running. The worker can — and because MV3
// terminates workers freely, it mirrors that state into chrome.storage.local and
// reloads it at the top of every handler.
//
// Handles: session lifecycle, page-transition recording, and event batching to
// the API. Screenshots are NOT taken here — they are rendered server-side by
// capture-service, against admin-configured target pages. The old scroll-and-
// stitch path wrote to the same field the renderer does and could overwrite a
// geometry-verified capture with a seamed one.

const WEBAPP_URL = __API_BASE__;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Send a message to the content script in a tab, with error handling */
async function sendToTab(tabId: number, message: object): Promise<any> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      resolve(chrome.runtime.lastError ? null : response);
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
// Session state
// ---------------------------------------------------------------------------

interface PageVisit {
  path: string;
  url: string;
  entered_at: string;
  left_at?: string;
}

interface ActiveSession {
  session_id: string;
  project_id: string;
  consumer_id: string;
  /** Project domain, www-stripped. Subdomains of it count as the same site. */
  domain: string;
  /** The tab the session currently follows. Exactly one at a time — two tabs
   *  would mean two WebGazer camera streams. */
  tab_id: number;
  /** True while the bound tab is on a URL outside the project domain. The
   *  session stays alive; it just stops collecting until they come back. */
  paused: boolean;
  started_at: string;
  current_path: string;
  visits: PageVisit[];
}

const SESSION_KEY = 'activeSession';

function loadSession(): Promise<ActiveSession | null> {
  return storageGet<ActiveSession | null>(SESSION_KEY, null);
}

function saveSession(session: ActiveSession | null): Promise<void> {
  return session ? storageSet(SESSION_KEY, session) : storageRemove(SESSION_KEY);
}

// Navigation events arrive in bursts (a redirect chain fires onUpdated several
// times in a few ms). Serialising every read-modify-write of the session keeps
// two handlers from each loading the same state and clobbering the other's visit.
let mutationChain: Promise<unknown> = Promise.resolve();

function withSession<T>(fn: (session: ActiveSession | null) => Promise<T>): Promise<T> {
  const run = mutationChain.then(() => loadSession().then(fn));
  mutationChain = run.catch(() => undefined);
  return run;
}

/** Does this hostname belong to the project's site? Subdomains count — a store's
 *  checkout often lives on one. */
function hostMatchesDomain(hostname: string, domain: string): boolean {
  const host = hostname.replace(/^www\./, '').toLowerCase();
  const base = (domain ?? '').replace(/^www\./, '').toLowerCase();
  if (!host || !base) return false;
  return host === base || host.endsWith(`.${base}`);
}

/** Path form the content script also uses, so both sides agree on page identity. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}

function isSiteUrl(url: string | undefined, domain: string): boolean {
  if (!url || !/^https?:/i.test(url)) return false;
  try {
    return hostMatchesDomain(new URL(url).hostname, domain);
  } catch {
    return false;
  }
}


/**
 * Send one batch, grouped by the session each event belongs to.
 *
 * Grouping matters: the endpoint takes a single session_id for the whole body
 * and stamps every event with that session's project and consumer. Posting a
 * mixed batch under `events[0].session_id` — as this used to — silently
 * attributes one session's gaze to another.
 */
async function postEventBatch(events: unknown[]): Promise<void> {
  if (!events.length) return;

  const bySession = new Map<string, unknown[]>();
  for (const ev of events) {
    const id = (ev as any)?.session_id;
    if (!id) continue; // nothing to attribute it to
    if (!bySession.has(id)) bySession.set(id, []);
    bySession.get(id)!.push(ev);
  }

  const failed: unknown[] = [];

  for (const [session_id, batch] of bySession) {
    try {
      const res = await fetch(`${WEBAPP_URL}/api/extension/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id, events: batch }),
      });
      // 404/409 mean the session is gone or closed. Retrying cannot fix that,
      // and a permanently-failing batch at the head of the buffer would block
      // every later event behind it forever.
      if (res.status === 404 || res.status === 409) {
        console.warn(`[LessMissed] dropping ${batch.length} events for dead session ${session_id}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      failed.push(...batch);
    }
  }

  if (failed.length) {
    const offlineQueue = await storageGet<unknown[]>('offlineQueue', []);
    await storageSet('offlineQueue', [...offlineQueue, ...failed].slice(-2000));
    scheduleOfflineDrain();
  }
}

const OFFLINE_ALARM = 'lm-offline-drain';

/**
 * Drain the offline buffer on a chrome.alarms schedule.
 *
 * Not setInterval: MV3 terminates the service worker when idle and the interval
 * dies with it, so a buffered batch could sit unsent indefinitely — the worker
 * has to be awake at the right moment for a timer to fire at all. Alarms wake
 * the worker, which is the whole point.
 */
function scheduleOfflineDrain(): void {
  // Creating an alarm that already exists replaces it, so this is idempotent
  // and needs no existence check — which also keeps it working against the
  // callback-style chrome typings this project pins.
  chrome.alarms.create(OFFLINE_ALARM, { periodInMinutes: 1 });
}

async function drainOfflineQueue(): Promise<void> {
  const offlineQueue = await storageGet<unknown[]>('offlineQueue', []);
  if (!offlineQueue.length) {
    chrome.alarms.clear(OFFLINE_ALARM);
    return;
  }

  // Clear first, then re-post: postEventBatch re-buffers whatever still fails,
  // so a partial success drains the part that worked instead of resending it.
  await storageRemove('offlineQueue');
  await postEventBatch(offlineQueue);

  const remaining = await storageGet<unknown[]>('offlineQueue', []);
  if (!remaining.length) chrome.alarms.clear(OFFLINE_ALARM);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === OFFLINE_ALARM) void drainOfflineQueue();
});

// Anything left buffered from a previous worker lifetime goes out as soon as
// this one starts.
void drainOfflineQueue();

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function createSession(payload: {
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
    return session_id;
  } catch {
    return null;
  }
}

/**
 * Record a page transition: registers the page server-side (auto-discovering it
 * if the site has one we've never seen) and reports whether it still needs a
 * screenshot.
 */
async function postVisit(
  session: ActiveSession,
  url: string,
  referrerPath: string | null
): Promise<void> {
  const path = pathOf(url);
  try {
    const res = await fetch(`${WEBAPP_URL}/api/extension/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: session.session_id,
        path,
        url,
        entered_at: new Date().toISOString(),
        referrer_path: referrerPath,
      }),
    });
    if (!res.ok) return;
  } catch {
    // Offline — the visit is lost but the events are not, and the backfill can
    // rebuild the journey from them.
  }
}

/** Move the session onto a new page in the tab it is bound to. */
async function recordNavigation(session: ActiveSession, url: string): Promise<void> {
  const path = pathOf(url);
  if (path === session.current_path) return;

  const now = new Date().toISOString();
  const open = session.visits.find((v) => !v.left_at);
  if (open) open.left_at = now;

  const previousPath = session.current_path;
  session.visits.push({ path, url, entered_at: now });
  session.current_path = path;

  // Tell the page where it now is.
  //
  // On a client-side route change the content script is never rebuilt and
  // cannot see the navigation for itself — patching history.pushState from an
  // isolated world does not intercept the page's own calls. This worker does
  // see it, which is why the visit records were right all along while the
  // events were filed under the entry page. Sent before the visit is posted so
  // the page stops mislabelling as early as possible.
  if (session.tab_id != null) {
    chrome.tabs.sendMessage(session.tab_id, { action: 'URL_CHANGED', path }, () => {
      // No content script yet on a hard load — it will read location itself.
      void chrome.runtime.lastError;
    });
  }

  await saveSession(session);
  await postVisit(session, url, previousPath);
  await saveSession(session);
}

/**
 * Wind the session up: close the last visit, hand the journey to the backend,
 * then capture whatever pages are still owed a screenshot.
 *
 * Deliberately NOT run inside withSession(). The drain opens a window and works
 * through it for tens of seconds, and holding the mutation mutex that long would
 * stall every navigation handler and every SESSION_HELLO behind it — including
 * the capture tab's own. The session record is cleared by the caller before this
 * runs, so there is no shared state left to serialise.
 */
async function finalizeSession(session: ActiveSession): Promise<void> {
  const endedAt = new Date().toISOString();

  const open = session.visits.find((v) => !v.left_at);
  if (open) open.left_at = endedAt;

  try {
    await fetch(`${WEBAPP_URL}/api/extension/sessions/${session.session_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ended_at: endedAt,
        pages_visited: session.visits.map((v) => ({
          path: v.path,
          entered_at: v.entered_at,
          left_at: v.left_at,
        })),
      }),
    });
  } catch {
    // Non-fatal — the raw events are already stored; only the rollup is missing.
  }
}

/** Take the session out of storage and hand it back, so the caller can wind it
 *  up without holding the mutex. Returns null if nothing was running. */
function claimSession(): Promise<ActiveSession | null> {
  return withSession(async (session) => {
    if (session) {
      await saveSession(null);
      await storageRemove('activeSessionId');
    }
    return session;
  });
}

// ---------------------------------------------------------------------------
// Navigation listeners — what keeps a session alive across pages
// ---------------------------------------------------------------------------

// Fires with changeInfo.url for both full page loads and SPA history changes,
// and needs no permission beyond the "tabs" one the manifest already requests.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  void withSession(async (session) => {
    if (!session) return;
    // Our own screenshot tab, driving itself through the queue.

    const onSite = isSiteUrl(changeInfo.url, session.domain);

    // A link opened in a new tab from the tracked one: follow the consumer's
    // attention there. Commerce sites open products with target="_blank"
    // constantly, and without this the session strands on the abandoned grid.
    if (tabId !== session.tab_id) {
      if (!onSite || tab.openerTabId !== session.tab_id) return;
      await sendToTab(session.tab_id, { action: 'STOP' });
      session.tab_id = tabId;
      session.paused = false;
      await saveSession(session);
      await recordNavigation(session, changeInfo.url!);
      return;
    }

    if (!onSite) {
      // Off the brand's site. Keep the session alive — they may be checking a
      // price elsewhere — but collect nothing until they return.
      if (!session.paused) {
        session.paused = true;
        await saveSession(session);
      }
      return;
    }

    // Persist the un-pause before recordNavigation, which returns early when the
    // path has not changed — coming back to the very page they left would
    // otherwise leave the session reading "paused" for the rest of the visit.
    if (session.paused) {
      session.paused = false;
      await saveSession(session);
    }
    await recordNavigation(session, changeInfo.url!);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const current = await loadSession();
    if (!current || tabId !== current.tab_id) return;
    const session = await claimSession();
    // The tab is gone, so there is nothing to send STOP to.
    if (session) await finalizeSession(session);
  })();
});

// ---------------------------------------------------------------------------
// Message handler — popup ↔ background ↔ content script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // ── A content script loaded: does it belong to the running session? ───────
  // This is what resumes tracking after a navigation. The content script asks on
  // every page load; nothing else can tell it a session is in progress.
  if (request.action === 'SESSION_HELLO') {
    const tabId = sender.tab?.id;

    void (async () => {
      const session = await loadSession();
      const mayTrack =
        !!session &&
        tabId != null &&
        tabId === session.tab_id &&
        isSiteUrl(request.url, session.domain);

      sendResponse(
        mayTrack ? { tracking: true, session_id: session!.session_id } : { tracking: false }
      );
    })();

    return true;
  }

  // ── Content script is unloading — it already flushed its queue ────────────
  if (request.action === 'PAGE_LEAVE') {
    return false;
  }

  // ── Event batch from content script ──────────────────────────────────────
  if (request.action === 'EVENTS_BATCH') {
    void postEventBatch(request.events ?? []);
    // Answer explicitly. Returning without calling sendResponse closes the
    // channel and sets chrome.runtime.lastError on the *sender* — which the
    // content script reads as "the send failed" and re-queues the batch. Every
    // successful send was being replayed on the next heartbeat, and one session
    // reached 108,460 events for 482 real moments before it was caught.
    sendResponse({ ok: true });
    return true;
  }

  // A page that could not resume tracking. Logged here rather than only in the
  // page's own console, because the page whose console would show it is the one
  // nobody is watching — and a silent failure here means a whole page of a
  // consumer's journey is recorded as visited but empty.
  if (request.action === 'RESUME_FAILED') {
    console.error(`[LessMissed] resume failed (${request.reason}) on ${request.url}`);
    void (async () => {
      const failures = await storageGet<unknown[]>('resumeFailures', []);
      await storageSet(
        'resumeFailures',
        [...failures, { reason: request.reason, url: request.url, at: new Date().toISOString() }]
          .slice(-50)
      );
    })();
    return false;
  }

  // ── Popup asks what's running ────────────────────────────────────────────
  if (request.action === 'SESSION_STATUS') {
    void withSession(async (session) => {
      if (!session) { sendResponse({ active: false }); return; }
      sendResponse({
        active: true,
        session_id: session.session_id,
        paused: session.paused,
        current_path: session.current_path,
        pages_visited: session.visits.length,
      });
    });
    return true;
  }

  // ── Session start ────────────────────────────────────────────────────────
  if (request.action === 'SESSION_START') {
    const { project_id, consumer_id, task_id, page_url, domain } = request;

    (async () => {
      const tab = await new Promise<chrome.tabs.Tab | undefined>((resolve) =>
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]))
      );
      if (!tab?.id || !tab.url) { sendResponse({ ok: false, error: 'No active tab' }); return; }

      const session_id = await createSession({ project_id, consumer_id, task_id, page_url });
      if (!session_id) { sendResponse({ ok: false, error: 'Failed to create session' }); return; }

      const now = new Date().toISOString();
      const session: ActiveSession = {
        session_id,
        project_id,
        consumer_id,
        domain: (domain ?? '').replace(/^www\./, ''),
        tab_id: tab.id,
        paused: false,
        started_at: now,
        current_path: pathOf(tab.url),
        visits: [{ path: pathOf(tab.url), url: tab.url, entered_at: now }],
      };
      await saveSession(session);
      await storageSet('activeSessionId', session_id);

      // Register the entry page and find out whether it needs a screenshot; the
      // session row already holds it, this is what queues the capture.
      await postVisit(session, tab.url, null);
      await saveSession(session);

      chrome.tabs.sendMessage(tab.id, { action: 'START', session_id }, (csResponse) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: 'content_script_not_ready' });
          return;
        }
        sendResponse({ ok: true, session_id, tracking: csResponse?.status === 'started' });
      });
    })();

    return true;
  }

  // ── Session end ──────────────────────────────────────────────────────────
  if (request.action === 'SESSION_END') {
    void (async () => {
      const session = await claimSession();

      // Respond before the screenshot drain — it can run for half a minute, and
      // the popup is usually closed well before then.
      sendResponse({ ok: true });

      if (!session) return;
      await sendToTab(session.tab_id, { action: 'STOP' });
      await finalizeSession(session);
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

// A browser restart leaves a session record pointing at a tab that no longer
// exists. Clear it so the popup doesn't offer to stop a session that is gone.
chrome.runtime.onStartup.addListener(() => {
  void storageRemove(SESSION_KEY);
  void storageRemove('activeSessionId');
});
