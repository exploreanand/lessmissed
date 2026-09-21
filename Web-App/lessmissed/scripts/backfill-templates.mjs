// Brings existing data up to the site-wide capture model.
//
// Three things changed that historical documents predate:
//   1. events and fixations now carry page_template — the key every insight
//      query groups on.
//   2. Project.pages holds auto-discovered pages, not just hand-typed ones.
//   3. Session.pages_visited is the whole journey, not just the entry page.
//
// All three can be recovered from data already in Mongo: the raw events were
// always stamped with a page_url and a timestamp, they were simply never rolled
// up. Nothing here deletes anything.
//
// Usage:
//   node scripts/backfill-templates.mjs --dry-run      inspect, write nothing
//   node scripts/backfill-templates.mjs                apply
//   node scripts/backfill-templates.mjs --project <id> limit to one project
//
// Run scripts/relabel-pages.mjs afterwards so region maps re-key onto templates.

import fs from "node:fs";
import mongoose from "mongoose";

import {
  normalizePath,
  slugFromTemplate,
  isWildcardTemplate,
  findMatchingPage,
} from "../lib/pathTemplate.js";

const DRY_RUN = process.argv.includes("--dry-run");
const projectArgIdx = process.argv.indexOf("--project");
const ONLY_PROJECT = projectArgIdx > -1 ? process.argv[projectArgIdx + 1] : null;

const MAX_PAGES_PER_PROJECT = 200;

// An explicit MONGODB_URI wins, so this can be rehearsed against a staging copy
// before it is pointed at production.
function readUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const match = env.match(/MONGODB_URI=(.*)/);
  if (!match) throw new Error("MONGODB_URI not found in .env.local");
  return match[1].trim();
}

/**
 * Stamp page_template on a collection, one bulk update per distinct page_url.
 * Grouping by distinct URL keeps this to a handful of updateMany calls instead
 * of one write per document — a busy project has millions of events but only
 * hundreds of URLs.
 */
async function stampTemplates(collection, label, filter = {}) {
  const urls = await collection.distinct("page_url", {
    ...filter,
    $or: [{ page_template: null }, { page_template: { $exists: false } }],
  });

  if (!urls.length) {
    const total = await collection.countDocuments(filter);
    console.log(`  ${label}: ${total === 0 ? "no documents" : "already stamped"}`);
    return 0;
  }

  // One template usually covers many URLs, so invert the mapping and issue one
  // update per template rather than per URL.
  const byTemplate = new Map();
  for (const url of urls) {
    const template = normalizePath(url);
    if (!byTemplate.has(template)) byTemplate.set(template, []);
    byTemplate.get(template).push(url);
  }

  let modified = 0;
  for (const [template, groupUrls] of byTemplate) {
    if (DRY_RUN) {
      modified += groupUrls.length;
      continue;
    }
    const res = await collection.updateMany(
      { ...filter, page_url: { $in: groupUrls } },
      { $set: { page_template: template } }
    );
    modified += res.modifiedCount ?? 0;
  }

  console.log(
    `  ${label}: ${urls.length} distinct URLs → ${byTemplate.size} templates` +
      (DRY_RUN ? " (dry run)" : `, ${modified} docs updated`)
  );
  return modified;
}

async function main() {
  await mongoose.connect(readUri());
  const db = mongoose.connection.db;
  const { ObjectId } = mongoose.mongo;

  const events = db.collection("events");
  const fixations = db.collection("fixations");
  const sessions = db.collection("sessions");
  const projects = db.collection("projects");

  const projFilter = ONLY_PROJECT ? { _id: new ObjectId(ONLY_PROJECT) } : {};
  const projectDocs = await projects.find(projFilter).toArray();

  for (const project of projectDocs) {
    console.log(`\n=== ${project.name} (${project._id}) ===`);

    // ── 1. Stamp page_template on raw and derived signals ──────────────────
    await stampTemplates(events, "events", { "metadata.project_id": project._id });
    await stampTemplates(fixations, "fixations", { project_id: project._id });

    // ── 2. Register pages that have data but no row ────────────────────────
    const seenTemplates = await events.distinct("page_template", {
      "metadata.project_id": project._id,
    });

    const pages = [...(project.pages ?? [])];
    const takenSlugs = new Set(pages.map((p) => p.slug));
    const added = [];

    for (const template of seenTemplates.filter(Boolean)) {
      if (findMatchingPage(pages, template)) continue;
      if (pages.length + added.length >= MAX_PAGES_PER_PROJECT) {
        console.log(`  page cap reached — ${seenTemplates.length} templates seen`);
        break;
      }

      let slug = slugFromTemplate(template);
      if (takenSlugs.has(slug)) {
        let n = 2;
        while (takenSlugs.has(`${slug}-${n}`)) n++;
        slug = `${slug}-${n}`;
      }
      takenSlugs.add(slug);

      added.push({
        path: template,
        slug,
        type: isWildcardTemplate(template) ? "wildcard" : "exact",
        status: "active",
        discovered: true,
        added_at: new Date(),
        first_seen_at: null,
        session_count: 0,
        regions: [],
      });
    }

    if (added.length) {
      console.log(`  pages: +${added.length} discovered (${added.map((p) => p.path).join(", ")})`);
      if (!DRY_RUN) {
        await projects.updateOne({ _id: project._id }, { $push: { pages: { $each: added } } });
        pages.push(...added);
      }
    } else {
      console.log("  pages: nothing new to register");
    }

    // ── 3. Rebuild journeys from the events that recorded them ─────────────
    const projectSessions = await sessions
      .find({ project_id: project._id }, { projection: { session_id: 1, pages_visited: 1, started_at: 1, ended_at: 1 } })
      .toArray();

    let rebuilt = 0;

    for (const session of projectSessions) {
      // A template on every visit is the signal that this journey was written by
      // the site-wide pipeline and needs nothing. A single-visit journey counts:
      // a genuine one-page session looks exactly like that, and rebuilding it
      // would be work for an identical result.
      const existing = session.pages_visited ?? [];
      if (existing.length > 0 && existing.every((v) => v.template)) continue;

      // Order of first appearance, and last appearance, per URL — enough to
      // reconstruct the sequence of pages and the time spent on each.
      const timeline = await events
        .find(
          { session_id: session.session_id },
          { projection: { page_url: 1, page_template: 1, timestamp: 1, type: 1, data: 1 } }
        )
        .sort({ timestamp: 1 })
        .toArray();

      if (!timeline.length) continue;

      const visits = [];
      for (const ev of timeline) {
        const path = ev.page_url ?? "/";
        const computed = ev.page_template ?? normalizePath(path);
        const matched = findMatchingPage(pages, path);
        const template = matched?.path ?? computed;

        const current = visits.at(-1);
        if (current && current.path === path) {
          current.left_at = ev.timestamp;
          if (ev.type === "click") current.click_count += 1;
          if (ev.type === "scroll" && ev.data?.depth_pct != null) {
            current.max_scroll_depth_percent = Math.max(
              current.max_scroll_depth_percent,
              ev.data.depth_pct
            );
          }
          continue;
        }

        visits.push({
          path,
          template,
          entered_at: ev.timestamp,
          left_at: ev.timestamp,
          dwell_ms: 0,
          fixation_count: 0,
          click_count: ev.type === "click" ? 1 : 0,
          max_scroll_depth_percent:
            ev.type === "scroll" && ev.data?.depth_pct != null ? ev.data.depth_pct : 0,
        });
      }

      // Fixations are derived, so count them against the visit windows.
      const sessionFixations = await fixations
        .find({ session_id: session.session_id }, { projection: { start_timestamp: 1 } })
        .toArray();

      for (const visit of visits) {
        visit.dwell_ms = Math.max(0, new Date(visit.left_at) - new Date(visit.entered_at));
      }
      for (const f of sessionFixations) {
        const t = new Date(f.start_timestamp).getTime();
        const hit = visits.find(
          (v) => t >= new Date(v.entered_at).getTime() && t <= new Date(v.left_at).getTime()
        );
        if (hit) hit.fixation_count += 1;
      }

      rebuilt++;
      if (!DRY_RUN) {
        await sessions.updateOne(
          { _id: session._id },
          {
            $set: {
              pages_visited: visits,
              entry_template: visits[0]?.template ?? null,
              exit_template: visits.at(-1)?.template ?? null,
            },
          }
        );
      }
    }

    console.log(
      `  sessions: ${rebuilt}/${projectSessions.length} journeys rebuilt` + (DRY_RUN ? " (dry run)" : "")
    );

    // ── 4. Refresh per-page session counts from the rebuilt journeys ───────
    if (!DRY_RUN) {
      const refreshed = await sessions
        .find(
          { project_id: project._id, status: "completed" },
          { projection: { pages_visited: 1, ended_at: 1 } }
        )
        .toArray();

      const counts = new Map();
      for (const s of refreshed) {
        for (const t of new Set((s.pages_visited ?? []).map((v) => v.template).filter(Boolean))) {
          const entry = counts.get(t) ?? { count: 0, last: null };
          entry.count += 1;
          if (!entry.last || (s.ended_at && s.ended_at > entry.last)) entry.last = s.ended_at;
          counts.set(t, entry);
        }
      }

      for (const [template, { count, last }] of counts) {
        await projects.updateOne(
          { _id: project._id, "pages.path": template },
          { $set: { "pages.$.session_count": count, "pages.$.last_session_at": last ?? null } }
        );
      }
      console.log(`  page counters: refreshed for ${counts.size} pages`);
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
