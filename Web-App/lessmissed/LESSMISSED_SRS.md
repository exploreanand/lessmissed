# LessMissed — Software Requirements Specification (SRS)

**Version**: 1.0
**Date**: March 2026
**Classification**: Internal — Product & Engineering

---

## Table of Contents

1. Introduction
2. System Overview
3. User Roles & Personas
4. Data Collection Layer — 5 Signals
5. Data Processing Pipeline
6. Engagement Score System (Quality Gate)
7. Insight Engine — Complete Catalog (23 Insights)
8. Product Layers & Functional Requirements
9. Data Models & Schema
10. API Specifications
11. Chrome Extension Technical Specification
12. Non-Functional Requirements
13. Security & Privacy Requirements
14. Third-Party Dependencies
15. Deployment Architecture
16. Build Priority & Phasing

---

## 1. Introduction

### 1.1 Purpose

This SRS defines all functional and non-functional requirements for LessMissed, a three-sided marketplace for usability intelligence. It serves as the single source of truth for all engineering, design, and product decisions.

### 1.2 Scope

LessMissed consists of:
- A marketing website (Layer 1)
- A client analytics dashboard (Layer 2)
- A consumer rewards web app (Layer 3)
- A Chrome browser extension with eye-tracking capability (Layer 4)
- A real-time data pipeline for gaze, click, scroll, hover, and visibility signals
- An insight computation engine that transforms raw signals into actionable UX intelligence
- A reward/coupon management system

### 1.3 Definitions

| Term | Definition |
|------|-----------|
| Client | Brand or UX team that pays for insights. Creates projects, configures pages, views analytics. |
| Consumer | Real user who installs the extension, completes browsing tasks, earns rewards. |
| Project | A client's website being tracked (e.g., acme.com). Contains multiple pages. |
| Page | A specific URL path within a project (e.g., /checkout). Must be explicitly configured by client. |
| Task | A browsing assignment created by the client. Specifies pages to visit + reward offered. |
| Session | One consumer completing one task. Begins at task start, ends when all pages visited or consumer stops. |
| Fixation | A gaze point that remains within a ~50px radius for 200ms+. Indicates the user is looking at something. |
| Saccade | Rapid eye movement between fixations. Travel time, not attention. |
| Engagement Score | 0-100 quality metric per session. Measures genuine browsing vs. gaming. |

### 1.4 References

- WebGazer.js documentation (https://webgazer.cs.brown.edu/)
- Chrome Extensions Manifest V3 documentation
- rrweb documentation (https://www.rrweb.io/)
- heatmap.js documentation
- Research papers in project files: Eye Tracking in HCI, Measuring Cognitive Load, Using Cursor Movements, WebGazer paper

---

## 2. System Overview

### 2.1 Architecture Diagram (Textual)

```
Consumer's Browser (Extension)
    |
    |-- Gaze coordinates (WebGazer.js, 30-60 fps)
    |-- Click events (element ID, coordinates, timestamp)
    |-- Scroll events (position, direction, velocity, 10 fps)
    |-- Mouse hover position (cursor x,y, 10 fps)
    |-- Page visibility state (active/background)
    |
    v
WebSocket (Socket.io, wss://)
    |
    v
Backend (Node.js)
    |
    |-- Redis Buffer (RAM, RPUSH per event)
    |-- Background Worker (every 5 seconds)
    |       |
    |       v
    |   MongoDB Time Series (raw data)
    |
    |-- Engagement Score Computer (per session)
    |-- Insight Engine (aggregation, computation)
    |-- Reward Service (coupon delivery)
    |
    v
Client Dashboard (Next.js) <-- REST API --> Backend
Consumer Web App (Next.js) <-- REST API --> Backend
```

### 2.2 Data Flow Summary

1. Extension collects 5 signals during active task sessions
2. On first visit to each tracked page: extension captures a full-page screenshot (scroll+stitch) and uploads to backend via REST — used as heatmap base image
3. Signals stream to backend via WebSocket (persistent connection)
4. Backend buffers in Redis, batch-writes to MongoDB every 5 seconds
5. After session ends: engagement score computed
6. If score >= 60: session data enters client's insight pool + consumer earns reward
7. If score < 60: data quarantined, consumer still earns reward (see Section 6.4)
8. Insight engine runs aggregation queries on accepted sessions
9. Client dashboard displays computed insights via REST API; heatmaps are rendered over the extension-captured screenshot

**No tracking script required**: Clients do not install any JavaScript on their website. All data collection is performed by the Chrome extension operating on the consumer's browser.

---

## 3. User Roles & Personas

### 3.1 Client (Brand)

Profile: UX designer, product manager, or growth team at a consumer-facing website.
Goals: Understand where real users look on their pages. Find missed elements, confusion points, attention patterns.
Access: Client dashboard (Layer 2). Creates account via email/OAuth.
Pays: Subscription (Starter free / Growth $99/mo / Enterprise custom).

Key workflows:
- Create project, configure pages, create tasks, attach coupons
- View heatmaps, session replays, element attention rankings
- Monitor data quality scores
- Manage coupons and reward budgets

### 3.2 Consumer

Profile: Regular internet user, age 18-45, shops online. Motivated by discounts.
Goals: Earn coupons/discounts by browsing brand websites for a few minutes.
Access: Consumer web app (Layer 3) + Chrome extension (Layer 4). Lightweight account via email/OAuth.
Pays: Nothing. Earns rewards.

Key workflows:
- Browse brand catalog, pick a task, start via extension, browse pages, earn reward
- Check coupon wallet, copy codes, track earnings
- Daily return to check new tasks

### 3.3 Visitor (Unauthenticated)

Profile: Anyone landing on lessmissed.com.
Goals: Understand what LessMissed is, decide to sign up as client or consumer.
Access: Marketing website (Layer 1) only.

---

## 4. Data Collection Layer — 5 Signals

### 4.1 Signal 1: Gaze Coordinates

Source: WebGazer.js running inside iframe overlay (extension context)
Collection frequency: 30-60 samples per second (depends on webcam framerate)
Accuracy: ~100-200px at typical webcam distance (60-80cm from screen)
Camera: Accessed via extension iframe (overlay.html), processed locally. NO video/photos stored or transmitted.

Data packet per sample:
```json
{
  "type": "gaze",
  "timestamp": 1711234567890,
  "session_id": "sess_abc123",
  "page_url": "/checkout",
  "viewport_x": 450,
  "viewport_y": 320,
  "document_x": 450,
  "document_y": 1120,
  "scroll_offset_x": 0,
  "scroll_offset_y": 800,
  "element_id": "#pricing-cta",
  "element_xpath": "/html/body/div[2]/button[1]",
  "confidence": 0.82
}
```

Key fields:
- viewport_x/y: Position relative to visible browser window
- document_x/y: Position relative to full page (viewport + scroll offset)
- scroll_offset_x/y: Current scroll position (added by content script in parent page)
- element_id/xpath: DOM element under the gaze point (computed via document.elementFromPoint())
- confidence: WebGazer's self-reported prediction confidence (0-1)

Processing required before storage:
- Kalman filter smoothing: SmoothX = (CurrentX * 0.2) + (PreviousSmoothX * 0.8)
- Discard samples with confidence < 0.4
- Discard samples where page visibility is "hidden"

### 4.2 Signal 2: Click Events

Source: Content script addEventListener('click') on document
Collection frequency: Event-driven (only when user clicks)
Accuracy: Pixel-perfect (native DOM event)

Data packet per event:
```json
{
  "type": "click",
  "timestamp": 1711234568500,
  "session_id": "sess_abc123",
  "page_url": "/checkout",
  "viewport_x": 455,
  "viewport_y": 325,
  "document_x": 455,
  "document_y": 1125,
  "element_id": "#pay-btn",
  "element_xpath": "/html/body/div[2]/button[1]",
  "element_tag": "BUTTON",
  "element_text": "Pay Now",
  "element_classes": ["btn", "btn-primary", "cta"],
  "is_interactive": true,
  "click_count": 1,
  "time_since_last_click_ms": 4200
}
```

Key fields:
- element_tag/text/classes: Describes what was clicked for element mapping
- is_interactive: Whether the clicked element is natively interactive (button, a, input, select) — used for dead click detection
- click_count: Number of clicks within a 500ms window on the same element — used for rage click detection (count >= 3 = rage click)
- time_since_last_click_ms: Time since previous click anywhere on page

Rage click detection rule: If click_count >= 3 AND all clicks target the same element within 1500ms, flag as rage click.

Dead click detection rule: If is_interactive == false AND element is not a known container (div, section, main), flag as dead click.

### 4.3 Signal 3: Scroll Events

Source: Content script addEventListener('scroll') on window, throttled
Collection frequency: Sampled at 10 fps (every 100ms during active scrolling). Only emits when scroll position changes.

Data packet per sample:
```json
{
  "type": "scroll",
  "timestamp": 1711234569000,
  "session_id": "sess_abc123",
  "page_url": "/checkout",
  "scroll_x": 0,
  "scroll_y": 1200,
  "scroll_direction": "down",
  "scroll_velocity": 450,
  "viewport_height": 900,
  "document_height": 4200,
  "scroll_depth_percent": 28.6
}
```

Key fields:
- scroll_direction: "up" or "down" — direction change = scroll-back event
- scroll_velocity: Pixels per second. Fast (>1000 px/s) = skimming. Slow (<200 px/s) = reading.
- scroll_depth_percent: (scroll_y + viewport_height) / document_height * 100

Derived events (computed on backend):
- Scroll-back event: Direction changes from "down" to "up" after traveling at least 200px down.
- Max scroll depth: Maximum scroll_depth_percent achieved during the session.
- Scroll pause: No scroll events for 2+ seconds while page is visible. User is reading.

### 4.4 Signal 4: Mouse Hover / Cursor Position

Source: Content script addEventListener('mousemove') on document, throttled
Collection frequency: Sampled at 10 fps (every 100ms). Lower than gaze to reduce bandwidth.

Data packet per sample:
```json
{
  "type": "hover",
  "timestamp": 1711234569200,
  "session_id": "sess_abc123",
  "page_url": "/checkout",
  "viewport_x": 430,
  "viewport_y": 310,
  "document_x": 430,
  "document_y": 1110,
  "element_id": "#pricing-table",
  "element_xpath": "/html/body/div[3]/table[1]"
}
```

Why collect cursor data:
- Research (Huang et al., CHI 2011 — in project files) shows cursor and gaze position are moderately correlated on content pages
- Cursor heatmap is a useful supplementary visualization
- When gaze confidence is low (< 0.4), cursor position serves as a fallback signal
- Cursor hovers over interactive elements signal "considering clicking"

Processing: Cursor data generates a separate "cursor heatmap" layer. NOT used for the primary gaze heatmap.

### 4.5 Signal 5: Page Visibility

Source: Content script using document.visibilityState + visibilitychange event
Collection frequency: Event-driven (only on state change)

Data packet per event:
```json
{
  "type": "visibility",
  "timestamp": 1711234570000,
  "session_id": "sess_abc123",
  "page_url": "/checkout",
  "state": "hidden",
  "time_since_last_change_ms": 45000
}
```

States: "visible" (tab active and foreground) or "hidden" (tab in background, minimized, or screen locked)

Critical rule: ALL gaze, click, scroll, and hover data collected while state == "hidden" MUST be discarded. The camera may still be running but the user isn't looking at the page.

Derived metrics:
- active_time: Total time with state == "visible" during session
- background_ratio: Time hidden / total session duration. High ratio (>50%) = unreliable data

---

## 5. Data Processing Pipeline

### 5.1 Ingestion Layer

Extension to WebSocket (Socket.io) to Backend

- Protocol: WSS (WebSocket Secure, TLS required)
- Connection: Persistent, opened when task starts, closed when task ends
- Authentication: Consumer's session token sent on WebSocket handshake
- Message format: JSON, one packet per event
- Batching on client: Extension batches up to 20 events and sends as array every 333ms (3 flushes/second)

### 5.2 Buffer Layer (Redis)

Backend to Redis RPUSH to Background Worker to MongoDB

- On receive: RPUSH session:{session_id}:buffer JSON.stringify(packet)
- Each session has its own Redis list
- Redis TTL on buffer keys: 1 hour (safety net)
- Memory budget: ~500KB per active session

### 5.3 Batch Writer (Background Worker)

- Runs every 5 seconds
- For each active session buffer in Redis:
  1. LRANGE session:{id}:buffer 0 -1 (read all)
  2. DEL session:{id}:buffer (clear)
  3. Parse JSON array
  4. Apply smoothing filter to gaze data
  5. Apply saccade filter
  6. insertMany to MongoDB time series collection
- If worker crashes, Redis buffer persists until TTL. Worker restarts and resumes.

### 5.4 Smoothing Pipeline (Applied to Gaze Data)

Step 1 — Kalman-like weighted moving average:
SmoothX = (CurrentX * 0.2) + (PreviousSmoothX * 0.8)
SmoothY = (CurrentY * 0.2) + (PreviousSmoothY * 0.8)

Step 2 — Confidence filter:
Discard any sample with confidence < 0.4.

Step 3 — Visibility filter:
Discard all samples collected during visibility.state == "hidden" periods.

Step 4 — Saccade detection:
If distance between consecutive samples > 50px AND time delta < 20ms then mark as saccade. Kept in raw storage but excluded from fixation computations.

Step 5 — Fixation clustering:
Group consecutive non-saccade samples within 50px radius for 200ms+ into fixation events:
```json
{
  "type": "fixation",
  "center_x": 452,
  "center_y": 318,
  "element_id": "#pay-btn",
  "duration_ms": 1400,
  "start_timestamp": 1711234567890,
  "end_timestamp": 1711234569290,
  "sample_count": 84
}
```

### 5.5 Element Hit-Test Mapping

Extension sends element_id and element_xpath with each gaze sample (via document.elementFromPoint()). Backend aggregates per page:

```json
{
  "page_url": "/checkout",
  "elements": {
    "#pay-btn": { "fixation_count": 42, "total_dwell_ms": 18400, "click_count": 8 },
    "#form-fields": { "fixation_count": 312, "total_dwell_ms": 94000, "click_count": 45 },
    "#trust-badge": { "fixation_count": 0, "total_dwell_ms": 0, "click_count": 0 }
  }
}
```

---

## 6. Engagement Score System (Quality Gate)

### 6.1 Purpose

Prevent reward-farming. Ensure only high-quality gaze data reaches the client's dashboard.

### 6.2 Score Computation (0-100 per session)

Computed on backend after session ends.

| Signal | Weight | Full marks | Zero marks |
|--------|--------|-----------|------------|
| Fixation diversity | 30 | 8+ unique elements fixated | 0-1 elements |
| Saccade pattern naturalness | 25 | 3:1 to 5:1 small:large saccade ratio | 0 saccades OR >1:1 ratio |
| Scroll-gaze correlation | 20 | Pearson r > 0.6 | r < 0.2 |
| Page coverage | 15 | 6+ of 10 vertical bands fixated | 0-2 bands |
| Interaction signals | 10 | 3+ clicks | 0 clicks |

### 6.3 Score Formula

```
score = (fixation_diversity_score * 0.30)
      + (saccade_naturalness_score * 0.25)
      + (scroll_gaze_correlation_score * 0.20)
      + (page_coverage_score * 0.15)
      + (interaction_score * 0.10)
```

Each sub-score normalized to 0-100 before weighting.

### 6.4 Threshold Behavior

| Score | Data action | Consumer action | Client sees |
|-------|------------|----------------|-------------|
| 60-100 | Session accepted | Reward unlocked | Session in heatmaps/replays |
| 40-59 | Quarantined | "Keep exploring" nudge. Reward still given if task pages completed. | Nothing |
| 0-39 | Discarded | Same nudge. Reward still given if task pages completed. | Nothing |

### 6.5 Critical Rule

Never withhold a reward because of low engagement score. If task pages were visited, give the reward. Exclude bad data silently.

### 6.6 Score Visibility

- Consumer: Never sees score. Only task progress and reward status.
- Client: Sees aggregate quality metric: "87% of sessions passed quality check."

---

## 7. Insight Engine — Complete Catalog (23 Insights)

### 7.1 Gaze-Only Insights (9)

**INS-G01: Gaze Heatmap** [HIGH confidence, Phase 1]
Aggregated fixation coordinates across accepted sessions. Kernel density estimation weighted by duration. Thermal overlay via heatmap.js.

**INS-G02: Element Attention Ranking** [HIGH confidence, Phase 1]
Fixation count and total dwell per element ID. Ranked list. Unique differentiator vs click-only tools.

**INS-G03: Missed Elements** [HIGH confidence, Phase 1]
Elements with zero fixations across sessions. "Your trust badge was never seen by 40% of users."

**INS-G04: First Fixation Point** [MEDIUM confidence, Phase 2]
First 200ms+ fixation after page load per session. Aggregated to find most common first-look region.

**INS-G05: Fixation Duration per Element** [MEDIUM confidence, Phase 2]
Average and median dwell time per element. Long fixation = interest OR confusion (context-dependent).

**INS-G06: Scan Path / Reading Order** [MEDIUM confidence, Phase 2]
Sequence of fixation element_ids. Most common subsequences across sessions reveal actual vs intended reading flow.

**INS-G07: Backtracking / Re-reading** [MEDIUM confidence, Phase 2]
Instances where user returns to previously fixated element. Signals confusion or comparison behavior.

**INS-G08: Attention Drop-off Point** [MEDIUM confidence, Phase 2]
Page decile where fixation rate drops below 50%. Different from scroll depth — users may scroll past without looking.

**INS-G09: Cognitive Load Estimation** [LOW — DO NOT SHIP]
Requires pupil dilation measurement. WebGazer cannot reliably measure pupils from webcams. Do not implement.

### 7.2 Scroll Insights (4)

**INS-S01: Scroll Depth** [HIGH confidence, Phase 1]
Max scroll_depth_percent per session, averaged. Horizontal lines on page showing 25%/50%/75%/100% reach.

**INS-S02: Scroll Velocity Map** [HIGH confidence, Phase 2]
Average velocity per page decile. Fast = skimmed, slow = read carefully.

**INS-S03: Scroll-Back Events** [HIGH confidence, Phase 2]
Count per page section. "Pricing section triggers scroll-backs in 28% of sessions."

**INS-S04: Fold Awareness** [HIGH confidence, Phase 2]
Combines scroll depth with element fixation. "CTA at 80% depth. 30% scroll there. 60% of those fixate. Net visibility: 18%."

### 7.3 Click Insights (4)

**INS-C01: Click Heatmap** [HIGH confidence, Phase 1]
Aggregated click coordinates. Same rendering as gaze heatmap but separate layer.

**INS-C02: Rage Clicks** [HIGH confidence, Phase 2]
click_count >= 3 on same element within 1500ms. Frustration signal.

**INS-C03: Dead Clicks** [HIGH confidence, Phase 2]
Clicks on non-interactive elements. Reveals misleading affordances.

**INS-C04: Last Click Before Exit** [HIGH confidence, Phase 2]
Final click in sessions that ended without task completion. Identifies conversion killers.

### 7.4 Gaze + Click Combined Insights (6) — UNIQUE TO LESSMISSED

**INS-GC01: Looked But Didn't Click** [UNIQUE, Phase 1]
Elements with fixation_count > 0 but click_count == 0. "78% fixated on CTA, only 12% clicked. Problem is persuasion, not visibility." PRIMARY DIFFERENTIATOR.

**INS-GC02: Clicked Without Looking** [UNIQUE, Phase 2]
Click without preceding 200ms fixation. User clicked from muscle memory. Label copy doesn't matter for this element.

**INS-GC03: Hesitation Time** [UNIQUE, Phase 2]
Time between first fixation and click on same element. Short = confident. Long = friction.

**INS-GC04: Attention-to-Action Ratio** [UNIQUE, Phase 2]
(sessions with fixation) / (sessions with click) per element. Ratio > 10:1 = high friction. < 2:1 = high converting.

**INS-GC05: Distraction Mapping** [UNIQUE, Phase 2]
User fixating near target, gaze pulled to different element, never returns to click target. Identifies attention cannibalization.

**INS-GC06: Comparison Behavior** [UNIQUE, Phase 2]
Gaze alternating A-B-A-B (2+ times in 10s) before clicking one. "Users compare plan-basic and plan-pro 3.2 times before choosing."

### 7.5 Session-Level Insights (4)

**INS-SL01: Confusion Score** [MEDIUM confidence, Phase 2]
Composite: backtracking (30%) + scroll-backs (25%) + hesitation time (25%) + re-fixation ratio (20%).

**INS-SL02: Task Completion Path** [HIGH confidence, Phase 2]
Ordered page_urls per session. Most common path vs intended. "38% deviated to /features before /pricing."

**INS-SL03: Session Replay with Gaze Dot** [HIGH confidence, Phase 1]
rrweb recording + overlaid gaze dot + click indicators. Synchronized playback.

**INS-SL04: Engagement Score (client-facing)** [HIGH confidence, Phase 1]
Same as quality gate score. Per session in replay list. Aggregate per page.

---

## 8. Product Layers & Functional Requirements

### 8.1 Layer 1 — Marketing Website (6 pages)

| Page | Route | Priority |
|------|-------|----------|
| Landing page | / | P0 |
| For brands | /for-brands | P0 |
| For consumers | /for-you | P0 |
| Pricing | /pricing | P1 |
| Privacy policy | /privacy | P0 |
| Documentation | /docs | P2 |

FR-L1-01: Landing page presents unified hero with two CTA paths.
FR-L1-02: /for-brands includes interactive dashboard preview with sample data.
FR-L1-03: /for-you displays live reward offers from database.
FR-L1-04: /privacy enumerates all 5 collected signals with explicit "NOT collected" section.
FR-L1-05: Navigation includes "For brands" and "For you" on all pages.
FR-L1-06: Pricing explains coupon economics.

### 8.2 Layer 2 — Client Dashboard (12 pages)

| Page | Priority |
|------|----------|
| All projects (L1) | P0 |
| Project detail (L2) | P0 |
| Page detail (L3) | P0 |
| Session replay | P0 |
| Task builder | P0 |
| Coupon manager | P0 |
| Project setup wizard | P0 |
| Analytics/trends | P1 |
| Data quality dashboard | P1 |
| Team management | P2 |
| Billing | P2 |
| API keys | P2 |

FR-L2-01: 3 zoom levels: All projects -> Project -> Page.
FR-L2-02: Constant sidebar with project selector dropdown.
FR-L2-03: Clickable breadcrumb navigation.
FR-L2-04: Heatmap viewer with 4 layer toggles: Gaze, Click, Scroll depth, Cursor.
FR-L2-05: Element panel with three categories: High attention, Low attention, Never seen.
FR-L2-06: Session replay synchronizes rrweb with gaze dot and click indicators.
FR-L2-07: Task builder validates 2-5 pages, coupon attached, schedule set.
FR-L2-08: Page detail prominently displays INS-GC01 (Looked but didn't click).
FR-L2-09: All insights use only sessions with engagement score >= 60.
FR-L2-10: Data quality metric visible on dashboard.

### 8.3 Layer 3 — Consumer Web App (8 pages)

| Page | Priority |
|------|----------|
| Brand catalog | P0 |
| Brand detail | P0 |
| My rewards / wallet | P0 |
| Activity history | P1 |
| Sign up / login | P0 |
| Onboarding | P0 |
| Profile / settings | P1 |
| Referral page | P2 |

FR-L3-01: Brand catalog sorts in-progress first, then new, then others.
FR-L3-02: Brand cards show reward value, time estimate, page count, social proof.
FR-L3-03: Start task redirects to extension.
FR-L3-04: Coupon wallet shows code with copy button and expiry.
FR-L3-05: Onboarding includes extension install verification.
FR-L3-06: Activity history never shows raw engagement scores.

### 8.4 Layer 4 — Chrome Extension (6 screens)

| Screen | Priority |
|--------|----------|
| Popup: task picker | P0 |
| Popup: task active | P0 |
| Popup: reward earned | P0 |
| Calibration overlay | P0 |
| Tracking status bar | P1 |
| Permission grant screen | P0 |

FR-L4-01: Manifest V3 with optional_host_permissions.
FR-L4-02: chrome.permissions.request() for new brand domains.
FR-L4-03: Opens brand URL in new tab via chrome.tabs.create().
FR-L4-04: Content script injects iframe overlay for camera.
FR-L4-05: Shadow DOM prevents CSS conflicts.
FR-L4-06: pointer-events:none during browsing, auto during calibration.
FR-L4-07: 5-point calibration, under 20 seconds.
FR-L4-08: Re-calibration at start of each task session.
FR-L4-09: Popup shows page progress with names.
FR-L4-10: Privacy status always visible: "Camera on/off, Tracking domain only."
FR-L4-11: SPA route change detection via history.pushState/popstate.
FR-L4-12: Batch events (up to 20) and flush every 333ms.
FR-L4-13: Discard data when page visibility is "hidden."
FR-L4-14: Extension icon badge changes: gray (idle), green (tracking), gold (reward earned).
FR-L4-15: On task start for a page, extension captures a full-page screenshot (scroll+stitch) and uploads it to the backend. This screenshot is used as the base image for heatmap rendering in the client dashboard — no tracking script required on the client's website.
FR-L4-16: No code changes are required on the tracked website. All data collection (gaze, clicks, scroll, hover, screenshot) is handled entirely by the extension.

### 8.5 Layer 5 — Shared (4 screens)

FR-L5-01: Separate user types for client and consumer in database.
FR-L5-02: Google OAuth for both.
FR-L5-03: Password reset flow.
FR-L5-04: Email templates: welcome, reward earned, weekly digest, new data alert.

---

## 9. Data Models & Schema

### 9.1 Users Collection

```json
{
  "_id": "ObjectId",
  "type": "client | consumer",
  "email": "string",
  "password_hash": "string | null",
  "oauth_provider": "google | null",
  "oauth_id": "string | null",
  "name": "string",
  "created_at": "ISODate",
  "last_login": "ISODate",
  "plan": "starter | growth | enterprise (clients only)",
  "trust_score": "number 0-100 (consumers only)",
  "total_rewards_earned": "number (consumers only)",
  "settings": {
    "notifications": "boolean",
    "email_digest": "weekly | daily | none"
  }
}
```

### 9.2 Projects Collection

```json
{
  "_id": "ObjectId",
  "client_id": "ObjectId",
  "name": "string",
  "domain": "string",
  "pages": [
    {
      "path": "string",
      "type": "exact | wildcard",
      "status": "active | paused | awaiting_data",
      "added_at": "ISODate",
      "session_count": "number",
      "last_session_at": "ISODate"
    }
  ],
  "created_at": "ISODate",
  "health_score": "number 0-100",
  "total_sessions": "number"
}
```

### 9.3 Tasks Collection

```json
{
  "_id": "ObjectId",
  "project_id": "ObjectId",
  "client_id": "ObjectId",
  "title": "string",
  "description": "string",
  "pages": ["string array of paths"],
  "estimated_minutes": "number",
  "coupon_id": "ObjectId",
  "schedule": {
    "start_date": "ISODate",
    "end_date": "ISODate",
    "daily_cap": "number",
    "total_cap": "number"
  },
  "status": "active | paused | expired | completed",
  "stats": {
    "total_started": "number",
    "total_completed": "number",
    "total_rewarded": "number",
    "avg_engagement_score": "number"
  },
  "created_at": "ISODate"
}
```

### 9.4 Sessions Collection

```json
{
  "_id": "ObjectId",
  "session_id": "string (unique)",
  "consumer_id": "ObjectId",
  "task_id": "ObjectId",
  "project_id": "ObjectId",
  "status": "active | completed | abandoned",
  "pages_visited": [
    { "path": "string", "entered_at": "ISODate", "left_at": "ISODate" }
  ],
  "pages_required": ["string array"],
  "task_completed": "boolean",
  "engagement_score": "number 0-100",
  "engagement_breakdown": {
    "fixation_diversity": "number",
    "saccade_naturalness": "number",
    "scroll_gaze_correlation": "number",
    "page_coverage": "number",
    "interaction_signals": "number"
  },
  "data_accepted": "boolean",
  "reward_given": "boolean",
  "duration_ms": "number",
  "active_time_ms": "number",
  "started_at": "ISODate",
  "ended_at": "ISODate",
  "summary": {
    "total_fixations": "number",
    "total_clicks": "number",
    "total_scroll_events": "number",
    "max_scroll_depth_percent": "number",
    "rage_clicks": "number",
    "dead_clicks": "number",
    "scroll_backs": "number",
    "confusion_score": "number"
  }
}
```

### 9.5 Events Collection (Time Series)

```json
{
  "timestamp": "ISODate",
  "session_id": "string",
  "type": "gaze | click | scroll | hover | visibility",
  "page_url": "string",
  "data": "object (varies by type, see Section 4)",
  "metadata": {
    "project_id": "ObjectId",
    "consumer_id": "ObjectId"
  }
}
```

Time series config:
```javascript
db.createCollection("events", {
  timeseries: {
    timeField: "timestamp",
    metaField: "metadata",
    granularity: "seconds"
  },
  expireAfterSeconds: 7776000  // 90 days for Growth plan
})
```

### 9.6 Fixations Collection (Derived)

```json
{
  "session_id": "string",
  "page_url": "string",
  "element_id": "string",
  "element_xpath": "string",
  "center_x": "number",
  "center_y": "number",
  "duration_ms": "number",
  "start_timestamp": "ISODate",
  "end_timestamp": "ISODate",
  "sample_count": "number"
}
```

### 9.7 Coupons Collection

```json
{
  "_id": "ObjectId",
  "client_id": "ObjectId",
  "project_id": "ObjectId",
  "type": "percentage | fixed | free_delivery | custom",
  "value": "number",
  "currency": "INR | USD | EUR",
  "description": "string",
  "code": "string",
  "rules": {
    "max_redemptions": "number",
    "expiry_date": "ISODate",
    "min_order_value": "number",
    "one_per_user": "boolean"
  },
  "stats": {
    "total_earned": "number",
    "total_redeemed": "number",
    "total_expired": "number"
  },
  "status": "active | paused | expired | redeemed_out",
  "created_at": "ISODate"
}
```

### 9.8 Consumer Rewards Collection

```json
{
  "_id": "ObjectId",
  "consumer_id": "ObjectId",
  "coupon_id": "ObjectId",
  "task_id": "ObjectId",
  "session_id": "string",
  "code": "string",
  "brand_name": "string",
  "description": "string",
  "status": "earned | redeemed | expired",
  "earned_at": "ISODate",
  "redeemed_at": "ISODate | null",
  "expires_at": "ISODate"
}
```

### 9.9 Indexes

```javascript
db.events.createIndex({ "session_id": 1, "type": 1 })
db.events.createIndex({ "metadata.project_id": 1, "timestamp": -1 })
db.sessions.createIndex({ "project_id": 1, "status": 1 })
db.sessions.createIndex({ "consumer_id": 1, "status": 1 })
db.sessions.createIndex({ "task_id": 1 })
db.fixations.createIndex({ "session_id": 1, "page_url": 1 })
db.fixations.createIndex({ "session_id": 1, "element_id": 1 })
db.tasks.createIndex({ "status": 1, "schedule.end_date": 1 })
db.tasks.createIndex({ "project_id": 1 })
db.consumer_rewards.createIndex({ "consumer_id": 1, "status": 1 })
```

---

## 10. API Specifications

### 10.1 Authentication

All API requests require Bearer token in Authorization header. Tokens issued via login/signup endpoints. Separate for client and consumer.

### 10.2 Client API Endpoints

```
POST   /api/auth/client/signup
POST   /api/auth/client/login
POST   /api/auth/client/oauth/google

GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PUT    /api/projects/:id
DELETE /api/projects/:id

GET    /api/projects/:id/pages
POST   /api/projects/:id/pages
PUT    /api/projects/:id/pages/:path
DELETE /api/projects/:id/pages/:path

GET    /api/projects/:id/pages/:path/insights
       Query: date_from, date_to, insight_type[]
GET    /api/projects/:id/pages/:path/heatmap
       Query: type (gaze|click|cursor|scroll), date_from, date_to
GET    /api/projects/:id/pages/:path/elements
       Returns: element_id, fixation_count, dwell_ms, click_count,
                looked_not_clicked_rate, attention_to_action_ratio

GET    /api/projects/:id/sessions
       Query: page, status, min_score, date_from, date_to, limit, offset
GET    /api/projects/:id/sessions/:sid
GET    /api/projects/:id/sessions/:sid/replay
GET    /api/projects/:id/sessions/:sid/events

POST   /api/projects/:id/tasks
GET    /api/projects/:id/tasks
PUT    /api/projects/:id/tasks/:tid
DELETE /api/projects/:id/tasks/:tid

POST   /api/coupons
GET    /api/coupons
PUT    /api/coupons/:cid
GET    /api/coupons/:cid/stats

GET    /api/projects/:id/quality
GET    /api/projects/:id/flow
```

### 10.3 Consumer API Endpoints

```
POST   /api/auth/consumer/signup
POST   /api/auth/consumer/login
POST   /api/auth/consumer/oauth/google

GET    /api/brands
       Query: sort (new|popular|reward_value), limit, offset
GET    /api/brands/:domain
GET    /api/brands/:domain/tasks

POST   /api/tasks/:tid/start
POST   /api/tasks/:tid/complete

GET    /api/rewards
       Query: status (earned|redeemed|expired)
POST   /api/rewards/:rid/redeem

GET    /api/activity
GET    /api/consumer/stats
GET    /api/consumer/profile
PUT    /api/consumer/profile
DELETE /api/consumer/account
```

### 10.4 Extension API Endpoints

```
GET    /api/extension/tasks
POST   /api/extension/session/start
       Body: { task_id }
       Returns: { session_id, websocket_token, pages_to_track, brand_domain }
POST   /api/extension/session/page
       Body: { session_id, page_url }
       Returns: { pages_remaining, task_complete }
POST   /api/extension/session/end
       Body: { session_id, reason }
       Returns: { engagement_score_tier, reward_earned, coupon }

WSS    /api/extension/stream
       Handshake: { session_id, websocket_token }
       Messages: Batched event arrays
```

### 10.5 Rate Limits

| Endpoint | Limit |
|----------|-------|
| Auth | 10/min per IP |
| Client reads | 100/min |
| Client writes | 30/min |
| Consumer API | 60/min |
| Extension REST | 30/min |
| WebSocket | No message limit (batched) |

---

## 11. Chrome Extension Technical Specification

### 11.1 Manifest V3

```json
{
  "manifest_version": 3,
  "name": "LessMissed",
  "version": "1.0.0",
  "description": "Browse brands, earn rewards.",
  "permissions": ["tabs", "scripting", "storage"],
  "optional_host_permissions": ["*://*/*"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": { "16": "icons/icon-16.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" }
  },
  "background": { "service_worker": "background.js", "type": "module" },
  "web_accessible_resources": [
    { "resources": ["overlay.html", "calibration.html"], "matches": ["<all_urls>"] }
  ]
}
```

### 11.2 File Structure

```
extension/
  manifest.json
  background.js          — Service worker: state, WebSocket, permissions
  popup.html/js          — Popup UI: task list, progress, rewards
  content.js             — Injected into brand pages
  overlay.html/js        — Iframe: WebGazer.js, camera access
  calibration.html/js    — 5-point calibration
  lib/webgazer.js
  icons/                 — idle, active, reward states
  styles/
```

### 11.3 Activation Sequence

1. Consumer clicks "Start" in popup
2. background.js requests host permission for brand domain
3. Browser shows one-time permission prompt (per brand)
4. On grant: opens brand URL in new tab
5. Stores active session in chrome.storage.local
6. Injects content.js via chrome.scripting.executeScript()
7. content.js creates Shadow DOM + iframe pointing to overlay.html
8. overlay.html loads WebGazer.js, requests camera
9. WebGazer starts, sends gaze (x,y) via postMessage to content.js
10. content.js adds scroll offsets, resolves element, also listens for click/scroll/hover/visibility
11. Batched events sent to background.js via chrome.runtime.sendMessage
12. background.js forwards via WebSocket
13. On page navigation: content.js re-injects
14. SPA: intercepts pushState/popstate
15. All task pages visited: backend scores session, returns reward
16. Popup updates to celebration state

### 11.4 SPA Route Detection

```javascript
const originalPushState = history.pushState;
history.pushState = function() {
  originalPushState.apply(this, arguments);
  handleRouteChange(window.location.pathname);
};
window.addEventListener('popstate', () => {
  handleRouteChange(window.location.pathname);
});
```

### 11.5 Communication Protocol

```
overlay.html -> content.js: window.postMessage({ type: 'gaze', x, y, confidence })
content.js -> background.js: chrome.runtime.sendMessage({ type: 'events', batch: [...] })
background.js -> backend: WebSocket send(JSON.stringify(batch))
popup -> background.js: chrome.runtime.sendMessage({ type: 'start_task', task_id })
background.js -> popup: chrome.runtime.sendMessage({ type: 'progress_update', ... })
popup -> background.js: chrome.runtime.sendMessage({ type: 'TAKE_SCREENSHOT', project_id, page_url, page_slug })
```

### 11.6 Full-Page Screenshot Capture & Upload

The extension captures a full-page screenshot at the start of each tracked page visit and uploads it to the backend. This image is used as the base layer for heatmap rendering in the client dashboard.

**Why extension-based screenshots**:
- No tracking script needs to be installed on the client's website
- The screenshot is pixel-accurate to what the consumer actually sees (fonts, images, layout)
- Document height is known at capture time, enabling correct coordinate mapping for heatmap overlays

**Capture algorithm** (scroll+stitch):

```
1. content.js reports: { viewportWidth, viewportHeight, documentHeight }
2. background.js calculates number of scroll steps: ceil(documentHeight / viewportHeight)
3. For each step:
   a. background.js sends SCROLL_TO message to content.js with target Y
   b. content.js scrolls to that Y and reports back scrollY, viewportHeight
   c. background.js calls chrome.tabs.captureVisibleTab() → viewport dataURL
   d. Segment stored in memory
4. background.js stitches segments using OffscreenCanvas:
   - Canvas dimensions: viewportWidth × documentHeight
   - Each segment drawn at its scroll offset Y
5. Final canvas exported as JPEG (quality 0.82) via canvas.convertToBlob()
6. Uploaded to POST /api/extension/screenshot
```

**Upload payload**:
```json
{
  "project_id": "ObjectId string",
  "page_url": "https://brand.com/checkout",
  "page_slug": "checkout",
  "image_base64": "data:image/jpeg;base64,...",
  "viewport_width": 1440,
  "viewport_height": 900,
  "document_height": 3800
}
```

**Backend storage** (POST /api/extension/screenshot):
- Decodes base64 and writes JPEG to `public/screenshots/{project_id}/{page_slug}.jpg`
- Updates `Project.pages[].screenshot_url`, `screenshot_viewport_width`, `screenshot_viewport_height`, `screenshot_document_height`, `screenshot_captured_at`
- Screenshot is refreshed each time a consumer starts a task for that page (keeps it up to date with any page redesigns)

**Heatmap coordinate system**:
- Gaze and click coordinates are stored as `document_x / document_y` (viewport position + scroll offset)
- The heatmap viewer renders the screenshot as the background at `document_height` pixels tall
- Heatmap points are plotted using `document_x / document_y` — coordinates align correctly with the stitched screenshot without any scaling conversion

---

## 12. Non-Functional Requirements

### 12.1 Performance

| Metric | Requirement |
|--------|------------|
| Gaze processing latency | < 16ms per sample |
| WebSocket round-trip | < 100ms |
| Backend ingestion | 60 events/sec per session, 1000 concurrent |
| Dashboard page load | < 2s (L1/L2), < 3s (L3 with heatmap) |
| Heatmap rendering | < 1s for 50,000 points |
| Session replay load | < 2s to start |
| API P95 response | < 500ms reads, < 1000ms writes |

### 12.2 Scalability

| Stage | Consumers | Concurrent sessions | Events/sec | Storage/month |
|-------|-----------|-------------------|------------|---------------|
| Launch | 100 | 20 | 1,200 | ~5 GB |
| Growth | 1,000 | 200 | 12,000 | ~50 GB |
| Scale | 10,000 | 2,000 | 120,000 | ~500 GB |

### 12.3 Reliability

- 99.5% uptime target
- WebSocket auto-reconnect with exponential backoff (max 30s)
- Redis fallback: in-memory buffer (1000 events max)
- MongoDB Atlas replica set for failover
- Extension offline buffer: chrome.storage.local (5MB max), retry on reconnect

### 12.4 Browser Support

- Extension: Chrome desktop 102+
- Dashboard/web apps: Chrome, Firefox, Safari, Edge (last 2 versions)
- Mobile: Not supported for extension. Web apps responsive.

---

## 13. Security & Privacy Requirements

### 13.1 Data Boundaries

COLLECTED: Gaze coordinates, click coordinates + element metadata, scroll position/direction/velocity, cursor position, page visibility state, page URL during task, anonymous session ID, WebGazer confidence, viewport dimensions.

NOT COLLECTED: Photos/video from webcam, face data, keystrokes, form values, passwords, cookies, browsing history outside tasks, other tab contents, system information.

### 13.2 Encryption

- Transit: TLS 1.2+ (HTTPS, WSS)
- Rest: MongoDB Atlas AES-256
- Passwords: bcrypt cost factor 12
- JWT: RS256, 24h client / 7d consumer expiry

### 13.3 Data Retention

| Plan | Raw events | Sessions | Heatmap cache |
|------|-----------|----------|---------------|
| Starter | 7 days | 30 days | 7 days |
| Growth | 90 days | 1 year | 90 days |
| Enterprise | Unlimited | Unlimited | Unlimited |

### 13.4 Deletion Rights

- Consumer deletion: All data purged within 30 days
- Project deletion: All associated data purged within 7 days
- Automatic TTL expiry per plan tier

### 13.5 Consent

- Consumer: Explicit opt-in during onboarding
- Per-brand: Browser permission prompt
- Camera: Browser permission prompt, revocable
- Right to withdraw: Pause, uninstall, or delete at any time

### 13.6 Compliance

- GDPR: Data minimization, right to access/deletion, consent-based
- India DPDP Act 2023: Eye tracking = personal data. Consent required.
- Chrome Web Store: Privacy policy URL required. Permission justification.

---

## 14. Third-Party Dependencies

### Frontend
Next.js 14+, React 18+, heatmap.js 2.0+, rrweb 2.0+, recharts/Chart.js, Socket.io-client 4+

### Backend
Node.js 20 LTS, Express 4+, Socket.io 4+, ioredis, mongoose, bcrypt 5+, jsonwebtoken 9+, PM2 5+

### Extension
WebGazer.js 2.1+, rrweb (record module) 2.0+

### Infrastructure
MongoDB Atlas, Redis, AWS EC2 / DigitalOcean, Nginx, Certbot

---

## 15. Deployment Architecture

```
Internet -> Nginx (SSL) -> Next.js (:3000) + WebSocket server (:3001)
                            |
                            +-> Redis (buffer)
                            +-> MongoDB Atlas (storage)
```

SSL required because WebGazer needs HTTPS for camera, WebSocket must be WSS, Chrome extension content scripts on HTTPS pages cannot connect to WS.

---

## 16. Build Priority & Phasing

### Phase 1 — MVP (Weeks 1-8)

Backend: Auth, WebSocket, Redis, MongoDB, batch writer
Extension: All 6 screens + data collection
Consumer app: Signup, onboarding, catalog, wallet
Client dashboard: Setup wizard, page detail (L3), replay
Marketing: Landing, /for-you, /privacy

Phase 1 insights: INS-G01, G02, G03, C01, S01, GC01, SL03, SL04

### Phase 2 — Full (Weeks 9-14)

All remaining insights. Dashboard L1, L2. Task builder, coupon manager. Analytics. Data quality. /for-brands, /pricing.

### Phase 3 — Scale (Weeks 15+)

Team management, billing, API keys. Referral system. /docs. A/B comparison. Consumer trust score. Email notifications.

---

## Appendix A: Insight Quick Reference

| ID | Name | Source | Phase |
|----|------|--------|-------|
| G01 | Gaze heatmap | Gaze | 1 |
| G02 | Element attention ranking | Gaze | 1 |
| G03 | Missed elements | Gaze | 1 |
| G04 | First fixation point | Gaze | 2 |
| G05 | Fixation duration | Gaze | 2 |
| G06 | Scan path | Gaze | 2 |
| G07 | Backtracking | Gaze | 2 |
| G08 | Attention drop-off | Gaze | 2 |
| G09 | Cognitive load | DO NOT SHIP | — |
| S01 | Scroll depth | Scroll | 1 |
| S02 | Scroll velocity | Scroll | 2 |
| S03 | Scroll-backs | Scroll | 2 |
| S04 | Fold awareness | Gaze+Scroll | 2 |
| C01 | Click heatmap | Click | 1 |
| C02 | Rage clicks | Click | 2 |
| C03 | Dead clicks | Click | 2 |
| C04 | Last click before exit | Click | 2 |
| GC01 | Looked but didn't click | Gaze+Click | 1 |
| GC02 | Clicked without looking | Gaze+Click | 2 |
| GC03 | Hesitation time | Gaze+Click | 2 |
| GC04 | Attention-to-action ratio | Gaze+Click | 2 |
| GC05 | Distraction mapping | Gaze+Click | 2 |
| GC06 | Comparison behavior | Gaze+Click | 2 |
| SL01 | Confusion score | Composite | 2 |
| SL02 | Task completion path | Session | 2 |
| SL03 | Session replay | Session | 1 |
| SL04 | Engagement score | Session | 1 |
