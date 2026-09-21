# LessMissed capture service

Renders screenshots of configured target pages and versions them.

This replaces the old capture path, which ran in a consumer's browser: the
extension scrolled the page in viewport-sized steps, called
`chrome.tabs.captureVisibleTab` once per step at a mandated 520 ms spacing, and
stitched the JPEGs by hand. That design could only produce a screenshot if a
consumer happened to visit, captured *their* personalised view of the page, and
overwrote the previous image in place so nothing could ever be compared.

Here, captures are taken server-side with Playwright, on demand, and every
version is kept.

## Setup

```bash
npm install
npx playwright install chromium     # ~95 MB, once
```

No `.env` needed: `npm start` loads `../Web-App/lessmissed/.env.local`, which
already has `MONGODB_URI` and the AWS variables. Add a `capture-service/.env`
only to override one of them.

Stuck on "Preparing preview" in the dashboard? Run the diagnostics — it checks
config, Chromium, the queue and every target page, and names the broken link:

```bash
npm run doctor
```

## Try it without any infrastructure

`capture-once` renders a URL straight to a file. No database, no S3, no queue —
it shares `renderPage()` with the worker, so what you see is exactly what the
worker would store.

```bash
node src/capture-once.js https://example.com
node src/capture-once.js https://shop.com/pricing --breakpoint mobile
node src/capture-once.js https://news.site --mask ".ticker" --mask "#ad-slot"
node src/capture-once.js https://site.com --compare yesterday.jpg
```

It prints the geometry check, the timings and both hashes. Use it to tune
`--mask` and `--dismiss` selectors for an awkward page before saving them to
that page's configuration.

## Running the worker

```bash
npm start
```

It leases jobs from the `capturejobs` collection, renders them, and writes
`PageCapture` documents plus S3 objects. Jobs are created by the web app when an
admin adds a target page or clicks Recapture.

Stop it with SIGINT/SIGTERM; in-flight renders are given 30 s to finish. A
worker that dies mid-render loses nothing — the lease lapses and another worker
picks the job up, because a job is never removed from the queue, only leased.

## How a capture is decided

| Trigger | Reason | Stores a version? |
|---|---|---|
| Admin adds a target page | `baseline` | Always |
| Admin clicks Recapture | `manual` | Always — an explicit action deserves a record |
| Daily content hash drifted | `drift` | Only if the rendered image also changed |
| Baseline older than 30 days | `scheduled` | Only if the rendered image also changed |

The last two are what keep this cheap. A page visited ten thousand times and
never edited costs ten thousand nothing-happened HTTP requests a year and zero
renders. When a render *does* happen and the result is within
`CAPTURE_DIFF_THRESHOLD_PCT` of the current baseline, the image is thrown away
and only `last_checked_at` moves.

## The one invariant

Stored images are exactly `viewport_width × document_height` **CSS pixels**.

Every consumer downstream depends on it: `HeatmapViewer` scales gaze points by
`containerWidth / viewport_width`, `firstFixation.js` divides by
`document_height`, and `relabel-pages.mjs` crops region boxes out of the JPEG
with `sharp.extract` using document coordinates as literal pixel offsets.

So the renderer captures at `deviceScaleFactor: 2` for OCR legibility, downscales
to CSS pixels on write, then **decodes the encoded bytes and verifies the
dimensions** before the capture is allowed to become current. A mismatch fails
the job rather than storing an image that would silently misalign every insight
drawn on it. The old upload endpoint never decoded what it stored.

## Tests

```bash
npm test
CAPTURE_TEST_MONGO_URI=mongodb://127.0.0.1:27918/lm_queue_test npm test  # incl. queue
```

Queue tests need a throwaway mongod and skip cleanly without one. They cover the
property that matters most — 40 workers racing 20 jobs, each claimed exactly
once — which only reproduces under real contention.

**Never point `CAPTURE_TEST_MONGO_URI` at the `MONGODB_URI` in
`Web-App/lessmissed/.env.local`.** That is the production Atlas cluster, and the
tests delete every document in the collections they touch.
