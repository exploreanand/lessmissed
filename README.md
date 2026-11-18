# LessMissed

**A three-sided marketplace for usability intelligence.**

LessMissed connects brands who need real user behaviour data with consumers who browse naturally and earn rewards. It records five behavioural signals — gaze, click, scroll, hover and visibility — and turns them into UX insights drawn over a screenshot of each page.

---

## What's in this repo

```
LESSMISSED/
├── Web-App/lessmissed/     # Next.js dashboard + API
├── capture-service/        # Background worker that screenshots target pages
├── label-service/          # Optional: Python image-labelling service
└── evaluation/             # Research harness for the paper — not needed to run the app
```

| Piece | Stack | Runs as | Needed? |
|---|---|---|---|
| **Web app** | Next.js 16 · React 19 · MongoDB · S3 | `npm run dev` on :3000 | Yes |
| **Capture service** | Node · Playwright/Chromium · MongoDB · S3 | a long-running process | Yes, for page previews |
| **Tag** (`lm.js`) | Vanilla JS · WebGazer | a `<script>` on the client's site | Yes, to record sessions |
| **Label service** | Python · FastAPI · Florence-2 | `uvicorn` on :8077 | No |

### How the pieces talk

```
  lm.js script tag ──events, page visits──►  Web app  ◄──reads──  You (dashboard)
                                               │
                                        writes capture jobs
                                               ▼
                                            MongoDB  ◄──polls every 2s──  Capture service
                                                                               │
                                                     S3  ◄──uploads screenshots┘
```

The web app and the capture service never call each other. The web app writes a *capture job* to MongoDB; the capture service picks it up, renders the page in a headless browser, uploads the image to S3 and records the result. That is why adding a page returns instantly and the preview appears a few seconds later.

---

## Prerequisites

- **Node.js 22.9 or newer.** The capture service relies on `--env-file-if-exists` and on Node loading ES modules from `.js` files, both of which need 22.9+. Check with `node -v`.
- **MongoDB** — a local `mongod` is simplest (`brew install mongodb-community`). Atlas also works.
- **An S3 bucket** that allows public reads of the `screenshots/` prefix (see [Environment variables](#environment-variables)).
- **Google Chrome**, and a webcam for eye tracking.
- Python 3.10+ only if you want the optional label service.

> ⚠️ **Use your own database while developing.** Don't point `MONGODB_URI` at a shared or production cluster — your test sessions, captures and the `scripts/` backfills all write to whatever it points at.

---

## Setup

Do these in order — the capture service needs the web app running.

### 1. Web app

```bash
cd Web-App/lessmissed
npm install
cp .env.example .env.local      # then fill in MongoDB + S3 values
npm run dev                     # http://localhost:3000
```

Open http://localhost:3000/signup and create an account. There is no default login.

### 2. Capture service

```bash
cd capture-service
npm install
npx playwright install chromium   # ~95 MB, once
npm run doctor                    # checks config, Chromium, the database and the queue
npm start                         # leave this running
```

No separate `.env` is needed: `npm start` reads `../Web-App/lessmissed/.env.local`. Create `capture-service/.env` only to override a value — see `capture-service/.env.example`.

`npm run doctor` is the first thing to run whenever something looks wrong. It tells you which link is broken — missing config, Chromium not installed, database unreachable, or jobs waiting because no worker is running.

### 3. Try it end to end

1. In the dashboard, click **New project**. Enter the site's URL and at least one page to track — paste full URLs or type paths.
2. Within a few seconds each page shows **Preview ready**. If it stays on *Preparing preview…*, the capture service isn't running — see [Troubleshooting](#troubleshooting).
3. Open the project's **Install** tab and copy the `<script>` snippet, then add it to the site you want to track (a local test page is fine).
4. Load that page, click **Allow** on the consent pop-up, and browse a few pages.
5. Back in the dashboard, open a page to see its heatmap.

---

## Environment variables

### Web app — `Web-App/lessmissed/.env.local`

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `AWS_REGION` | ✅ | Region of the screenshot bucket |
| `AWS_S3_BUCKET` | ✅ | Bucket that screenshots are uploaded to |
| `AWS_S3_BASE_URL` | ✅ | Public base URL of that bucket — the dashboard loads images from it |
| `AWS_ACCESS_KEY_ID` | ✅ | S3 credentials |
| `AWS_SECRET_ACCESS_KEY` | ✅ | S3 credentials |
| `EVENTS_TTL_DAYS` | | Days to keep raw events (default `90`) |
| `LM_LABEL_SERVICE_URL` | | Label service address (default `http://127.0.0.1:8077`) |
| `WEB_SESSION_SWEEP` | | Set `0` to stop the web app finalizing sessions (default on) |
| `WEB_SWEEP_INTERVAL_MS` | | How often it checks (default `30000`) |
| `WEB_SWEEP_LEAVE_GRACE_MS` | | Wait this long after a visitor leaves (default `90000`) |
| `WEB_SWEEP_IDLE_MS` | | Silence before finalizing anyway (default 45 min) |

`.env.example` has all of these with comments.

**The bucket must allow public reads.** Screenshot URLs are built as `AWS_S3_BASE_URL` + key and loaded straight into an `<img>`, so a private bucket uploads fine but every preview shows as broken. Signed URLs are planned, not built.

### Capture service

It uses the web app's values above. Tuning knobs — concurrency, timeouts, the change threshold, how many versions to keep — are documented in `capture-service/.env.example` and all have sensible defaults.

---

## Day-to-day commands

| Where | Command | What it does |
|---|---|---|
| `Web-App/lessmissed` | `npm run dev` | Dashboard + API on :3000 |
| | `npm run build` | Production build (also a good compile check) |
| `capture-service` | `npm start` | Run the worker |
| | `npm run doctor` | Diagnose why previews aren't appearing |
| | `node src/capture-once.js <url>` | Render one URL to a local file — no database or S3 needed |
| | `npm test` | Run the test suite |

---

## Tests

```bash
cd capture-service
npm test                                   # everything that doesn't need a database
```

Tests that exercise the job queue and page registration need a **throwaway** database. They create and drop their own per-suite databases, so never point them at real data:

```bash
mkdir -p /tmp/lm-test && mongod --dbpath /tmp/lm-test --port 27918   # in another terminal
CAPTURE_TEST_MONGO_URI=mongodb://127.0.0.1:27918/x npm test
```

Without `CAPTURE_TEST_MONGO_URI` those tests skip themselves rather than fail.

---

## How page capture works

Screenshots are taken **on the server**, by the capture service, and only of the pages you configure as **target pages**.

- **Adding a page** queues a baseline capture. **Recapture** queues a new one on demand — use it after you change the page.
- Each capture opens a fresh 1440×900 headless Chromium, blocks ads and trackers, dismisses cookie banners, scrolls so lazy images load, waits for fonts and images, and takes one full-page screenshot. It also records every visible element on the page, which is what "missed elements" is measured against.
- Every version is kept under a new S3 key; nothing is overwritten. If a new render is visually identical to the current one it's discarded rather than stored — except a Recapture, which always stores.
- Jobs are leased from MongoDB, so a worker can crash mid-capture without losing anything: the job goes back in the queue and runs again.

`capture-service/README.md` has the full details.

### When a session ends

A visitor who closes the tab can't tell the server they've gone — `pagehide`
fires for an ordinary same-site navigation too. So the tag sends it as a *hint*
and the server decides: if nothing from the next page clears that hint within a
minute or so, the session is finalized and its fixations, engagement score and
page rollups are computed. A session whose hint never arrives at all — a crashed
tab, a killed browser — is finalized after 30 minutes of silence.

Both the web app and the capture service run that sweep, on different
thresholds, so finalization keeps working when either one is down. Whichever
gets there first takes a lease on the session, and the session is only marked
completed once the work has actually succeeded — an interrupted finalize is
retried rather than lost.

### Site-wide tracking

- **Session continuity.** A full page load destroys the content script, so the background worker owns the session. It follows the tab across navigations and tells the page where it is on client-side (SPA) route changes too.
- **Off-site pauses; it does not end.** Leaving the brand's domain suspends collection, and coming back resumes it.
- **Pages discover themselves.** Pages the consumer visits that aren't targets are grouped by template — `/products/8812` and `/products/9143` both become `/products/:id` — and appear under **Seen on your site** as suggestions. They're only captured and reported on once you add them.

---

## Data signals and metrics

Five signals per page visit: **gaze** (where users look), **click**, **scroll**, **hover** and **visibility**.

On each page the dashboard shows:

| Metric | What it is |
|---|---|
| **Fixations / Avg fixation** | Gaze samples clustered into fixations, and their average duration |
| **Missed** | Elements on the page no fixation landed on (SRS INS-G03) |
| **Engagement** | 0–100 per session, from the five weighted signals in SRS §6 |
| **Health** | 0.5 × (100 − missed %) + 0.3 × engagement + 0.2 × how far down the page attention reached. Shown once a page has 3 sessions |

Health isn't defined in the SRS; the formula above is a proposal. A metric that can't be computed yet shows "—", never 0.

The page-to-page flow is at `GET /api/projects/:id/flow`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Page stuck on **Preparing preview…** | Capture service isn't running | `cd capture-service && npm run doctor`, then `npm start` |
| Preview shows as a broken image | S3 bucket isn't publicly readable | Allow public reads on `screenshots/*` |
| Captures behave like old code | An older worker is still running | `pkill -f src/worker.js`, then `npm start` |
| A page shows **Couldn't capture** | The URL failed three times (404, timeout, blocked) | Check the URL opens in a browser, then click Recapture |

---

## Not built yet

So nobody is surprised:

- **No automatic change detection.** Pages are captured when added and when you click Recapture. Nothing re-checks a page on its own, so if the live site changes, the preview stays as it was until someone recaptures. (`npm run check` refers to a scheduled checker that doesn't exist yet.)
- **No deployment setup.** There's no Dockerfile. The capture service runs only while a terminal is running it; queued jobs wait safely until it starts again.
- **Screenshots need a public bucket** until signed URLs are added.

---

## Migrating existing data

Sessions recorded before site-wide tracking hold only their entry page, and their events carry no page template. Both can be rebuilt from data already in MongoDB:

```bash
cd Web-App/lessmissed
node scripts/backfill-templates.mjs --dry-run   # inspect, write nothing
node scripts/backfill-templates.mjs             # apply
node scripts/relabel-pages.mjs                  # re-key region maps onto templates
```

The backfill is idempotent and honours `MONGODB_URI`, so you can rehearse it against a staging copy first.

---

## License

Private — all rights reserved.
