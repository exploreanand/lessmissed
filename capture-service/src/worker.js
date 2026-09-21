// The worker loop.
//
// Lease a job, render it, give it back. Everything that can fail is expected to
// fail: the loop's job is to make sure a failure costs one job rather than the
// process, and that a job nobody finished comes back rather than disappearing.

import mongoose from "mongoose";
import { config, assertConfig } from "./config.js";
import { leaseJob, heartbeat, completeJob, failJob, reapExpired } from "./queue.js";
import { runCaptureJob } from "./capture.js";
import { BrowserPool } from "./render.js";

const pool = new BrowserPool();
let running = true;
let inFlight = 0;

async function main() {
  assertConfig();
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  console.log(`[capture] worker ${config.workerId} up, concurrency ${config.concurrency}`);

  installShutdownHandlers();

  while (running) {
    try {
      const reaped = await reapExpired();
      if (reaped) console.log(`[capture] reclaimed ${reaped} expired lease(s)`);

      // Only ever hold `concurrency` jobs at once; otherwise a fast queue would
      // launch unbounded renders and the container would run out of memory.
      while (running && inFlight < config.concurrency) {
        const job = await leaseJob();
        if (!job) break;
        inFlight++;
        void runJob(job).finally(() => { inFlight--; });
      }
    } catch (err) {
      console.error(`[capture] loop error: ${err.message}`);
    }

    await sleep(config.pollIntervalMs);
  }

  await drain();
}

// Named runJob, not process: a module-scope function called `process` shadows
// Node's global `process` object, so process.on and process.exitCode below
// would resolve to this function instead.
async function runJob(job) {
  const label = `${job.reason} ${job.page_id}@${job.breakpoint}`;
  const startedAt = Date.now();
  console.log(`[capture] start ${label} (attempt ${job.attempts}/${job.max_attempts})`);

  // Renders are bounded independently of the lease: a page that never settles
  // must not hold a slot forever, and Playwright's own timeouts only cover
  // individual calls, not the whole sequence.
  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(`Render exceeded ${config.renderTimeoutMs}ms`)),
      config.renderTimeoutMs
    ).unref()
  );

  try {
    const result = await Promise.race([
      runCaptureJob(job, pool, () => heartbeat(job._id)),
      timeout,
    ]);

    await completeJob(job._id, result.captureId);

    const elapsed = Date.now() - startedAt;
    if (result.discarded) {
      console.log(
        `[capture] done ${label} in ${elapsed}ms — discarded, ` +
          `only ${result.changedPct?.toFixed(2)}% changed`
      );
    } else {
      console.log(
        `[capture] done ${label} in ${elapsed}ms — stored ${result.captureId}` +
          (result.changedPct == null ? " (baseline)" : ` (${result.changedPct.toFixed(2)}% changed)`)
      );
    }
  } catch (err) {
    const permanent = PERMANENT_FAILURES.has(err?.code);
    const { retrying, dead } = await failJob(job._id, err, config.workerId, { permanent });
    console.error(
      `[capture] fail ${label}: ${err.message}` +
        (retrying ? " — will retry" : dead ? " — giving up" : "")
    );
  }
}

/** Let in-flight renders finish before closing the browser, within reason. */
async function drain() {
  const deadline = Date.now() + 30000;
  while (inFlight > 0 && Date.now() < deadline) await sleep(250);
  await pool.close();
  await mongoose.disconnect();
  console.log("[capture] worker stopped");
}

function installShutdownHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (!running) return;
      console.log(`[capture] ${signal} — finishing ${inFlight} in-flight job(s)`);
      running = false;
    });
  }

  // A rejected promise nobody caught is a bug, but it must not take the worker
  // down: the leases it holds would then sit until the reaper expires them.
  process.on("unhandledRejection", (reason) => {
    console.error(`[capture] unhandled rejection: ${reason}`);
  });
}

// Failure codes that a retry cannot fix.
const PERMANENT_FAILURES = new Set([
  "gone",          // the project or page was deleted
  "no_url",        // nothing configured to capture
  "wrong_origin",  // the URL does not belong to this project
  "bad_protocol",
  "credentials_in_url",
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

main().catch((err) => {
  console.error(`[capture] fatal: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
