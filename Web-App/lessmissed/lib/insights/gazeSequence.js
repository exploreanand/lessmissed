import Event from "../models/Event.js";
import Fixation from "../models/Fixation.js";
import Session from "../models/Session.js";
import { describeElement, isInstrumentElement } from "./describeElement.js";
import { pageMatchFilter } from "../pathTemplate.js";

// The ordered per-session gaze sequence: what a visitor looked at, in order,
// with consecutive dwell on one element collapsed into a single visit.
//
// INS-G06 (scanPath.js) and INS-G07 (backtracking.js) each build this inline,
// and they disagree: G06 keys its sequence by *label*, which merges two
// different elements that happen to describe the same way, while G07 keys by
// `region_id || element_key || element_id`. G07's ladder is the right one and
// is what this uses. Those two are deliberately left alone — re-pointing them
// here would move numbers already on screen for reasons unrelated to the
// insight being added. This exists so GC05 and GC06 share one definition
// instead of adding a third and a fourth.
//
// Relative imports, no "@/" alias, so tests and scripts can load it — which
// neither scanPath.js nor backtracking.js can be.

// A fixation shorter than this is a saccade tail, not a look. Same cut as
// G04-G08, GC02, GC03 and GC04.
const MIN_FIXATION_MS = 200;

// Region → positional key → selector. Without the middle rung every unclassed
// <p> on the page merges into one bucket.
export function elementKey(f) {
  return f.region_id || f.element_key || f.element_id || null;
}

// Positional keys are DOM paths ("body>main>section>div>a:nth-of-type(1)"), so
// containment is a prefix test. Keys that are not paths (a selector like
// "#cta", or a region id) have depth 1 and only ever match exactly.
export function keyDepth(key) {
  return key ? String(key).split(">").length : 0;
}

// Did a look at `fixKey` amount to looking at or near `targetKey`?
//
// This is what SRS §7.4's "fixating NEAR target" has to mean in practice.
// Clicks resolve to the exact control under the cursor; a fixation resolves to
// whatever elementFromPoint returns for a gaze centroid, which is nearly
// always an ancestor container. Measured 2026-11-20 on live data: of the 12
// interactive click targets on the landing page, *none* was ever itself
// fixated, while 6 had a fixated ancestor — 4 of them the target's direct
// parent. Requiring an exact key match makes this insight unable to fire at
// all, not because nobody is distracted but because the two signals name
// different nodes.
//
// `maxLevels` bounds how far up still counts as "near", so a stray fixation on
// <body> does not read as a look at every button on the page.
export function isNearKey(fixKey, targetKey, maxLevels = 2) {
  if (!fixKey || !targetKey) return false;
  if (fixKey === targetKey) return true;
  // Gaze landed inside the control (on a button's label span, say).
  if (String(fixKey).startsWith(targetKey + ">")) return true;
  // Gaze landed on an ancestor of the control.
  if (String(targetKey).startsWith(fixKey + ">")) {
    return keyDepth(targetKey) - keyDepth(fixKey) <= maxLevels;
  }
  return false;
}

export function elementLabel(f, regionById) {
  const region = regionById?.get(f.region_id);
  if (region?.label) return region.label;
  return describeElement(f).label;
}

// Pure. Returns Map<session_id, visit[]>, each visit:
//   { key, label, element_id, element_tag, start_ms, end_ms, fixation_count }
// Consecutive fixations on the same key are one visit, so a sequence is the
// path between elements rather than a list of samples. Sorted defensively, so
// callers need not have sorted the input.
export function buildSessionVisits({ fixations = [], regions = [] } = {}) {
  const regionById = new Map((regions ?? []).map((r) => [r.region_id, r]));

  const usable = fixations
    .filter((f) => {
      if (f.duration_ms != null && f.duration_ms < MIN_FIXATION_MS) return false;
      const key = elementKey(f);
      if (key == null) return false;
      // Our own overlay is instrumentation, not content. A region-labelled
      // fixation bypasses the check — a region is never an overlay.
      //
      // Judged on the identity we are actually keying by, not on element_id
      // alone: isInstrumentElement(null) is true by design ("don't name this
      // in a brand-facing ranking"), so testing element_id first would discard
      // a fixation that carries a perfectly good positional key. The tag sends
      // both today, which is why its siblings get away with the narrower test.
      if (!regionById.has(f.region_id) && isInstrumentElement(f.element_id || key)) return false;
      return true;
    })
    .map((f) => ({ f, ts: new Date(f.start_timestamp).getTime() }))
    .filter((x) => Number.isFinite(x.ts))
    .sort((a, b) =>
      a.f.session_id === b.f.session_id
        ? a.ts - b.ts
        : a.f.session_id < b.f.session_id
        ? -1
        : 1
    );

  const sequences = new Map();
  for (const { f, ts } of usable) {
    let visits = sequences.get(f.session_id);
    if (!visits) {
      visits = [];
      sequences.set(f.session_id, visits);
    }
    const key = elementKey(f);
    const last = visits[visits.length - 1];
    const end = ts + (f.duration_ms ?? 0);

    // Dwell on the same element — extend the visit rather than opening a new
    // one, so "moved away and came back" stays distinguishable from "kept
    // looking".
    if (last && last.key === key) {
      last.end_ms = Math.max(last.end_ms, end);
      last.fixation_count += 1;
      continue;
    }

    visits.push({
      key,
      label: elementLabel(f, regionById),
      element_id: f.element_id ?? key,
      element_tag: f.element_tag ?? null,
      start_ms: ts,
      end_ms: end,
      fixation_count: 1,
    });
  }

  return sequences;
}

// Pure. Map<session_id, Set<element key>> of what each session clicked, keyed
// by the same ladder minus the region rung: click events carry no region_id.
export function buildSessionClicks({ clicks = [] } = {}) {
  const bySession = new Map();
  for (const c of clicks) {
    const data = c.data ?? {};
    const key = data.element_key || data.element_id;
    if (!key) continue;
    // Same reasoning as buildSessionVisits: judge the identity in use.
    if (isInstrumentElement(data.element_id || key)) continue;
    let set = bySession.get(c.session_id);
    if (!set) {
      set = new Set();
      bySession.set(c.session_id, set);
    }
    set.add(key);
  }
  return bySession;
}

// Pure. The element keys that count as click targets: ones the DOM reported as
// interactive when somebody clicked them.
//
// A dead click does not make its victim a target. 78% of the clicks on the
// landing page in this database are dead ones — people stabbing at headings
// and paragraphs — and counting those would make almost every block of copy a
// "click target" whose lost attention GC05 then reports as a conversion
// problem. INS-C03 already reports dead clicks, as themselves.
//
// If no click on the page carries the flag at all, the tag that recorded them
// predates it; fall back to treating every clicked element as a target rather
// than reporting that the page has none. Measured 2026-11-20: the field is
// present on 100% of clicks in this database, so the fallback is insurance,
// not the live path.
// Returns Map<key, { element_id, label, element_tag }>. The metadata comes from
// the click event rather than from a fixation, because the control itself is
// typically never fixated (see isNearKey) — so this is the only place its real
// name is available.
export function buildClickTargets({ clicks = [] } = {}) {
  const flagKnown = clicks.some((c) => typeof (c.data ?? {}).is_interactive === "boolean");

  const targets = new Map();
  for (const c of clicks) {
    const data = c.data ?? {};
    if (flagKnown && data.is_interactive !== true) continue;
    const key = data.element_key || data.element_id;
    if (!key) continue;
    if (isInstrumentElement(data.element_id || key)) continue;
    if (targets.has(key)) continue;
    targets.set(key, {
      element_id: data.element_id ?? key,
      label: describeElement(data).label,
      element_tag: data.element_tag ?? null,
    });
  }
  return targets;
}

// Loads everything the sequence insights need in one place: the session count,
// the per-session gaze path, what each session clicked, and which elements
// count as click targets.
export async function loadGazeSequences(project, page) {
  const totalSessions = await Session.countDocuments({
    project_id: project._id,
    status: "completed",
    "pages_visited.template": page.path,
  });

  if (totalSessions === 0) {
    return {
      totalSessions: 0,
      sequences: new Map(),
      clicksBySession: new Map(),
      targets: new Map(),
    };
  }

  const pageFilter = pageMatchFilter(page);
  const [fixations, clicks] = await Promise.all([
    Fixation.find({
      project_id: project._id,
      ...pageFilter,
      duration_ms: { $gte: MIN_FIXATION_MS },
    })
      .sort({ session_id: 1, start_timestamp: 1 })
      .select(
        "session_id start_timestamp duration_ms region_id element_key element_id element_tag element_text element_alt element_aria element_src"
      )
      .lean(),
    Event.find({ "metadata.project_id": project._id, ...pageFilter, type: "click" })
      .select("session_id timestamp data.element_id data.element_key data.is_interactive")
      .lean(),
  ]);

  return {
    totalSessions,
    sequences: buildSessionVisits({ fixations, regions: page.regions ?? [] }),
    clicksBySession: buildSessionClicks({ clicks }),
    targets: buildClickTargets({ clicks }),
    // The raw rows too: INS-SL01 needs the fixation/click pairing per session,
    // and re-querying for it would double the work this already did.
    fixations,
    clicks,
  };
}

export { MIN_FIXATION_MS };
