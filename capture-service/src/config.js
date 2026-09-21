// Worker configuration. Every value is overridable by environment variable so
// the same image runs in dev and production without a code change.

import os from "node:os";
import crypto from "node:crypto";

const num = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  mongoUri: process.env.MONGODB_URI,

  // Identifies this worker in CaptureJob.worker_id, so a stuck lease can be
  // traced back to the process that took it.
  workerId: `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString("hex")}`,

  // How many pages render at once. Each is a separate browser context sharing
  // one Chromium process. Past ~4 on 2 vCPU the renders slow each other down
  // more than the parallelism gains.
  concurrency: num("CAPTURE_CONCURRENCY", 3),

  // A lease must outlive the slowest realistic render, or the reaper will hand
  // the job to a second worker while the first is still working on it. Renders
  // heartbeat, so this is a ceiling on silence rather than on total runtime.
  leaseSeconds: num("CAPTURE_LEASE_SECONDS", 180),
  heartbeatSeconds: num("CAPTURE_HEARTBEAT_SECONDS", 30),

  // Empty-queue poll interval. Jobs are enqueued by the web app, not pushed, so
  // this is the latency an admin sees between clicking and the render starting.
  pollIntervalMs: num("CAPTURE_POLL_INTERVAL_MS", 2000),

  // Per-phase render budgets. Navigation is the one that actually trips on slow
  // sites; the rest are generous and exist so a hung page cannot hold a slot.
  navigationTimeoutMs: num("CAPTURE_NAVIGATION_TIMEOUT_MS", 45000),
  renderTimeoutMs: num("CAPTURE_RENDER_TIMEOUT_MS", 120000),

  // Pages taller than this are captured truncated rather than not at all. The
  // old extension had the same cap at 15000 but reported the *truncated* height
  // as the true document height, so fixations below it were silently plotted
  // off-image. Here the cap is recorded (PageCapture.truncated) and the honest
  // document height is kept alongside it.
  // Generous on purpose: a long product-listing or landing page in the 20-30k
  // range is ordinary, and truncating one costs real data. JPEG tops out at
  // 65535 px per side, so this stays well inside what can be encoded.
  maxDocumentHeightPx: num("CAPTURE_MAX_DOCUMENT_HEIGHT_PX", 40000),

  // Below this share of changed non-masked pixels, a render is discarded rather
  // than stored. This is the dial that keeps capture volume proportional to
  // change instead of to traffic.
  diffThresholdPct: num("CAPTURE_DIFF_THRESHOLD_PCT", 1.0),

  // Force a fresh baseline this often even when nothing looks changed, so a
  // blind spot in the hash cannot leave a page stale forever.
  maxBaselineAgeDays: num("CAPTURE_MAX_BASELINE_AGE_DAYS", 30),

  // Retention: current baseline plus this many historical versions per page and
  // breakpoint. Older ones are pruned unless a region map still cites them.
  keepVersions: num("CAPTURE_KEEP_VERSIONS", 10),

  jpegQuality: num("CAPTURE_JPEG_QUALITY", 88),
  thumbWidth: num("CAPTURE_THUMB_WIDTH", 480),

  s3: {
    bucket: process.env.AWS_S3_BUCKET,
    region: process.env.AWS_REGION,
    baseUrl: process.env.AWS_S3_BASE_URL,
  },
};

export function assertConfig() {
  const missing = ["MONGODB_URI", "AWS_S3_BUCKET", "AWS_REGION"].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Capture service is missing required env: ${missing.join(", ")}`);
  }
}
