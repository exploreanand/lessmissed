// Rebuilds fixations with their semantic fields, then builds a labelled region
// map for every page that has fixation data.
//
// Historical fixations were derived before element_text/alt/rect were carried
// through, so they only hold element_id + xpath. The raw `events` are still in
// Mongo, so re-deriving recovers the semantics without any data loss.
//
// Usage:
//   node scripts/relabel-pages.mjs --dry-run      inspect, write nothing
//   node scripts/relabel-pages.mjs                re-derive + write regions
//   node scripts/relabel-pages.mjs --project <id> limit to one project

import fs from "node:fs";
import mongoose from "mongoose";

import { deriveFixations } from "../lib/deriveFixations.js";
import Fixation from "../lib/models/Fixation.js";
import {
  buildRegionsFromRects,
  buildRegionsFromClusters,
  resolveRegion,
} from "../lib/insights/regionMap.js";
import { pageMatchFilter } from "../lib/pathTemplate.js";
import { ocrScreenshot } from "../lib/insights/ocrPage.js";
import { isLabelServiceUp, labelRegionCrop } from "../lib/insights/vlmLabel.js";

const DRY_RUN = process.argv.includes("--dry-run");
const projectArgIdx = process.argv.indexOf("--project");
const ONLY_PROJECT = projectArgIdx > -1 ? process.argv[projectArgIdx + 1] : null;

function readUri() {
  const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const match = env.match(/MONGODB_URI=(.*)/);
  if (!match) throw new Error("MONGODB_URI not found in .env.local");
  return match[1].trim();
}

async function main() {
  await mongoose.connect(readUri());
  const db = mongoose.connection.db;
  const { ObjectId } = mongoose.mongo;

  const projFilter = ONLY_PROJECT ? { _id: new ObjectId(ONLY_PROJECT) } : {};
  const projects = await db.collection("projects").find(projFilter).toArray();

  for (const project of projects) {
    const sessions = await db
      .collection("sessions")
      .find({ project_id: project._id }, { projection: { session_id: 1 } })
      .toArray();
    if (!sessions.length) continue;

    console.log(`\n=== ${project.name} (${sessions.length} sessions) ===`);

    // 1. Re-derive fixations so element_text/alt/rect are carried through.
    if (!DRY_RUN) {
      for (const s of sessions) {
        await Fixation.deleteMany({ session_id: s.session_id });
        await deriveFixations(s.session_id, project._id.toString());
      }
    }

    // 2. Build a region map per page from the refreshed fixations.
    for (const page of project.pages ?? []) {
      const fixations = await Fixation.find({
        project_id: project._id,
        ...pageMatchFilter(page),
      }).lean();

      if (!fixations.length) {
        console.log(`  ${page.slug}: no fixations, skipped`);
        continue;
      }

      const dims = {
        width: page.screenshot_viewport_width || 1440,
        fold: page.screenshot_viewport_height || null,
        docHeight: page.screenshot_document_height || null,
      };

      // OCR the page screenshot once — this is what names the images, which
      // carry no DOM text at all.
      let ocrPhrases = [];
      let screenshotBuf = null;
      if (page.screenshot_url) {
        try {
          const res = await fetch(page.screenshot_url);
          if (res.ok) {
            screenshotBuf = Buffer.from(await res.arrayBuffer());
            ocrPhrases = await ocrScreenshot(screenshotBuf);
          } else {
            console.log(`    (screenshot fetch failed: HTTP ${res.status})`);
          }
        } catch (err) {
          console.log(`    (screenshot OCR skipped: ${err.message})`);
        }
      }

      const withRects = fixations.filter((f) => f.element_rect?.w).length;
      const regions =
        withRects >= 5
          ? buildRegionsFromRects(fixations, dims, ocrPhrases)
          : buildRegionsFromClusters(fixations, dims, ocrPhrases);
      const how = withRects >= 5 ? "element rects" : "coordinate clusters";

      // Last rung: caption whatever alt/text/OCR could not name. Skipped
      // entirely when the service is down, so the run still succeeds.
      const unnamed = regions.filter((r) => r.source === "selector");
      if (unnamed.length && screenshotBuf && (await isLabelServiceUp())) {
        const { default: sharp } = await import("sharp").catch(() => ({ default: null }));
        for (const r of unnamed) {
          if (!sharp) break;
          try {
            const crop = await sharp(screenshotBuf)
              .extract({
                left: Math.max(0, r.bbox.x),
                top: Math.max(0, r.bbox.y),
                width: Math.max(16, r.bbox.w),
                height: Math.max(16, r.bbox.h),
              })
              .jpeg({ quality: 85 })
              .toBuffer();
            const got = await labelRegionCrop(crop);
            if (got) {
              r.label = got.label;
              r.source = "vlm";
              r.confidence = 0.5;
            }
          } catch {
            /* one bad crop must not abort the page */
          }
        }
      } else if (unnamed.length) {
        console.log(`    ${unnamed.length} region(s) unnamed — label-service not running`);
      }

      // Report what the ranking looks like now vs before.
      const bySelector = new Map();
      for (const f of fixations) {
        const k = f.element_id || "(empty)";
        bySelector.set(k, (bySelector.get(k) ?? 0) + 1);
      }
      const topSelectors = [...bySelector.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

      console.log(
        `  ${page.slug}: ${fixations.length} fixations, ${regions.length} regions ` +
          `(via ${how}, ${ocrPhrases.length} OCR phrases)`
      );
      console.log(`    BEFORE (raw selectors): ${topSelectors.map(([k, n]) => `${k}=${n}`).join(", ")}`);
      console.log(`    AFTER  (labelled regions):`);
      for (const r of regions.slice(0, 6)) {
        console.log(`      • ${r.label}  [${r.category}, via ${r.source}]`);
      }

      const sourceMix = regions.reduce((acc, r) => {
        acc[r.source] = (acc[r.source] ?? 0) + 1;
        return acc;
      }, {});
      console.log(`    label sources: ${JSON.stringify(sourceMix)}`);

      if (!DRY_RUN) {
        const stamped = regions.map((r) => ({
          ...r,
          labeled_at: new Date(),
          screenshot_captured_at: page.screenshot_captured_at ?? null,
        }));
        await db
          .collection("projects")
          .updateOne(
            { _id: project._id, "pages.slug": page.slug },
            { $set: { "pages.$.regions": stamped } }
          );

        // Stamp each fixation with the region it falls in, so the insight
        // aggregations can group by region instead of by DOM selector — that
        // grouping is what stops one selector covering three components.
        const ops = [];
        for (const f of fixations) {
          const hit = resolveRegion(regions, f.center_x, f.center_y);
          if (!hit) continue;
          ops.push({
            updateOne: { filter: { _id: f._id }, update: { $set: { region_id: hit.region_id } } },
          });
        }
        if (ops.length) {
          const res = await Fixation.bulkWrite(ops, { ordered: false });
          console.log(`    stamped ${res.modifiedCount}/${fixations.length} fixations with a region`);
        }
      }
    }
  }

  await mongoose.disconnect();
  console.log(DRY_RUN ? "\nDry run complete — nothing written." : "\nDone.");
}

main().catch(async (err) => {
  console.error("FAILED:", err.message);
  console.error(err.stack);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
