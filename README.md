# LessMissed

**A three-sided marketplace for usability intelligence.**

LessMissed connects brands who need real user behavior data with consumers who browse naturally and earn rewards. It collects five behavioral signals — gaze, click, scroll, hover, and visibility — and transforms them into actionable UX insights through an engagement scoring engine.

---

## What's in this repo

```
LESSMISSED/
├── Web-App/lessmissed/       # Next.js dashboard & API
└── lessmissed_extension/     # Chrome browser extension
```

---

## Web App

**Stack:** Next.js 16 · React 19 · MongoDB (Mongoose) · AWS S3 · Tailwind CSS 4

The web app serves three audiences:

| Layer | Who | What they do |
|-------|-----|--------------|
| Marketing | Anyone | Landing page, sign-up |
| Client Dashboard | Brands / UX teams | Create projects, configure pages, launch tasks, view insights |
| Consumer App | Extension users | Browse tasks, earn coupons/rewards |

### Routes

```
app/
├── (marketing)/      # Public landing pages
├── (auth)/           # Login / register
├── dashboard/
│   ├── projects/     # Project & page management
│   ├── tasks/        # Task creation and tracking
│   ├── coupons/      # Reward management
│   └── setup/        # Onboarding
└── api/
    ├── auth/
    ├── projects/
    ├── tasks/
    ├── coupons/
    └── extension/    # Endpoints consumed by the Chrome extension
```

### Getting started

```bash
cd Web-App/lessmissed
npm install
cp .env.example .env.local   # fill in MONGODB_URI, AWS credentials, etc.
npm run dev                  # http://localhost:3000
```

---

## Chrome Extension

**Stack:** TypeScript · React 17 · Webpack 5

The extension runs in the consumer's browser and captures behavioral signals across a
brand's whole site. The consumer presses Start once; tracking then follows them from
page to page for the rest of the visit.

| Component | Role |
|-----------|------|
| `contentScript.ts` | Injected into every page — collects gaze, click, scroll, hover, and visibility events. Holds no session state: it asks the worker on each load whether a session is running (`SESSION_HELLO`) and resumes if so |
| `background.ts` | Service worker — **owns the session**. Follows navigation, records page transitions, batches events to the API, and captures deferred screenshots. State is mirrored to `chrome.storage.local` because MV3 terminates workers freely |
| `popup/` | Extension UI — start/stop, live page count, paused state |
| `options/` | Settings page |

### Site-wide tracking

- **Session continuity.** A full page load destroys the content script, so the worker is
  the only thing that survives a navigation. It binds the session to one tab, follows
  `chrome.tabs.onUpdated`, and transfers to a tab opened from the tracked one (product
  links open with `target="_blank"` constantly).
- **Off-site pauses, it does not end.** Leaving the brand's domain suspends collection;
  returning resumes it.
- **Pages discover themselves.** Every transition posts to `/api/extension/visits`, which
  registers pages it has not seen. URLs are templated first — `/products/8812` and
  `/products/9143` both become `/products/:id`, so a 5000-product store yields one page
  row rather than 5000. See `lib/pathTemplate.js`.
- **Screenshots are deferred.** `captureVisibleTab` only photographs a visible tab, and
  scroll-and-stitch would drag the page out from under a consumer whose gaze is being
  recorded. Pages needing a screenshot are queued and captured together, in a dedicated
  window, after the consumer stops.

### Getting started

```bash
cd lessmissed_extension
npm install

# Development (watch mode)
npm start

# Production build
npm run build
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

> Full build instructions: [lessmissed_extension/EXTENSION_BUILD.md](lessmissed_extension/EXTENSION_BUILD.md)

---

## Data signals

LessMissed collects five behavioral signals per page visit:

- **Gaze** — eye-tracking heatmaps (where users look)
- **Click** — tap and click positions
- **Scroll** — scroll depth and velocity
- **Hover** — cursor dwell time per element
- **Visibility** — which elements entered the viewport and for how long

These signals feed an **Engagement Score** engine that outputs 23 insight types — from attention hotspots to drop-off predictions.

Because a session spans a site, each is also attributed to the individual page visit it
happened on, giving per-page dwell, fixation and click counts plus the page-to-page flow
(`GET /api/projects/:id/flow`).

### Migrating existing data

Sessions recorded before site-wide capture hold only their entry page, and their events
carry no page template. Both are recoverable from data already in Mongo:

```bash
cd Web-App/lessmissed
node scripts/backfill-templates.mjs --dry-run   # inspect, write nothing
node scripts/backfill-templates.mjs             # apply
node scripts/relabel-pages.mjs                  # re-key region maps onto templates
```

It is idempotent, and honours `MONGODB_URI` so it can be rehearsed against a staging copy.

---

## Environment variables

Both packages require environment configuration. Neither `.env` nor `.env.local` files are committed to this repo.

**Web App** (`.env.local`):

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string |
| `NEXTAUTH_SECRET` | Auth session secret |
| `AWS_ACCESS_KEY_ID` | S3 credentials for screenshot storage |
| `AWS_SECRET_ACCESS_KEY` | S3 credentials |
| `AWS_REGION` | S3 region |
| `S3_BUCKET_NAME` | Bucket for gaze plot screenshots |

---

## License

Private — all rights reserved.
