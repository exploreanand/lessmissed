# LessMissed Chrome Extension — Build Plan

**Stack**: TypeScript · React · Webpack (already configured)  
**Target**: Chrome 102+ · Manifest V3  
**Companion webapp**: `../Web-App/lessmissed` (Next.js, running at `http://localhost:3000`)

---

## Current State

| File | Status |
|---|---|
| `manifest.json` | Basic — wrong name, missing permissions |
| `background.ts` | Empty placeholder |
| `contentScript.ts` | WebGazer wired, START/STOP/CALIBRATE working |
| `popup.tsx` | Basic toggle UI, no task management |
| `options.tsx` | Empty |
| `webgazer.js` | Bundled ✅ |

---

## Build Todos

### PHASE 0 — Foundation (do first, unblocks everything)

- [x] Move extension to `LESSMISSED/lessmissed_extension/` (sibling to `Web-App/`)
- [ ] **Rename extension** in `manifest.json`: `"name": "LessMissed"`
- [ ] **Update `manifest.json`** — add all required permissions:
  - `tabs`, `scripting`, `storage`, `tabCapture`
  - `optional_host_permissions: ["*://*/*"]`
  - Remove hardcoded `content_scripts` (use dynamic injection via `scripting` API instead)
  - Add `web_accessible_resources` for overlay.html + calibration.html
- [ ] **Add webapp base URL constant** to `background.ts`:  
  `const WEBAPP_URL = 'http://localhost:3000'` (dev) → env swap for prod

---

### PHASE 1 — Screenshot (already being built)

- [x] `GET_PAGE_DIMS` handler in `contentScript.ts`
- [x] `SCROLL_TO` / `RESTORE_SCROLL` handlers in `contentScript.ts`
- [x] Full-page scroll+stitch screenshot in `background.ts`
- [x] Upload to `POST /api/extension/screenshot` in webapp
- [x] "Capture Page" button in `popup.tsx`

---

### PHASE 2 — Session & Task Management

- [ ] **`GET /api/extension/tasks`** — fetch available tasks from webapp
  - Extension needs auth token (store in `chrome.storage.local` after consumer login)
- [ ] **Popup: Task Picker screen**
  - List available tasks with brand name, reward value, estimated time
  - "Start" button per task
- [ ] **Popup: Task Active screen**
  - Show pages remaining (e.g., "Page 2 of 3")
  - Progress bar
  - "Stop task" button
- [ ] **Popup: Reward Earned screen**
  - Confetti / celebration state
  - Show coupon code
  - "Copy code" button
- [ ] **`POST /api/extension/session/start`** — create session, get `session_id` + `pages_to_track`
- [ ] **`POST /api/extension/session/page`** — notify backend when a required page is visited
- [ ] **`POST /api/extension/session/end`** — close session, receive reward

---

### PHASE 3 — Data Collection (5 Signals)

All signals must be collected ONLY when a task session is active AND `document.visibilityState === 'visible'`.

#### Signal 1 — Gaze (WebGazer)
- [ ] Start WebGazer only when task session is active (not on every page)
- [ ] Apply Kalman-like smoothing: `smoothX = currentX * 0.2 + prevSmoothX * 0.8`
- [ ] Discard samples with `confidence < 0.4`
- [ ] Resolve element under gaze via `document.elementFromPoint(x, y)`
- [ ] Capture `element_id`, `element_xpath`, scroll offsets, `confidence`
- [ ] Add gaze samples to batch buffer

#### Signal 2 — Clicks
- [ ] `addEventListener('click')` in content script
- [ ] Capture: `viewport_x/y`, `document_x/y`, `element_id`, `element_tag`, `element_text`, `element_classes`, `is_interactive`
- [ ] **Rage click detection**: same element, 3+ clicks within 1500ms → flag `is_rage_click: true`
- [ ] **Dead click detection**: `is_interactive === false` and element not a container → flag `is_dead_click: true`
- [ ] Add to batch buffer

#### Signal 3 — Scroll
- [ ] `addEventListener('scroll')` throttled to 10fps (100ms)
- [ ] Capture: `scroll_y`, `scroll_direction` (compare with previous), `scroll_velocity` (px/s), `scroll_depth_percent`
- [ ] Add to batch buffer

#### Signal 4 — Hover / Cursor
- [ ] `addEventListener('mousemove')` throttled to 10fps
- [ ] Capture: `viewport_x/y`, `document_x/y`, `element_id`
- [ ] Add to batch buffer

#### Signal 5 — Page Visibility
- [ ] `addEventListener('visibilitychange')` 
- [ ] On `hidden`: pause all other signal collection, send visibility event
- [ ] On `visible`: resume collection
- [ ] Track `active_time_ms` (cumulative time visible)

---

### PHASE 4 — WebSocket Streaming

- [ ] Open WebSocket (`wss://`) in `background.ts` when session starts
- [ ] Authenticate on handshake: `{ session_id, websocket_token }`
- [ ] **Batch sender**: collect up to 20 events → flush every 333ms (3×/sec)
  - Content script → `chrome.runtime.sendMessage({ type: 'events', batch: [...] })`
  - Background → WebSocket `send(JSON.stringify(batch))`
- [ ] **Auto-reconnect** with exponential backoff (max 30s)
- [ ] **Offline buffer**: if WebSocket disconnected, store in `chrome.storage.local` (max 1000 events)
- [ ] Flush offline buffer on reconnect

---

### PHASE 5 — Navigation & SPA Detection

- [ ] **Traditional navigation**: content script re-injects on each page load
- [ ] **SPA detection** (intercept `pushState` + `popstate`):
  ```typescript
  const orig = history.pushState;
  history.pushState = function(...args) {
    orig.apply(this, args);
    handleRouteChange(window.location.pathname);
  };
  window.addEventListener('popstate', () => {
    handleRouteChange(window.location.pathname);
  });
  ```
- [ ] `handleRouteChange`: check if new path is in `pages_to_track`, notify background, `POST /api/extension/session/page`

---

### PHASE 6 — Gaze Overlay (iframe approach per SRS)

The SRS requires the camera/WebGazer to run inside an **iframe overlay** with Shadow DOM to prevent CSS conflicts. Currently WebGazer runs directly in the content script which will conflict with host pages.

- [ ] Create `overlay.html` + `overlay.ts` — hosts WebGazer, requests camera
- [ ] Content script creates iframe pointing to `overlay.html` inside Shadow DOM
- [ ] `overlay.html` → `content.ts` communication via `window.postMessage`:
  ```
  overlay → content: { type: 'gaze', x, y, confidence }
  ```
- [ ] Content script adds scroll offsets, resolves element, adds to batch
- [ ] `pointer-events: none` on overlay during browsing, `all` during calibration

---

### PHASE 7 — Calibration Improvements

Current calibration is 9-point and works. Needs:
- [ ] Move calibration to the overlay iframe (not directly on host page)
- [ ] Reduce to **5-point** calibration as per SRS
- [ ] Re-calibrate at **start of each task session** (not just on demand)
- [ ] Store calibration data in `chrome.storage.local` for persistence
- [ ] Target completion time: under 20 seconds

---

### PHASE 8 — Permission & Privacy UX

- [ ] **Host permission request** — `chrome.permissions.request()` for each new brand domain
- [ ] **Permission grant screen** — show before starting any task on new domain
- [ ] **Extension icon badge**:
  - Gray = idle
  - Green (+ gaze icon) = tracking active
  - Gold (+ star) = reward earned
- [ ] **Tracking status bar** — thin bar injected at top of page showing domain + "tracking on/off"
- [ ] **Privacy always visible** in popup: "Camera: ON · Tracking: acme.com only"

---

### PHASE 9 — Authentication

- [ ] Consumer login in extension popup (or redirect to webapp)
- [ ] Store JWT in `chrome.storage.local` (`lessmissed_token`)
- [ ] Auto-attach token to all API calls and WebSocket handshake
- [ ] Handle token expiry (7-day refresh per SRS)

---

## File Structure (target)

```
lessmissed_extension/
  src/
    static/
      manifest.json          ← update
      icon-idle.png
      icon-active.png
      icon-reward.png
    background/
      background.ts          ← session mgmt, WebSocket, screenshot, permissions
    contentScript/
      contentScript.ts       ← 5 signals, SPA detection, page dims
    overlay/
      overlay.html           ← NEW: camera iframe host
      overlay.ts             ← NEW: WebGazer init, postMessage gaze to parent
    calibration/
      calibration.html       ← NEW: 5-point calibration (in overlay)
      calibration.ts         ← NEW
    popup/
      popup.tsx              ← task picker / active / reward states
      popup.css
    options/
      options.tsx            ← settings: webapp URL, auth status
```

---

## Key Constraints (from SRS)

| Rule | Source |
|---|---|
| Never collect data when `visibilityState === 'hidden'` | SRS §4.5 |
| Never transmit video/photos from webcam | SRS §13.1 |
| Batch ≤20 events, flush every 333ms | SRS §5.1 |
| Re-calibrate at start of each task | SRS §FR-L4-08 |
| Never show engagement score to consumer | SRS §6.6 |
| Host permission per brand domain (not `<all_urls>` by default) | SRS §FR-L4-01/02 |
