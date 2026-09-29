import Fixation from "@/lib/models/Fixation";
import Session from "@/lib/models/Session";
import { describeElement, isInstrumentElement } from "@/lib/insights/describeElement";
import { pageMatchFilter } from "@/lib/pathTemplate";

// INS-G06: Scan Path / Reading Order — the ordered sequence of elements a user
// fixated on, aggregated across sessions to reveal the actual reading flow vs
// the one the page was designed for. SRS §7.1.
//
// A "step" in a scan path is a fixation on a new element. Consecutive fixations
// on the SAME element are one step, not many — a user dwelling on the hero for
// four gaze samples is still looking at the hero, not scanning. Without this
// collapse the sequences would be dominated by dwell-noise and every session's
// "path" would be the top-fixated element repeated over and over.

// Fixation duration threshold. Same cutoff INS-G04 uses to define a meaningful
// fixation — sub-200ms rows are saccade tails, not real looks.
const MIN_FIXATION_MS = 200;

// The two n-gram lengths we surface. Bigrams answer "what did users read after
// X?" and are the primary reading-order signal. Trigrams answer "what is the
// most common 3-step opening?" and give a slightly richer scan pattern.
const BIGRAM_N = 2;
const TRIGRAM_N = 3;

// Cap how many of each we return to the UI. Long lists dilute the signal.
const TOP_BIGRAMS = 5;
const TOP_TRIGRAMS = 3;

// Sessions with fewer distinct steps than this contribute nothing to any path —
// a single-fixation session has no reading order to speak of.
const MIN_STEPS = 2;

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
}

function emptyResult(totalSessions) {
  return {
    total_sessions: totalSessions,
    sessions_with_path: 0,
    median_path_length: 0,
    avg_path_length: 0,
    top_bigrams: [],
    top_trigrams: [],
    modal_opening: null,
  };
}

// Extract every n-gram of length `n` from a per-session step sequence, using
// only DISTINCT sessions per n-gram key (`sessionsWithBigram / totalSessions`
// is the meaningful denominator — a session that made the same transition
// three times is still one session that made it).
function collectNgrams(sessionSteps, n) {
  const counts = new Map(); // key -> Set<session_id>
  for (const [sessionId, steps] of sessionSteps) {
    if (steps.length < n) continue;
    // Local dedupe inside the session so one repeat doesn't inflate its own
    // contribution — the count is per-session, not per-occurrence.
    const seen = new Set();
    for (let i = 0; i <= steps.length - n; i++) {
      const key = steps.slice(i, i + n).join("→");
      if (seen.has(key)) continue;
      seen.add(key);
      let sessions = counts.get(key);
      if (!sessions) {
        sessions = new Set();
        counts.set(key, sessions);
      }
      sessions.add(sessionId);
    }
  }
  return counts;
}

// Takes the same shape as computeFirstFixation: lean project doc and page
// subdoc. Fixation.aggregate does not schema-cast $match, so project._id must
// already be an ObjectId.
export async function computeScanPath(project, page) {
  // Sessions that reached this page — same scoping rule as G04.
  const sessions = await Session.find(
    {
      project_id: project._id,
      status: "completed",
      "pages_visited.template": page.path,
    },
    { session_id: 1 }
  ).lean();

  const totalSessions = sessions.length;

  const fixations = await Fixation.find({
    project_id: project._id,
    ...pageMatchFilter(page),
    duration_ms: { $gte: MIN_FIXATION_MS },
  })
    .sort({ session_id: 1, start_timestamp: 1 })
    .select(
      "session_id region_id element_id element_tag element_text element_alt element_aria element_src"
    )
    .lean();

  if (fixations.length === 0) return emptyResult(totalSessions);

  const regionById = new Map((page.regions ?? []).map((r) => [r.region_id, r]));

  // Same label resolution G04 uses: region label wins because it fixes the
  // identity-collapse selectors can't; else describeElement() from DOM fields.
  const labelFor = (f) => {
    const region = regionById.get(f.region_id);
    if (region?.label) return region.label;
    return describeElement(f).label;
  };

  // Walk fixations in order, bucket by session, collapse consecutive dupes.
  const sessionSteps = new Map(); // session_id -> string[]
  for (const f of fixations) {
    // Overlay instrumentation must not appear in a reading order. Region-
    // labelled fixations bypass the check (a region can never be an overlay).
    if (!regionById.has(f.region_id) && isInstrumentElement(f.element_id)) continue;

    const label = labelFor(f);
    let steps = sessionSteps.get(f.session_id);
    if (!steps) {
      steps = [];
      sessionSteps.set(f.session_id, steps);
    }
    if (steps[steps.length - 1] !== label) steps.push(label);
  }

  // Length distribution and eligibility filter — sessions with < MIN_STEPS
  // distinct fixations contribute to the totals but not to any n-gram.
  const lengths = [];
  const eligible = new Map();
  for (const [sid, steps] of sessionSteps) {
    lengths.push(steps.length);
    if (steps.length >= MIN_STEPS) eligible.set(sid, steps);
  }

  const sessionsWithPath = eligible.size;

  if (sessionsWithPath === 0) {
    return {
      total_sessions: totalSessions,
      sessions_with_path: 0,
      median_path_length: median(lengths),
      avg_path_length: avg(lengths),
      top_bigrams: [],
      top_trigrams: [],
      modal_opening: null,
    };
  }

  const denominator = sessionsWithPath;
  const pct = (n) => Math.round((n / denominator) * 100);

  const rank = (counts, limit) =>
    [...counts.entries()]
      .map(([key, sessions]) => ({
        path: key.split("→"),
        session_count: sessions.size,
        pct: pct(sessions.size),
      }))
      // Rare paths (one session) rarely mean anything — drop them so the top
      // list carries signal, not one-off idiosyncrasies.
      .filter((row) => row.session_count >= 2)
      .sort((a, b) => b.session_count - a.session_count)
      .slice(0, limit);

  const topBigrams = rank(collectNgrams(eligible, BIGRAM_N), TOP_BIGRAMS);
  const topTrigrams = rank(collectNgrams(eligible, TRIGRAM_N), TOP_TRIGRAMS);

  // Modal opening: the most common first-3 sequence across sessions. Answers
  // "how do users usually start reading this page?" — a scan-path complement
  // to G04's first-look region.
  const openingCounts = new Map();
  for (const steps of eligible.values()) {
    if (steps.length < TRIGRAM_N) continue;
    const key = steps.slice(0, TRIGRAM_N).join("→");
    let sessions = openingCounts.get(key);
    if (!sessions) {
      sessions = new Set();
      openingCounts.set(key, sessions);
    }
    // Openings are naturally per-session (one session has one opening) but
    // using Sets keeps the shape consistent with the n-gram maps.
    sessions.add(steps);
  }
  const rankedOpenings = [...openingCounts.entries()]
    .map(([key, sessions]) => ({
      path: key.split("→"),
      session_count: sessions.size,
      pct: pct(sessions.size),
    }))
    .sort((a, b) => b.session_count - a.session_count);
  const modalOpening = rankedOpenings[0] ?? null;

  return {
    total_sessions: totalSessions,
    sessions_with_path: sessionsWithPath,
    median_path_length: median(lengths),
    avg_path_length: avg(lengths),
    top_bigrams: topBigrams,
    top_trigrams: topTrigrams,
    modal_opening: modalOpening,
  };
}
