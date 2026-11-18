// Remove duplicate fixation documents left behind by concurrent finalizes.
//
// PATCH /api/tag/sessions/:id used to guard on a non-atomic read — load the
// session, check status !== "completed", then finalize — while the sweeper
// claimed sessions atomically. A PATCH already past that check when a sweep
// claimed the same session ran derivation a second time, and derivation always
// inserted, so the session ended up with two complete sets of fixations. The
// tag's own endSession posts with keepalive, which browsers may retry, so two
// PATCHes could race each other the same way.
//
// Both routes now take a lease before doing any work, and derivation deletes a
// session's fixations before rewriting them, so no new duplicates can appear.
// This cleans up what is already there.
//
// Duplicates inflate everything that counts fixation rows: gaze heatmap
// density, per-visit fixation_count, avg fixations per session. Expect the
// numbers on affected pages to drop — that is the correction, not a regression.
//
// Usage:
//   node scripts/dedupe-fixations.mjs --dry-run      report, delete nothing
//   node scripts/dedupe-fixations.mjs                apply
//   node scripts/dedupe-fixations.mjs --project <id> limit to one project

import fs from "node:fs";
import mongoose from "mongoose";

const DRY_RUN = process.argv.includes("--dry-run");
const projectArgIdx = process.argv.indexOf("--project");
const ONLY_PROJECT = projectArgIdx > -1 ? process.argv[projectArgIdx + 1] : null;

// An explicit MONGODB_URI wins, so this can be rehearsed against a staging copy
// before it is pointed at production.
function readUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const match = env.match(/MONGODB_URI=(.*)/);
  if (!match) throw new Error("MONGODB_URI not found in .env.local");
  return match[1].trim();
}

// A fixation is identified by where and when it happened. Two rows sharing all
// of these are the same look derived twice — grouping stays per page_url, so a
// session with two tabs on different pages can legitimately share a start
// timestamp and is not collapsed here.
const identity = (f) =>
  [
    f.page_url,
    new Date(f.start_timestamp).getTime(),
    new Date(f.end_timestamp).getTime(),
    f.sample_count,
  ].join("|");

async function main() {
  await mongoose.connect(readUri(), { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  const fixations = db.collection("fixations");
  const sessions = db.collection("sessions");

  console.log(DRY_RUN ? "Dry run — nothing will be deleted.\n" : "Applying.\n");

  const sessionFilter = ONLY_PROJECT
    ? { project_id: new mongoose.Types.ObjectId(ONLY_PROJECT) }
    : {};

  // Per session, not one collection-wide $group: on a free-tier cluster an
  // aggregation over every fixation blows the 100MB in-memory sort limit, and
  // one session's fixations are a few hundred documents.
  const cursor = sessions.find(sessionFilter, {
    projection: { session_id: 1, project_id: 1 },
  });

  const perProject = new Map();
  let scanned = 0;
  let duplicates = 0;
  let affected = 0;

  for await (const session of cursor) {
    scanned++;
    const rows = await fixations
      .find({ session_id: session.session_id })
      .project({ _id: 1, page_url: 1, start_timestamp: 1, end_timestamp: 1, sample_count: 1 })
      .toArray();
    if (rows.length < 2) continue;

    const keep = new Map();
    const losers = [];
    for (const row of rows) {
      const key = identity(row);
      if (keep.has(key)) losers.push(row._id);
      else keep.set(key, row._id);
    }
    if (!losers.length) continue;

    affected++;
    duplicates += losers.length;
    const pid = String(session.project_id);
    perProject.set(pid, (perProject.get(pid) ?? 0) + losers.length);

    if (!DRY_RUN) {
      await fixations.deleteMany({ _id: { $in: losers } });
    }
  }

  console.log(`Scanned ${scanned} session(s).`);
  console.log(`${affected} session(s) held duplicates; ${duplicates} row(s) ${DRY_RUN ? "would be" : "were"} removed.\n`);
  if (perProject.size) {
    console.log("By project:");
    for (const [pid, n] of [...perProject].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${pid}  ${n}`);
    }
    console.log("\nHeatmap density and per-visit fixation counts on these projects will drop accordingly.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
