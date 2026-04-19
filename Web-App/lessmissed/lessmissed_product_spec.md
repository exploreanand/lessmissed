# LessMissed — Complete Product Specification

> **Purpose of this document**: This is the single source of truth for building LessMissed. Feed this file as context to your AI coding assistant (Claude Code, Cursor, VS Code Claude extension) when building any part of the product. Every page, component, data model, and business rule is documented here.

---

## 1. Product Overview

### What is LessMissed?

LessMissed is a **three-sided marketplace** for usability intelligence:

1. **Clients (brands)** — UX teams/businesses that pay for eye-tracking insights on their websites. They create projects, configure target pages, build browsing tasks, and attach coupons as rewards. They receive gaze heatmaps, session replays, element-level attention data, and confusion detection.

2. **Consumers** — Real users who install the LessMissed Chrome extension, browse brand websites by completing daily tasks, and earn discounts/coupons in return. They are NOT testers — they are regular people motivated by rewards.

3. **LessMissed (platform)** — Sits in the middle. Collects gaze data from consumers via the Chrome extension, processes it through quality filters, and delivers actionable insights to clients. Manages the reward catalog and coupon distribution.

### Core Value Propositions

**For brands**: "See what users actually look at — not where they click. Get gaze heatmaps, session replays, and element-level attention data from real consumers browsing your site."

**For consumers**: "Browse brands you love. Get discounts for looking. Install our extension, complete browsing tasks, earn real coupons."

### How It Works (The Loop)

1. Client creates a project for their website (e.g., acme.com) — no code changes required on their site
2. Client configures target pages (e.g., /checkout, /pricing, /homepage) in the dashboard
3. Client creates a browsing task: "Visit these 3 pages" + attaches a coupon (e.g., "20% off")
4. Consumer opens the Chrome extension, sees available tasks with rewards
5. Consumer picks a task, clicks "Start" — extension opens the brand's site in a new tab
6. Extension captures a full-page screenshot of each tracked page (scroll+stitch) and uploads it to the backend — this becomes the heatmap base image
7. Extension activates webcam eye-tracking (via WebGazer.js) on that tab only
8. Consumer browses the target pages naturally
9. Gaze data streams to the backend via WebSocket
10. Backend computes engagement score to verify genuine browsing
11. If engagement score passes threshold: consumer earns the coupon, data enters client's dashboard
12. Client sees gaze heatmaps overlaid on the extension-captured screenshots, session replays, element attention rankings, and confusion zones

---

## 2. User Roles & Access

| Role | Has Account? | Sees Dashboard? | Installs Extension? | Pays? |
|------|-------------|----------------|---------------------|-------|
| Client (brand) | Yes (email + OAuth) | Yes — full analytics dashboard | No | Yes (subscription) |
| Consumer | Yes (lightweight — email or OAuth) | Yes — reward wallet + brand catalog only | Yes | No (earns rewards) |
| Visitor | No | No | No | No |

### Key Principle
Clients and consumers are completely separate user types with separate auth flows, separate dashboards, and separate value props. They never see each other's interface.

---

## 3. Product Architecture — 5 Layers

### Layer 1: Marketing Website (Public)
- **URL**: lessmissed.com
- **Audience**: Both clients and consumers (visitors)
- **Pages**: 6
- **Tech**: Next.js (static/SSG)

### Layer 2: Client Dashboard (Authenticated Web App)
- **URL**: app.lessmissed.com or lessmissed.com/dashboard
- **Audience**: Clients (brands/UX teams) only
- **Pages**: 12
- **Tech**: Next.js + React

### Layer 3: Consumer Web App (Authenticated)
- **URL**: lessmissed.com/rewards or rewards.lessmissed.com
- **Audience**: Consumers only
- **Pages**: 8
- **Tech**: Next.js + React

### Layer 4: Chrome Extension (Consumer-Facing)
- **Audience**: Consumers only
- **Screens**: 6
- **Tech**: Manifest V3, WebGazer.js, Shadow DOM, iframe overlay

### Layer 5: Shared / System
- **Screens**: 4 (auth flows, emails, error pages)

**Total**: ~36 screens across all layers.

---

## 4. Layer 1 — Marketing Website (6 Pages)

### 4.1 Landing Page (/)

**Goal**: Convert both clients and consumers from a single URL.

**Navigation bar**:
- Logo: "LessMissed" (left)
- Links: For brands | For you | Pricing | Docs
- CTAs: Log in (outline) | Sign up (filled)

**Section 1 — Hero (unified message)**:
- Headline: "See what users actually look at"
- Subheadline: "Real people browse your site with our eye-tracking extension. You get heatmaps, replays, and attention insights. They earn rewards."
- Two CTA buttons side by side:
  - "I'm a brand" (purple, links to /for-brands)
  - "I want rewards" (teal, links to /for-you)
- Right side: animated heatmap preview on a website mockup (hero visual)

**Section 2 — How it works (3 steps, both audiences)**:
- Step 1: "Brands set up tasks" — "Browse our checkout" + attach a coupon
- Step 2: "Users browse + earn" — Pick a task, visit site, extension tracks gaze
- Step 3: "Everyone wins" — Brand gets heatmaps, user gets discount
- Arrows between steps

**Section 3 — Trust bar**:
- "4,200+ users earning rewards" · "87 brands getting insights"
- Grayscale logo strip of participating brands

**Section 4 — For brands (id="for-brands")**:
- 4 feature cards in 2x2 grid:
  - Gaze heatmaps: "See where real users look on your pages. Not clicks — actual eye fixations."
  - Session replays with gaze: "Watch users browse with a gaze dot. See confusion, hesitation, missed CTAs."
  - Element-level insights: "#signup-btn: 450 fixations. #promo-banner: 0 fixations (missed)."
  - Quality-verified data: "Engagement score filters low-quality sessions before they reach your dashboard."
- CTA: "Start getting insights" (purple)

**Section 5 — For consumers (id="for-you")**:
- 3 step cards: Browse brands → Complete tasks → Earn rewards
- Privacy reassurance box: "We track where your eyes look — not what you type. No passwords, no keystrokes, no photos. You control when tracking happens."
- CTA: "Install extension + start earning" (teal)

**Section 6 — Comparison table (for brands)**:
- Title: "LessMissed vs traditional tools"
- Columns: Feature | Hotjar/Clarity | LessMissed
- Rows: Click heatmaps (Yes/Yes), Gaze heatmaps (No/Yes), Attention per element (No/Yes), Built-in participant recruitment (No/Yes — reward marketplace)

**Section 7 — Featured brands (for consumers)**:
- "These brands are offering rewards right now"
- Scrolling logo strip with reward amounts: Nike 20% off, Swiggy Rs 100 off, etc.
- Dynamic — pulls from actual brand database

**Section 8 — Pricing teaser (for brands)**:
- 3 plan cards: Starter (Free) / Growth ($99/mo) / Enterprise (Custom)
- Brief feature list per plan
- Link to full /pricing page

**Section 9 — Final CTA (both audiences)**:
- "Stop guessing where users look."
- Same two CTA buttons as hero: "I'm a brand" | "I want rewards"

**Footer**:
- Links: For brands · For consumers · Pricing · Docs · Privacy · Terms
- Contact · Blog · Social links
- Tagline: "Built for UX teams and savvy shoppers"

---

### 4.2 For Brands Page (/for-brands)

**Goal**: Convert brand visitors into client signups.

**Sections in order**:
1. Hero: "Know exactly where users look — and what they miss" + CTA "Start free — 3 tasks/mo" (no credit card)
2. Dashboard preview: Interactive annotated screenshot of the real dashboard with sample heatmap data. Must look like a real product, not a Figma mockup.
3. Feature deep dives (alternating text + visual layout):
   - Gaze heatmaps (text left, visual right)
   - Session replays (visual left, text right)
   - Missed elements (text left, visual right)
   - Verified data quality (visual left, text right)
4. How the reward model works (brand perspective):
   - "You create tasks → attach a coupon → real users complete them → you get gaze data"
   - "You don't recruit testers. We bring you real consumers who are motivated to explore."
5. Case study / sample results: Before/after heatmap comparison. "An e-commerce brand discovered their checkout CTA was missed by 40% of users."
6. Pricing (same 3 plans, more detail) + link to /pricing
7. FAQ (brand-specific): accuracy, GDPR, gaming prevention, A/B testing
8. Final CTA: "See what your users actually see." + "Create free account"

---

### 4.3 For You Page (/for-you)

**Goal**: Convert consumer visitors into extension installs.

**Sections in order**:
1. Hero: "Browse brands you love. Get discounts for looking." + CTA "Install extension — it's free" (Chrome only, takes 10 seconds)
2. Rewards preview: LIVE brand cards from database showing current offers (Nike 20% off, Swiggy Rs 100 off, Zomato free delivery x3). Must be dynamic, not hardcoded. Shows "X people earned this" social proof.
3. How it works (4 steps): Install → Pick a task → Browse → Earn
4. Privacy and trust (4 cards):
   - "We track eye direction only" — No photos, no video, no face data
   - "You control everything" — Tracking only when you start a task
   - "Completely anonymous" — No name/email shared with brands
   - "Uninstall anytime" — One click removes everything
5. User testimonials / earnings showcase: Real quotes + "12,400+ rewards earned this month"
6. Extension popup demo: Interactive mockup showing the task-picker flow (try before install)
7. FAQ (consumer-specific): passwords, buying requirement, phone support, task duration
8. Final CTA: "Your next discount is 5 minutes away." + "Install extension — free"

---

### 4.4 Pricing Page (/pricing)

**Goal**: Full pricing breakdown for brands. Consumers don't need this page.

**Sections**:
1. Hero: "Simple pricing. Start free, scale when you need to."
2. 3 plan cards with full feature lists:
   - **Starter** (Free): 3 tasks/month, 50 sessions, 1 project, basic heatmaps, 7-day data retention
   - **Growth** ($99/mo): Unlimited tasks, 500 sessions, 5 projects, replays, element insights, 90-day retention
   - **Enterprise** (Custom): Unlimited everything, API access, SSO, dedicated support, unlimited retention
3. Feature comparison table (row-by-row: sessions, projects, tasks, heatmap types, replay access, element insights, API, retention, seats, support)
4. Coupon economics explainer: "You provide the coupons, we provide the users. Set redemption caps, expiry dates, minimum order values."
5. FAQ: cancellation, session definition, rollover, coupon costs
6. Final CTA: "Start free — upgrade when you're ready."

---

### 4.5 Privacy Policy Page (/privacy)

**CRITICAL**: Legally required. Chrome Web Store will check this. India's DPDP Act applies to eye-tracking data.

**Sections**:
1. What we collect: Eye gaze coordinates (x,y), scroll position, click events, page URLs during active tasks, anonymous session ID. EXPLICITLY NOT: photos, video, face data, keystrokes, form input, passwords, browsing history outside tasks.
2. When we collect: Only during active tasks user explicitly starts. Camera only active during task sessions. Camera feed processed locally by WebGazer.js — only coordinates sent to servers.
3. Who sees the data: Brands see aggregate heatmaps and anonymized replays. Never consumer identity, email, or personal info.
4. How to opt out / delete: Uninstall extension. Request deletion via email/in-app. Data purged within 30 days.
5. Data storage and security: MongoDB Atlas (encrypted at rest), TLS in transit, retention periods per plan.
6. No data sold to third parties.

---

### 4.6 Docs Page (/docs) — P2

**Build later**. For launch, a simple "Getting Started" guide and FAQ is enough.

**Structure**: Sidebar + content layout. Sections: Getting Started, Creating Projects, Configuring Pages, Building Tasks, Understanding Heatmaps, Session Replays, Element Insights, API Reference, Coupon Setup, Data Quality.

---

## 5. Layer 2 — Client Dashboard (12 Pages)

### Data Hierarchy
Client → Projects (websites) → Pages (URLs) → Sessions → Gaze data

The dashboard has 3 zoom levels:
- **L1**: All projects overview
- **L2**: One project — all pages + site-wide insights
- **L3**: One page — heatmap + elements + replays

### Navigation Model
- Sidebar: constant across all levels
- Project selector: dropdown at top of sidebar to switch projects without going back to L1
- Breadcrumb in topbar: Projects > acme.com > /checkout (always clickable)
- Sidebar nav items grayed out until a project is selected

### 5.1 All Projects Overview (L1)

**Layout**: Sidebar + main content

**Sidebar** (constant):
- Logo: LessMissed
- Project selector dropdown (grayed until project selected)
- Nav: Projects (active), Heatmaps, Replays, Elements, Analytics (all grayed)
- Divider
- Settings, Team, API Keys, Billing

**Main content**:
- Topbar: "Your projects" + "+ New project" button
- Aggregate stats row: Total sessions (4,891) | Active projects (3) | Missed elements (14 across all) | Avg attention (68%)
- Project cards (list): Each card shows:
  - Site thumbnail
  - Project name (acme.com)
  - Page count + last session time ("12 pages tracked — last session 2h ago")
  - Mini stats: session count, missed elements count
  - Health badge: Healthy (green) / Needs attention (amber) / Critical (red) / Stale (red, no recent data)
  - Health score circle (percentage)
  - 7-day sparkline trend
- Click any card → enters L2

### 5.2 Project Detail (L2)

**Topbar**: Breadcrumb (Projects / acme.com) + date range picker + filter

**Content**:
- Site-wide aggregate stats: Sessions | Avg fixation | Missed elements | Confusion rate | Health score
- Site-wide insights panel: Automated alerts like "/checkout has highest confusion (52%)" and "/pricing: CTA missed by 40%"
- Page list table:
  - Columns: Page path | Sessions | Avg fixation | Missed elements | Confusion rate | Health score
  - Sorted by health (worst first)
  - "Critical" badge on problem pages
  - Click any row → enters L3
- User flow diagram: Shows navigation patterns between pages (/ → /pricing 62%, / → /features 38%, /pricing → /checkout 45%, /checkout → Exit 28%)
- Recent sessions list (site-wide): Session ID, page visited, duration, behavior note, timestamp

### 5.3 Page Detail (L3)

**Topbar**: Breadcrumb (Projects / acme.com / /checkout) + "Critical" badge if applicable

**Layout**: Two-column (heatmap left, element panel right)

**Left — Heatmap viewer**:
- Layer toggle pills: Gaze (default) | Click | Scroll
- Website screenshot with thermal gaze overlay (using heatmap.js)
- Heatmap blobs: red = high fixation, yellow = medium, green = low
- Scroll depth line with percentage marker
- Intensity legend bar: Low → High

**Right — Element attention panel**:
- Sections: High attention | Low attention | Never seen
- Each element row: element selector (#pay-btn), fixation count
- "Never seen" elements highlighted with red background
- "View all elements" link

**Below — Confusion zones**:
- Areas where users backtrack, hesitate, or re-scan
- Each zone: description + dwell time + percentage of users affected

**Below — Session replays**:
- Filtered to this page only
- Each row: Session ID, duration, behavior summary, "Watch" button
- Confused/hesitated sessions highlighted

**Below — Compare versions** (future):
- Side-by-side heatmap comparison for A/B testing

### 5.4 Session Replay Player

**Layout**: Full-width video-like player

- Uses rrweb for DOM recording playback
- Red gaze dot overlaid on the replay
- Timeline scrubber with fixation markers
- Playback controls: play/pause, speed (1x/2x/4x), skip to next fixation
- Side panel: fixation list with timestamps, element IDs, dwell times
- Engagement score badge for this session

### 5.5 Task Builder

**Purpose**: Client creates daily tasks for consumers.

**Layout**: Form-based

- Task name (auto-generated or custom)
- Select pages from project's tracked pages list (multi-select, 2-5 pages)
- Task description: "Explore our new product collection" (shown to consumers)
- Estimated time: auto-calculated from page count
- Attach coupon (links to reward manager)
- Schedule: Start date, end date, daily cap (max consumers per day)
- Preview: "This is what consumers will see in their extension popup"

### 5.6 Coupon / Reward Manager

**Purpose**: Client creates and manages coupons attached to tasks.

- Create coupon: type (% off, fixed amount, free delivery, custom), value, description
- Redemption rules: cap (first 500 only), expiry date, minimum order value, one-per-user
- Coupon code: auto-generated or custom
- Status: Active / Paused / Expired / Redeemed out
- Analytics: total redeemed, total earned (waiting to redeem), redemption rate

### 5.7 Project Setup Wizard

**4-step wizard**:
1. Project details: Name, website URL, description
2. Target pages: Add URL paths to track (exact or wildcard, one per line). No code changes required on the client's website — the Chrome extension captures all data automatically.
3. Create first task: Select pages, write description, attach coupon
4. Add reward: Coupon type, value, and code

Progress bar at top. Each step collapsible after completion.

**No tracking script**: Clients never install any JavaScript snippet on their site. The extension handles all data collection (gaze, clicks, scroll, hover) and automatically captures a full-page screenshot of each tracked page the first time a consumer visits it. That screenshot becomes the base image for heatmap overlays in the dashboard.

### 5.8-5.12 (P1/P2 Pages)
- Analytics / trends over time (P1)
- Data quality dashboard — engagement scores (P1)
- Team management (P2)
- Billing / plan management (P2)
- API keys + integration settings (P2)

---

## 6. Layer 3 — Consumer Web App (8 Pages)

### 6.1 Brand Catalog (main page after login)

**Layout**: App shell with top nav (Brands | My rewards | Activity) + profile avatar

**Content**:
- Earning banner: "You've earned 3 rewards this week. Browse 2 more brands to unlock a bonus coupon." + progress bar
- Stats row: Total earned (12 rewards) | Brands visited (7) | Time contributed (2h 14m)
- "Available brands" heading
- Brand cards (list): Each card shows:
  - Brand logo/initials
  - Brand name
  - Reward pill: "20% off" / "Rs 100 off" / "Free delivery x3"
  - Task description: "Explore 3 pages on nike.com"
  - Meta: ~5 min, 3 pages, "1,204 earned this" / "New today"
  - "In progress" badge with progress bar if partially completed
- "View all X brands" link
- Cards sorted by: new first, then in-progress, then others

### 6.2 Brand Detail Page

- Brand info: logo, name, website, description
- Available tasks for this brand (may be multiple)
- Each task: description, pages to visit, estimated time, reward
- "Start task" button (redirects to extension flow)
- Past earnings from this brand
- Trust info: "Your data from [brand] is anonymous"

### 6.3 My Rewards / Coupon Wallet

- Active coupons: code, brand, value, expiry, "Copy code" / "Use now" buttons
- Expired coupons (dimmed)
- Earned but not yet redeemed
- Filter: All | Active | Used | Expired

### 6.4 Activity History

- Timeline of sessions: date, brand, pages visited, time spent, reward earned
- Engagement score (shown as "quality" — not the raw number)
- Total stats: lifetime earnings, brands browsed, time contributed

### 6.5 Sign Up / Login

- Email + password OR Google OAuth
- Separate from client auth (different user type in database)
- After signup → onboarding flow

### 6.6 Onboarding

**3-step flow**:
1. "Welcome to LessMissed" — brief explainer (what you'll do, what you'll earn)
2. Install extension — Chrome Web Store link, "I've installed it" confirmation
3. First calibration — redirected to a test page where calibration happens via the extension

### 6.7 Profile / Settings / Privacy Controls (P1)

- Email, password change
- Notification preferences
- Privacy controls: which brands have permission, revoke access
- Delete account + all data

### 6.8 Referral Page (P2)

- "Invite friends, earn bonus rewards"
- Unique referral link
- Track: invited, installed, completed first task

---

## 7. Layer 4 — Chrome Extension (6 Screens)

### Permission Model

**CRITICAL**: The extension does NOT use `<all_urls>`. It uses `optional_host_permissions` with `"*://*/*"`.

When a consumer starts a task for a new brand, the extension calls:
```javascript
chrome.permissions.request({ origins: ["*://swiggy.com/*"] })
```
Browser shows a one-time prompt: "LessMissed wants to access swiggy.com". Once granted, persists for that domain. No prompt on subsequent tasks for the same brand.

**Required permissions**: `tabs`, `scripting`, `storage`, `optional_host_permissions: ["*://*/*"]`
**Camera access**: Requested via the iframe overlay (extension context), not on the brand's domain.

### Technical Activation Flow

1. Consumer clicks "Start" on a task in the extension popup
2. Extension calls `chrome.permissions.request()` for the brand domain (first time only)
3. Extension opens brand URL in new tab: `chrome.tabs.create({ url: "https://swiggy.com" })`
4. Content script injected into that tab: `chrome.scripting.executeScript({ target: tabId })`
5. Content script injects full-screen iframe overlay (overlay.html from extension context)
6. overlay.html requests camera access and runs WebGazer.js
7. Gaze coordinates streamed to backend via WebSocket
8. As consumer navigates within the site, content script re-injects on each page load
9. Extension tracks which target pages have been visited for task completion
10. When all task pages visited + engagement score passes → reward unlocked

### 7.1 Popup: Task Picker (Default/Idle State)

**Header**: "LessMissed" + reward count + profile avatar
**Body**:
- "Today's tasks" heading
- Task cards (3-4 visible, scrollable):
  - Brand logo + name
  - Reward pill (e.g., "20% off")
  - Task description ("Explore 3 pages on nike.com")
  - Meta: ~5 min, 3 pages, "New today"
- "View all X available tasks" link
**Footer**: "Camera off · Not tracking · Privacy · My rewards"

### 7.2 Popup: Task Active (Recording)

**Header**: Green background, "LessMissed" + "Recording" badge
**Body**:
- Brand logo + name + reward
- Task description
- Progress section:
  - Page pills showing visited (green) vs current (blue) vs unvisited (gray)
  - Progress bar
  - "1 of 3 pages visited"
- Pause / Stop task buttons
**Footer**: "Camera on · Tracking [domain] only"

### 7.3 Popup: Reward Earned (Celebration)

**Header**: Green "Completed" badge
**Body**:
- Large celebration: "Reward earned!"
- Reward value prominently displayed: "Rs 100 off Swiggy"
- "Coupon added to your wallet"
- Stats: total rewards earned, more brands available
- "View coupon" / "Browse more" buttons
**Footer**: "Camera off · Not tracking"

### 7.4 Calibration Overlay

- Injected on the page via Shadow DOM
- 5-point calibration (NOT 9-point — respect consumer time, keep under 20 seconds)
- Points appear one at a time, consumer clicks each
- Progress indicator (1/5, 2/5, etc.)
- Brief instruction: "Look at each dot and click it"
- Re-calibration triggered at the start of each task session

### 7.5 Tracking Status Bar (P1)

- Small floating bar at top/bottom of page during active tracking
- Shows: "Recording for [brand]" + time elapsed + "Pause" button
- Minimal, non-intrusive, dismissable
- pointer-events: none by default, auto on hover

### 7.6 Permission Grant Screen

- Shown before the browser's native permission prompt
- Explains in plain language: "To track where you look on [brand].com, we need access to this site."
- "This lets us overlay the eye tracker on the page."
- "We only see the pages in this task — nothing else."
- "Allow" button triggers chrome.permissions.request()

---

## 8. Layer 5 — Shared Screens (4)

### 8.1 Client Auth (Login / Signup)
- Email + password or Google OAuth
- "I'm a brand looking for insights" context
- Links to /for-brands for more info

### 8.2 Consumer Auth (Login / Signup)
- Email + password or Google OAuth
- "I'm here to earn rewards" context
- Links to /for-you for more info
- After signup → onboarding flow (Layer 3, 6.6)

### 8.3 Email Templates (P1)
- Welcome email (client): "Your LessMissed account is ready. Create your first project."
- Welcome email (consumer): "Welcome! Install the extension and start earning."
- Reward earned (consumer): "You earned [reward] from [brand]! Here's your coupon code."
- Weekly digest (consumer): "You earned X rewards this week. Y new brands available."
- New data alert (client): "Your project [name] has 50 new sessions this week."

### 8.4 Error / Maintenance Pages (P2)
- 404 page
- 500 / server error page
- Maintenance mode page

---

## 9. Data Quality System

### The Problem
Consumers are incentivized by rewards. Some will try to game the system — opening a page and staring blankly or leaving the tab in the background. This produces useless gaze data.

### Solution: Engagement Score (0-100 per session)

Computed on the backend after each session. Invisible to the consumer.

| Signal | Weight | What it measures |
|--------|--------|-----------------|
| Fixation diversity | 30 pts | How many distinct UI elements received 200ms+ fixation. Real browsers: 5+. Farmers: 1-2. |
| Saccade pattern naturalness | 25 pts | Ratio of small (<100px) to large (>300px) saccades. Natural reading: ~4:1. Staring: 0 saccades. Random: even ratio. |
| Scroll-gaze correlation | 20 pts | When user scrolls, does gaze move to new content? High correlation = real reading. Zero = tab in background. |
| Page coverage | 15 pts | % of page's vertical height that received fixation. Real browser: 6-8 of 10 bands. Non-scroller: 2-3. |
| Interaction signals (bonus) | 10 pts | Clicks, hovers, form interactions. Not required but boosts confidence. |

### Score Thresholds

- **60-100**: Session accepted. Data enters client's dashboard. Consumer earns reward.
- **40-59**: Consumer sees "Keep exploring to earn your reward" (gentle nudge). Data quarantined.
- **0-39**: Session silently excluded. Consumer sees same nudge. No punishment, no accusation.

### Critical Rule
**Never withhold a reward because of a low engagement score.** If the consumer completed the task (visited all required pages), give them the reward regardless. Exclude the low-quality data from the client's dashboard. Coupon cost is the brand's and is worth it to maintain consumer trust and retention.

### What the Client Sees
- Data quality indicator on their dashboard: "87% of sessions passed quality check"
- Only score 60+ sessions appear in heatmaps and replays
- This is a trust signal — clients know they're getting verified engagement data

---

## 10. Technical Architecture

### Extension Tech Stack
- Manifest V3
- WebGazer.js for eye tracking
- Shadow DOM for UI injection (calibration dots, status bar)
- Iframe strategy: content.js injects iframe (overlay.html) over the page. overlay.html runs in extension context, requests camera.
- Communication: iframe sends (x,y) gaze coordinates to parent page. Parent adds scrollX/scrollY for true document position.
- Click-through: toggle pointer-events:none on iframe during browsing, pointer-events:auto during calibration.
- **Full-page screenshot capture**: When a consumer starts a task on a page, the extension background script captures the full page by scrolling through it viewport-by-viewport, calling `chrome.tabs.captureVisibleTab()` at each step, then stitching all segments together using OffscreenCanvas. The result is uploaded as a JPEG to `POST /api/extension/screenshot`. This screenshot is used as the base image for heatmap rendering — no tracking script or server-side rendering of the page is needed.

### Screenshot → Heatmap Pipeline
1. Extension captures full-page screenshot (scroll+stitch) on first consumer visit
2. Screenshot saved to `public/screenshots/{project_id}/{page_slug}.jpg` on the server
3. Screenshot metadata (URL, viewport dimensions, document height) stored on the page document in MongoDB
4. Client dashboard heatmap viewer loads the screenshot as the background image
5. Gaze fixation points and click events (stored as `document_x / document_y`) are plotted on top using heatmap.js
6. Coordinates align correctly because both the screenshot and the event data use the same document-coordinate system (viewport position + scroll offset)

### Backend Tech Stack
- Node.js + Socket.io (WebSocket for low-latency gaze streaming)
- Redis (buffer — do NOT write to DB 60 times/second. Buffer in Redis, batch write every 5 seconds)
- MongoDB Time Series (final storage)
- Data flow: Socket.on('gaze_data') → Redis RPUSH → Background worker every 5s → insertMany to MongoDB

### Data Processing Pipeline
1. **Smoothing (Kalman Filter)**: Weighted moving average. SmoothX = (CurrentX * 0.2) + (PreviousSmoothX * 0.8)
2. **Saccade Filtering**: If distance > 50px AND time < 20ms → discard (it's eye travel, not fixation)
3. **Element Mapping**: Extension sends XPath/ID of element under gaze. Backend aggregates fixation counts per element.
4. **Engagement Score**: Computed per session using the 5 signals above.

### Dashboard Tech Stack
- Next.js for UI
- heatmap.js for thermal overlays on screenshots
- rrweb for session recording and replay
- Chart.js or Recharts for analytics

### Deployment
- Backend: AWS EC2 or DigitalOcean Droplet (NOT serverless — WebSocket needs persistent connections). PM2 for process management.
- SSL: Required. WebGazer needs HTTPS. WebSocket needs WSS. Use Nginx + Certbot (Let's Encrypt).
- Database: MongoDB Atlas (cloud, not self-hosted).
- Extension: Chrome Web Store. Requires privacy policy page. Expect 1-2 week review.

---

## 11. Page Configuration & URL Matching

### How Clients Configure Pages
- During project setup (wizard step 2), client adds URL paths to track — no code changes needed on their website
- Exact paths: `/checkout` matches only that URL
- Wildcard paths: `/blog/*` matches all URLs under that prefix
- Import options: manual add (one per line), bulk CSV upload (future)
- Pages can be added/removed/paused after setup in project settings
- The extension automatically captures a screenshot and begins tracking the moment a consumer visits any configured page during an active task

### How the Extension Matches
- Tracked pages list cached locally in extension storage
- Synced from API every 5 minutes
- On task start: extension knows the specific pages for that task
- Extension checks current URL against task's page list on each navigation
- SPA handling: need to intercept history.pushState / popstate for route changes

### Page States
- **Active**: Currently tracking, collecting data
- **Paused**: Configured but not collecting (client can pause)
- **Awaiting data**: Newly added, no sessions yet

---

## 12. Coupon & Reward System

### Client Side (Coupon Creation)
- Type: percentage off, fixed amount, free delivery, custom text
- Value: number + currency
- Redemption cap: max total redemptions (e.g., first 500)
- Expiry date
- Minimum order value
- One-per-user restriction
- Auto-generated or custom coupon code

### Consumer Side (Reward Delivery)
- Reward unlocked when: all task pages visited AND engagement score ≥ 60 (or task completed regardless — see critical rule above)
- Coupon added to consumer's wallet automatically
- Consumer can: copy code, view details, see expiry
- Coupon states: earned (active), used, expired

### Brand Economics
- Brand pays LessMissed subscription for insights
- Brand provides coupons at their own cost
- LessMissed does NOT take a cut of coupon value
- Revenue model: subscription tiers (Starter/Growth/Enterprise)

---

## 13. Design Tokens & Style Guide

### Brand Colors (suggested)
- Primary (brand/client): Purple family
- Consumer/rewards: Teal family
- Alerts/warnings: Amber family
- Errors/critical: Red family
- Neutral/structural: Gray family

### Typography
- Use a distinctive, modern sans-serif (not Inter/Roboto/Arial)
- Pair with a clean body font
- Hierarchy: clear size + weight differentiation for headings vs body

### Design Principles
- Clean, flat surfaces. No gratuitous gradients.
- Generous whitespace
- Trust signals everywhere (especially consumer-facing)
- Progress indicators for multi-step flows
- Color-coded status badges (active/green, paused/amber, critical/red)

---

## 14. Build Priority

### Phase 1 (Launch MVP)
**Goal**: Get consumers installing and brands getting first insights.

P0 pages to build:
- Layer 1: Landing page, /for-brands, /for-you, /privacy
- Layer 3: Brand catalog, My rewards, Sign up, Onboarding
- Layer 4: All 6 extension screens
- Layer 2: Project setup wizard, Page detail (L3), Session replay, Task builder, Coupon manager
- Layer 5: Both auth flows

### Phase 2 (Post-Launch)
P1 pages:
- Layer 1: /pricing (can be a simple page at launch)
- Layer 2: All projects (L1), Project detail (L2), Analytics, Data quality dashboard
- Layer 3: Activity history, Profile/settings
- Layer 4: Tracking status bar
- Layer 5: Email templates

### Phase 3 (Scale)
P2 pages:
- Layer 1: /docs
- Layer 2: Team management, Billing, API keys
- Layer 3: Referral page
- Layer 5: Error pages

---

## 15. How to Use This Document

### With Claude Code / VS Code Claude Extension
1. Place this file in your project root as `PRODUCT_SPEC.md`
2. When starting a new page, prompt: "Build the [page name] page based on PRODUCT_SPEC.md section [X.X]"
3. Reference specific sections: "Implement the engagement score algorithm from section 9"
4. For components: "Create the brand card component as described in section 6.1"

### Suggested Build Order for Coding
1. Set up Next.js project with routing for all layers
2. Build Layer 1 pages (static marketing — fastest to ship)
3. Build Layer 4 extension (core product — needs testing time)
4. Build Layer 3 consumer app (depends on extension working)
5. Build Layer 2 client dashboard (depends on data flowing from extension)
6. Build Layer 5 shared screens as needed

### When Prompting Your AI Coding Assistant
- Always reference the specific section number
- Include the page name and which layer it belongs to
- Specify the user type (client vs consumer)
- Reference the data model (section 10) for backend work
- Reference the engagement score (section 9) for data processing
