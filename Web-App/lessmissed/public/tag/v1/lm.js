/*!
 * LessMissed Tag v1.0.0
 *
 * A drop-in head script that captures the same signals the LessMissed browser
 * extension does — clicks, scrolls, cursor motion, page visibility, SPA
 * navigation, and (with camera consent) gaze — and posts them to the tag
 * ingest API. Intended to be embedded once on a brand's site:
 *
 *   <script src="https://lessmissed.com/tag/v1/lm.js" data-lm-key="pk_..." async></script>
 *
 * The API shape it targets (POST /api/tag/{sessions,events,visits}, PATCH
 * /api/tag/sessions/:id) is the mirror of /api/extension/*, and the
 * downstream insight pipeline is identical — no analytics-side changes.
 *
 * Design notes:
 *  - Auth is a publishable pk_ key in a request header, per project. The
 *    origin check on the server is the real anti-abuse boundary.
 *  - Visitor identity is a first-party UUID cookie on the brand's own
 *    domain; the server upserts an anonymous User row so every downstream
 *    ref stays typed.
 *  - Cross-tab session state via localStorage + BroadcastChannel — a second
 *    tab of the same origin joins the running session instead of starting
 *    its own.
 *  - SPA navigation is intercepted by patching history.pushState in the
 *    page's own JS realm, which the extension's isolated world could not
 *    do (see the comment in background.ts:285).
 *  - Consent-gated boot: if window.LM_REQUIRE_CONSENT === true is set
 *    before this script loads, the tag waits for window.LessMissed.start()
 *    before doing anything network-facing.
 */
(function () {
  'use strict';

  if (window.__lmLoaded) return; // idempotent — a brand may include the tag twice
  window.__lmLoaded = true;

  // ── Config from <script> tag ─────────────────────────────────────────────
  var scriptEl =
    document.currentScript ||
    document.querySelector('script[src*="/tag/v1/lm.js"][data-lm-key]');
  if (!scriptEl) {
    console.warn('[LessMissed] tag script tag not found — cannot self-config');
    return;
  }
  var API_KEY = scriptEl.getAttribute('data-lm-key');
  if (!API_KEY) {
    console.warn('[LessMissed] data-lm-key missing on <script>');
    return;
  }
  var API_BASE = new URL(scriptEl.src).origin;

  var VERSION = '1.0.0';
  var COOKIE_NAME = 'lm_vid';
  var COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year
  var STORAGE_KEY = 'lm.session.v1';
  var OFFLINE_KEY = 'lm.offline.v1';
  var BATCH_INTERVAL_MS = 1000;
  var BATCH_MAX_SIZE = 50;
  var OFFLINE_MAX = 2000;
  var SESSION_IDLE_MS = 30 * 60 * 1000; // 30 min inactivity ends session
  var GAZE_FPS = 10;
  var CURSOR_FPS = 8;
  var SCROLL_FPS = 4;
  var SCROLL_STOP_MS = 300;
  var MIN_INTERACTIVE_TAGS = new Set([
    'a', 'button', 'input', 'select', 'textarea', 'label', 'summary',
  ]);

  // ── Consent gate ─────────────────────────────────────────────────────────
  // Brands in consent-required jurisdictions can set this global before this
  // script loads to defer boot until the user opts in.
  var requireConsent = window.LM_REQUIRE_CONSENT === true;
  var consentGranted = !requireConsent;

  // ── Public API namespace ────────────────────────────────────────────────
  var LessMissed = {
    version: VERSION,
    start: function () {
      consentGranted = true;
      maybeBoot();
    },
    stop: function () {
      endSession('user_stop');
    },
    // Escape hatch for turning off gaze at runtime (e.g., after user revokes
    // camera in their browser settings — the tag can't observe that live).
    disableGaze: function () {
      gazeEnabled = false;
      teardownWebGazer();
    },
    status: function () {
      return {
        session: session,
        gaze: !!webgazerReady,
        queue: queue.length,
      };
    },
  };
  window.LessMissed = LessMissed;

  // ── Visitor identity ────────────────────────────────────────────────────
  function getRootDomain() {
    // Best-effort: strip a single subdomain so a cookie set on the parent
    // domain is readable from every subdomain (checkout.brand.com sees the
    // same visitor as brand.com). Public suffixes aren't handled — brands
    // on co.uk-style TLDs may need to set the domain explicitly later.
    var parts = location.hostname.split('.');
    if (parts.length <= 2) return location.hostname;
    return parts.slice(-2).join('.');
  }
  function getVisitorId() {
    var m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE_NAME + '=([^;]+)'));
    if (m) return m[1];
    var id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    try {
      document.cookie =
        COOKIE_NAME + '=' + id +
        '; max-age=' + COOKIE_MAX_AGE +
        '; path=/; domain=.' + getRootDomain() +
        '; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) {
      // Some browsers block writing cookies for privacy reasons; keep the id
      // in localStorage as a fallback so at least this tab is consistent.
      try { localStorage.setItem(COOKIE_NAME, id); } catch (_) { /* give up */ }
    }
    return id;
  }
  var VISITOR_ID = getVisitorId();

  // ── Cross-tab session state ─────────────────────────────────────────────
  var session = null; // { session_id, project_id, started_at, current_path, visits: [] }
  var channel = null;
  try {
    channel = new BroadcastChannel('lm.channel');
    channel.onmessage = function (msg) {
      if (!msg || !msg.data) return;
      if (msg.data.type === 'session') session = msg.data.session;
      if (msg.data.type === 'stop') endSession('other_tab');
    };
  } catch (_) { /* older browser without BroadcastChannel — degrade to storage events */ }

  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY) return;
    session = e.newValue ? safeParse(e.newValue) : null;
  });

  function loadSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? safeParse(raw) : null;
    } catch (_) { return null; }
  }
  function saveSession(s) {
    try {
      if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* private mode etc. — session persists in memory only */ }
    if (channel) try { channel.postMessage({ type: 'session', session: s }); } catch (_) {}
  }
  function safeParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }

  // ── Element resolution — ports from contentScript.ts:describeTarget ─────
  function resolveElementId(el) {
    if (!el) return '';
    var id = el.id ? '#' + el.id : '';
    if (id) return id;
    var tag = (el.tagName || '').toLowerCase();
    var cls = el.className && typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    return cls ? tag + '.' + cls : tag;
  }
  function resolveElementKey(el) {
    // Positional path so unclassed elements don't collapse into one bucket.
    // Bounded depth so an infinite tree can't hang us.
    if (!el || !el.parentElement) return resolveElementId(el);
    var parts = [];
    var cur = el;
    for (var depth = 0; cur && cur.parentElement && depth < 8; depth++) {
      var tag = cur.tagName.toLowerCase();
      var idx = 1, sib = cur;
      while ((sib = sib.previousElementSibling)) {
        if (sib.tagName === cur.tagName) idx++;
      }
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      cur = cur.parentElement;
    }
    return parts.join('>');
  }
  function describeTarget(el) {
    if (!el) {
      return {
        element_id: '', element_key: '', element_tag: '',
        element_text: '', element_alt: '', element_aria: '', element_title: '',
        element_src: '', element_rect: null,
      };
    }
    var rect = null;
    try {
      var r = el.getBoundingClientRect();
      rect = {
        x: Math.round(r.left + window.scrollX),
        y: Math.round(r.top + window.scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    } catch (_) { rect = null; }
    var text = ((el.innerText || '') + '').trim().slice(0, 80);
    var src = '';
    if (el.currentSrc || el.src) {
      var raw = (el.currentSrc || el.src) + '';
      src = raw.split('?')[0].split('/').pop().slice(0, 80);
    }
    return {
      element_id: resolveElementId(el),
      element_key: resolveElementKey(el),
      element_tag: (el.tagName || '').toLowerCase(),
      element_text: text,
      element_alt: ((el.alt || '') + '').trim().slice(0, 80),
      element_aria: ((el.getAttribute && el.getAttribute('aria-label')) || '').trim().slice(0, 80),
      element_title: ((el.getAttribute && el.getAttribute('title')) || '').trim().slice(0, 80),
      element_src: src,
      element_rect: rect,
    };
  }

  // ── Event queue + batching ──────────────────────────────────────────────
  var queue = [];
  var batchTimer = null;
  function currentUrl() { return location.pathname + location.search; }

  function queueEvent(ev) {
    if (!session) return;
    queue.push({
      timestamp: new Date().toISOString(),
      type: ev.type,
      page_url: currentUrl(),
      data: ev.data || {},
    });
    if (queue.length >= BATCH_MAX_SIZE) flushBatch();
  }
  function startBatchTimer() {
    if (batchTimer) return;
    batchTimer = setInterval(flushBatch, BATCH_INTERVAL_MS);
  }
  function stopBatchTimer() {
    if (batchTimer) { clearInterval(batchTimer); batchTimer = null; }
  }

  function flushBatch(useBeacon) {
    if (!session || !queue.length) return;
    var batch = queue.splice(0);
    var body = JSON.stringify({ session_id: session.session_id, events: batch });

    if (useBeacon && navigator.sendBeacon) {
      // sendBeacon is the only way to reliably post from unload — but it
      // doesn't set custom headers, so the API key rides in the URL. The
      // route accepts both; see extractApiKey().
      try {
        var ok = navigator.sendBeacon(
          API_BASE + '/api/tag/events?key=' + encodeURIComponent(API_KEY),
          new Blob([body], { type: 'application/json' })
        );
        if (ok) return;
      } catch (_) { /* fall through to fetch */ }
    }

    fetch(API_BASE + '/api/tag/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lessmissed-Key': API_KEY },
      body: body,
      keepalive: true,
      credentials: 'omit',
    }).then(function (res) {
      if (res.status === 404 || res.status === 409) return; // dead session — drop
      if (!res.ok) enqueueOffline(batch);
    }).catch(function () { enqueueOffline(batch); });
  }

  function enqueueOffline(batch) {
    try {
      var raw = localStorage.getItem(OFFLINE_KEY);
      var arr = raw ? safeParse(raw) : [];
      if (!Array.isArray(arr)) arr = [];
      arr = arr.concat(batch).slice(-OFFLINE_MAX);
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(arr));
    } catch (_) { /* over storage quota; drop */ }
  }
  function drainOffline() {
    if (!session) return;
    var raw; try { raw = localStorage.getItem(OFFLINE_KEY); } catch (_) { return; }
    if (!raw) return;
    var arr = safeParse(raw);
    if (!Array.isArray(arr) || !arr.length) return;
    try { localStorage.removeItem(OFFLINE_KEY); } catch (_) {}
    // Split into batches of BATCH_MAX_SIZE. Any that fail re-queue.
    for (var i = 0; i < arr.length; i += BATCH_MAX_SIZE) {
      var slice = arr.slice(i, i + BATCH_MAX_SIZE);
      queue.push.apply(queue, slice);
    }
    flushBatch();
  }

  // ── DOM listeners ───────────────────────────────────────────────────────
  var lastCursorAt = 0;
  var lastScrollAt = 0;
  var lastScrollStopTimer = null;
  var maxScrollDepthPct = 0;

  document.addEventListener('click', function (e) {
    if (!session) return;
    var el = /** @type {HTMLElement} */ (e.target);
    var desc = describeTarget(el);
    queueEvent({
      type: 'click',
      data: {
        viewport_x: e.clientX,
        viewport_y: e.clientY,
        scroll_x: window.scrollX,
        scroll_y: window.scrollY,
        ...desc,
        is_interactive: MIN_INTERACTIVE_TAGS.has(desc.element_tag),
      },
    });
    // Click-based recalibration for WebGazer — same trick as the extension.
    if (webgazerReady && window.webgazer) {
      try {
        window.webgazer.recordScreenPosition(
          e.clientX + window.scrollX,
          e.clientY + window.scrollY,
          'click'
        );
      } catch (_) {}
    }
  }, { capture: true });

  document.addEventListener('mousemove', function (e) {
    if (!session) return;
    var now = Date.now();
    if (now - lastCursorAt < 1000 / CURSOR_FPS) return;
    lastCursorAt = now;
    queueEvent({
      type: 'cursor',
      data: {
        viewport_x: e.clientX,
        viewport_y: e.clientY,
        scroll_x: window.scrollX,
        scroll_y: window.scrollY,
      },
    });
  }, { passive: true });

  function scrollDepthPct() {
    var docH = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    ) - window.innerHeight;
    if (docH <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((window.scrollY / docH) * 100)));
  }
  window.addEventListener('scroll', function () {
    if (!session) return;
    var now = Date.now();
    var depth = scrollDepthPct();
    if (depth > maxScrollDepthPct) maxScrollDepthPct = depth;
    if (now - lastScrollAt >= 1000 / SCROLL_FPS) {
      lastScrollAt = now;
      queueEvent({
        type: 'scroll',
        data: { scroll_y: window.scrollY, depth_pct: depth, is_stop: false },
      });
    }
    if (lastScrollStopTimer) clearTimeout(lastScrollStopTimer);
    lastScrollStopTimer = setTimeout(function () {
      queueEvent({
        type: 'scroll',
        data: { scroll_y: window.scrollY, depth_pct: scrollDepthPct(), is_stop: true },
      });
    }, SCROLL_STOP_MS);
  }, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (!session) return;
    var hidden = document.hidden;
    queueEvent({ type: 'visibility', data: { visible: !hidden } });
    if (hidden) flushBatch();
  });

  // pagehide is the last message point before a hard navigation or tab
  // close. beforeunload is not fireable on mobile Safari — pagehide is what
  // covers both cases. Post the queue via sendBeacon and PATCH the session
  // shutdown from the same event so nothing is dropped.
  window.addEventListener('pagehide', function () {
    if (!session) return;
    flushBatch(true);
    // Whether to fully finalize on pagehide is a judgement call: a full-page
    // navigation to another page of the same site means the session should
    // continue on the next load, so we don't PATCH ended_at here — the visit
    // recorder on the next page will resume. If the user is leaving the
    // site entirely, the session will time out server-side.
  });

  // ── SPA route detection ─────────────────────────────────────────────────
  // Patching history.pushState/replaceState here works because we're in the
  // page's own JS realm — the extension's isolated world couldn't intercept
  // the page's own calls (see background.ts:285). This is one of the few
  // spots where the tag is actually *simpler* than the extension.
  (function patchHistory() {
    var origPush = history.pushState;
    var origReplace = history.replaceState;
    function fireChange() {
      // Defer to the next microtask so listeners see the new location.href.
      queueMicrotask(function () {
        onUrlChange();
      });
    }
    history.pushState = function () {
      var r = origPush.apply(this, arguments);
      fireChange();
      return r;
    };
    history.replaceState = function () {
      var r = origReplace.apply(this, arguments);
      fireChange();
      return r;
    };
    window.addEventListener('popstate', fireChange);
    window.addEventListener('hashchange', fireChange);
  })();

  var lastVisitPath = null;
  function onUrlChange() {
    if (!session) return;
    var path = currentUrl();
    if (path === lastVisitPath) return;
    var referrer = lastVisitPath;
    lastVisitPath = path;
    maxScrollDepthPct = 0;
    postVisit(path, location.href, referrer);
  }

  function postVisit(path, url, referrerPath) {
    if (!session) return;
    fetch(API_BASE + '/api/tag/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lessmissed-Key': API_KEY },
      body: JSON.stringify({
        session_id: session.session_id,
        path: path,
        url: url,
        entered_at: new Date().toISOString(),
        referrer_path: referrerPath,
      }),
      credentials: 'omit',
      keepalive: true,
    }).catch(function () { /* non-fatal — visit will be reconstructed from events */ });
  }

  // ── Session lifecycle ───────────────────────────────────────────────────
  function startSession() {
    if (session) return Promise.resolve(session);
    var vp = { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 };
    var breakpoint = vp.w < 768 ? 'mobile' : 'desktop';
    var pageUrl = currentUrl();

    return fetch(API_BASE + '/api/tag/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lessmissed-Key': API_KEY },
      body: JSON.stringify({
        visitor_id: VISITOR_ID,
        page_url: pageUrl,
        viewport_width: vp.w,
        viewport_height: vp.h,
        dpr: vp.dpr,
        breakpoint: breakpoint,
        started_at: new Date().toISOString(),
      }),
      credentials: 'omit',
    })
      .then(function (r) { return r.json().then(function (b) { return { r: r, b: b }; }); })
      .then(function (x) {
        if (!x.r.ok || !x.b || !x.b.session_id) {
          console.warn('[LessMissed] session create failed:', x.b && x.b.error);
          return null;
        }
        session = {
          session_id: x.b.session_id,
          started_at: new Date().toISOString(),
          current_path: pageUrl,
          visits: [{ path: pageUrl, url: location.href, entered_at: new Date().toISOString() }],
        };
        lastVisitPath = pageUrl;
        saveSession(session);
        startBatchTimer();
        drainOffline();
        // Ensure the entry page shows up as a visit; the server would infer
        // it from the session record but only if it matches its own template
        // resolution — safer to POST it explicitly.
        postVisit(pageUrl, location.href, null);
        return session;
      })
      .catch(function (err) {
        console.warn('[LessMissed] session create error:', err && err.message);
        return null;
      });
  }

  function endSession(reason) {
    if (!session) return;
    var finalPayload = {
      ended_at: new Date().toISOString(),
      max_scroll_depth_pct: maxScrollDepthPct,
      pages_visited: session.visits,
    };
    // Best-effort finalize. Use sendBeacon so unload paths still deliver.
    var url = API_BASE + '/api/tag/sessions/' + encodeURIComponent(session.session_id)
      + '?key=' + encodeURIComponent(API_KEY);
    try {
      // sendBeacon is POST-only; we can't PATCH via it. Fall back to fetch
      // with keepalive; if the tab really is closing, the browser will
      // still send the request in the background.
      fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload),
        keepalive: true,
        credentials: 'omit',
      }).catch(function () {});
    } catch (_) {}

    flushBatch(true);
    teardownWebGazer();
    stopBatchTimer();
    session = null;
    saveSession(null);
    if (channel) try { channel.postMessage({ type: 'stop', reason: reason }); } catch (_) {}
  }

  // ── WebGazer wiring ─────────────────────────────────────────────────────
  var gazeEnabled = true; // may be flipped off by disableGaze()
  var webgazerReady = false;

  // WebGazer's begin() fetches its face-detection models from tfhub.dev, which
  // now 302s to a signed Kaggle URL that expires in three hours — so every
  // page load is a fresh ~6 MB download, and any failure silently kills gaze
  // for that page. The extension takes the same models out of the network
  // path by rewriting these URLs onto its bundle; we do the same, pointing
  // them at /tag/v1/models/ on our own origin. See contentScript.ts:380.
  var TFHUB_MODEL_MAP = [
    [/tfhub\.dev\/tensorflow\/tfjs-model\/blazeface\//i, 'blazeface'],
    [/tfhub\.dev\/mediapipe\/tfjs-model\/facemesh\//i, 'facemesh'],
    [/tfhub\.dev\/mediapipe\/tfjs-model\/iris\//i, 'iris'],
  ];
  function localModelUrl(url) {
    for (var i = 0; i < TFHUB_MODEL_MAP.length; i++) {
      var pattern = TFHUB_MODEL_MAP[i][0];
      var dir = TFHUB_MODEL_MAP[i][1];
      if (!pattern.test(url)) continue;
      var file = url.split('?')[0].split('/').pop();
      if (!file) return null;
      return API_BASE + '/tag/v1/models/' + dir + '/' + file;
    }
    return null;
  }
  var modelFetchPatched = false;
  function patchModelFetch() {
    if (modelFetchPatched) return;
    modelFetchPatched = true;
    var nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url);
      var local = typeof url === 'string' ? localModelUrl(url) : null;
      return local ? nativeFetch(local, init) : nativeFetch(input, init);
    };
  }

  function loadWebGazer() {
    return new Promise(function (resolve, reject) {
      if (window.webgazer) return resolve(window.webgazer);
      var s = document.createElement('script');
      s.src = API_BASE + '/tag/v1/webgazer.js';
      s.async = true;
      s.onload = function () {
        window.webgazer ? resolve(window.webgazer) : reject(new Error('webgazer missing after load'));
      };
      s.onerror = function () { reject(new Error('failed to load webgazer.js')); };
      document.head.appendChild(s);
    });
  }

  function initWebGazer() {
    if (!gazeEnabled || webgazerReady) return;
    // Patch fetch BEFORE webgazer's script loads — begin() may fire model
    // requests almost immediately after script parse depending on the build.
    patchModelFetch();
    loadWebGazer()
      .then(function (webgazer) {
        try {
          webgazer.params = webgazer.params || {};
          webgazer.params.applyKalmanFilter = true;
          webgazer.params.saveDataAcrossSessions = true;
          webgazer.showPredictionPoints(false);
          webgazer.showVideoPreview(false);
          webgazer.showFaceOverlay(false);
          webgazer.showFaceFeedbackBox(false);
          webgazer.setGazeListener(onGaze);
          return webgazer.begin();
        } catch (err) {
          throw err;
        }
      })
      .then(function () {
        webgazerReady = true;
        try {
          window.webgazer.setGazeListener(onGaze);
        } catch (_) {}
      })
      .catch(function (err) {
        // Camera denied, model load failed, etc. Tag continues without gaze
        // — click/scroll/cursor insights still function.
        console.warn('[LessMissed] gaze disabled:', err && err.message);
        webgazerReady = false;
      });
  }

  function teardownWebGazer() {
    if (window.webgazer && webgazerReady) {
      try { window.webgazer.end(); } catch (_) {}
      try { window.webgazer.clearGazeListener(); } catch (_) {}
    }
    webgazerReady = false;
  }

  // Gaze smoothing state — moving avg + outlier rejection at ~10 fps.
  // Same defaults as contentScript.ts.
  var gazeBuf = [];
  var GAZE_BUF = 6;
  var lastGazeAt = 0;
  function onGaze(data) {
    if (!data || !session) return;
    var now = Date.now();
    if (now - lastGazeAt < 1000 / GAZE_FPS) return;
    lastGazeAt = now;

    gazeBuf.push({ x: data.x, y: data.y });
    if (gazeBuf.length > GAZE_BUF) gazeBuf.shift();

    var sumX = 0, sumY = 0;
    for (var i = 0; i < gazeBuf.length; i++) { sumX += gazeBuf[i].x; sumY += gazeBuf[i].y; }
    var mx = sumX / gazeBuf.length, my = sumY / gazeBuf.length;

    // Outlier rejection — one wild sample shouldn't drag the mean if the
    // rest are stable. Distance > 200px from moving mean is dropped.
    var dx = data.x - mx, dy = data.y - my;
    if (dx * dx + dy * dy > 200 * 200 && gazeBuf.length >= 3) return;

    var pageX = Math.round(mx + window.scrollX);
    var pageY = Math.round(my + window.scrollY);
    var el = null;
    try { el = document.elementFromPoint(mx, my); } catch (_) {}
    var desc = describeTarget(el);

    queueEvent({
      type: 'gaze',
      data: Object.assign({
        viewport_x: Math.round(mx),
        viewport_y: Math.round(my),
        scroll_x: window.scrollX,
        scroll_y: window.scrollY,
        page_x: pageX,
        page_y: pageY,
      }, desc),
    });
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  // If another tab of the same origin already has a session, adopt it rather
  // than starting a fresh one — the API only allows one active session per
  // consumer/project anyway, and joining is what a user expects when they
  // open the site in a second tab.
  function maybeBoot() {
    if (!consentGranted) return;
    session = loadSession();
    if (session && isFreshEnough(session)) {
      lastVisitPath = currentUrl();
      startBatchTimer();
      drainOffline();
      postVisit(currentUrl(), location.href, null);
      initWebGazer();
      return;
    }
    // Stale or absent → start fresh.
    startSession().then(function (s) {
      if (s) initWebGazer();
    });
  }
  function isFreshEnough(s) {
    if (!s || !s.session_id || !s.started_at) return false;
    var age = Date.now() - new Date(s.started_at).getTime();
    return age < SESSION_IDLE_MS;
  }

  // The bootstrap is deferred to the next task so the brand can set
  // window.LM_REQUIRE_CONSENT after including the script tag but before we
  // start doing network work.
  setTimeout(maybeBoot, 0);
})();
