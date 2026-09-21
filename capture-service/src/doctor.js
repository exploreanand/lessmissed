#!/usr/bin/env node
// "Why is my page still saying Preparing preview?"
//
// Checks every link in the chain and says which one is broken, rather than
// leaving the answer to be inferred from a worker that prints nothing because
// it never started.
//
//   npm run doctor

import mongoose from "mongoose";
import { chromium } from "playwright";
import { config } from "./config.js";

const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg, fix) => {
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  if (fix) console.log(`      \x1b[2m→ ${fix}\x1b[0m`);
  problems++;
};
const info = (msg) => console.log(`    \x1b[2m${msg}\x1b[0m`);

let problems = 0;

console.log("\nLessMissed capture service — diagnostics\n");

// ---- 1. Configuration ------------------------------------------------------
console.log("Configuration");
const required = {
  MONGODB_URI: config.mongoUri,
  AWS_S3_BUCKET: config.s3.bucket,
  AWS_REGION: config.s3.region,
};
for (const [name, value] of Object.entries(required)) {
  if (value) ok(`${name} is set`);
  else {
    bad(
      `${name} is missing`,
      "npm start reads ../Web-App/lessmissed/.env.local automatically; add the var there or in capture-service/.env"
    );
  }
}
if (!config.s3.baseUrl) {
  bad(
    "AWS_S3_BASE_URL is missing",
    "Needed to build the image URL the dashboard loads. Without it previews upload but do not display."
  );
} else {
  ok("AWS_S3_BASE_URL is set");
}

// Which database are we about to act on? Worth saying out loud — the worker
// must point at the same one the dashboard writes jobs to, and in this repo
// .env.local is the production cluster.
if (config.mongoUri) {
  const redacted = config.mongoUri.replace(/\/\/[^@]*@/, "//<credentials>@");
  info(redacted);
  if (/mongodb\+srv|atlas/i.test(config.mongoUri)) {
    info("this looks like a hosted cluster, not a local mongod");
  }
}

// ---- 2. Chromium -----------------------------------------------------------
console.log("\nBrowser");
try {
  const browser = await chromium.launch();
  const version = browser.version();
  await browser.close();
  ok(`Chromium launches (${version})`);
} catch (err) {
  bad(`Chromium will not launch: ${err.message.split("\n")[0]}`, "npx playwright install chromium");
}

// ---- 3. Database + queue ---------------------------------------------------
console.log("\nQueue");
if (!config.mongoUri) {
  bad("Cannot check the queue without MONGODB_URI");
} else {
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
    ok(`Connected to database "${mongoose.connection.name}"`);

    const CaptureJob = (await import("../../Web-App/lessmissed/lib/models/CaptureJob.js")).default;
    const Project = (await import("../../Web-App/lessmissed/lib/models/Project.js")).default;

    const counts = await CaptureJob.aggregate([
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);
    const byStatus = Object.fromEntries(counts.map((c) => [c._id, c.n]));

    const queued = byStatus.queued ?? 0;
    const leased = byStatus.leased ?? 0;

    if (queued || leased) {
      ok(`${queued} job(s) waiting, ${leased} being rendered`);
      const pending = await CaptureJob.find({ status: { $in: ["queued", "leased"] } })
        .sort({ priority: -1, run_after: 1 })
        .limit(5)
        .lean();
      for (const job of pending) {
        const due = job.run_after > new Date() ? ` (retry at ${job.run_after.toISOString()})` : "";
        info(`${job.status}  ${job.reason}  attempt ${job.attempts}/${job.max_attempts}${due}`);
        if (job.last_error) info(`  last error: ${job.last_error.slice(0, 120)}`);
      }
      if (!leased) {
        info("nothing is being rendered — is the worker running? (npm start)");
      }
    } else {
      ok("No jobs waiting");
    }

    if (byStatus.dead) {
      bad(
        `${byStatus.dead} job(s) gave up after repeated failures`,
        "Check the page URL, then click Recapture in the dashboard"
      );
      const dead = await CaptureJob.find({ status: "dead" }).limit(3).lean();
      for (const job of dead) info(`dead: ${job.last_error?.slice(0, 140) ?? "no error recorded"}`);
    }

    // ---- 4. Target pages ---------------------------------------------------
    console.log("\nTarget pages");
    const projects = await Project.find({ "pages.target": true })
      .select("name domain pages")
      .lean();

    const targets = projects.flatMap((p) =>
      (p.pages ?? [])
        .filter((page) => page.target)
        .map((page) => ({ project: p.name, ...page }))
    );

    if (!targets.length) {
      info("None configured yet — add one in the dashboard under Pages → Target pages");
    } else {
      for (const page of targets) {
        const status = page.screenshot_status ?? "none";
        const mark = status === "captured" ? "✓" : status === "failed" ? "✗" : "…";
        console.log(`  ${mark} ${page.project}  ${page.path}  [${status}]`);
        if (!page.capture_url) info("no capture_url — this page cannot be rendered");
        if (page.availability_error) info(`error: ${page.availability_error}`);
      }
    }

    await mongoose.disconnect();
  } catch (err) {
    bad(`Could not reach MongoDB: ${err.message.split("\n")[0]}`,
      "Check MONGODB_URI, and that this machine's IP is allowed if using Atlas");
  }
}

console.log(
  problems === 0
    ? "\n\x1b[32mEverything checks out.\x1b[0m Run `npm start` to process the queue.\n"
    : `\n\x1b[31m${problems} problem(s) found.\x1b[0m Fix the above, then run \`npm start\`.\n`
);

process.exit(problems === 0 ? 0 : 1);
