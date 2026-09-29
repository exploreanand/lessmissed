import Event from "@/lib/models/Event";
import Fixation from "@/lib/models/Fixation";
import Session from "@/lib/models/Session";
import { describeElement, isInstrumentElement } from "@/lib/insights/describeElement";
import { pageMatchFilter } from "@/lib/pathTemplate";

// INS-GC02: Clicked Without Looking — a click on an element that the same
// session never fixated on (≥200ms) beforehand. The user acted from
// familiarity or muscle memory: label copy on that element didn't influence
// the decision, so tweaking wording is the wrong lever there. SRS §7.4. This
// is one of the six "unique to LessMissed" combined-signal insights.

// Same fixation-duration cut as G04/G05/G06/G07/G08 — a fixation shorter than
// this is a saccade tail, not a real look, and doesn't count as "having seen".
const MIN_FIXATION_MS = 200;

// An element enters the ranked list only when at least this many sessions
// clicked it without looking. One user's muscle-memory click is anecdote,
// not a page-level signal.
const MIN_SESSIONS_FOR_TOP = 2;

const TOP_ELEMENTS = 5;

function emptyResult(totalSessions = 0, totalClicks = 0) {
  return {
    total_sessions: totalSessions,
    total_clicks: totalClicks,
    total_cwl: 0,
    sessions_with_cwl: 0,
    pct_sessions_with_cwl: 0,
    pct_cwl_of_all_clicks: 0,
    top_elements: [],
  };
}

// Takes lean project doc and page subdoc. Two selective finds + a JS join,
// which is cheaper than a $lookup across two collections and simpler than an
// aggregation with $facet.
export async function computeClickedWithoutLooking(project, page) {
  const sessions = await Session.find(
    {
      project_id: project._id,
      status: "completed",
      "pages_visited.template": page.path,
    },
    { session_id: 1 }
  ).lean();

  const totalSessions = sessions.length;
  if (totalSessions === 0) return emptyResult(0, 0);

  const [clicks, fixations] = await Promise.all([
    Event.find({
      "metadata.project_id": project._id,
      ...pageMatchFilter(page),
      type: "click",
    })
      .sort({ session_id: 1, timestamp: 1 })
      .select(
        "session_id timestamp data.element_id data.element_key data.element_tag data.element_text data.element_alt data.element_aria data.element_src data.is_interactive"
      )
      .lean(),
    Fixation.find({
      project_id: project._id,
      ...pageMatchFilter(page),
      duration_ms: { $gte: MIN_FIXATION_MS },
    })
      .sort({ session_id: 1, start_timestamp: 1 })
      .select("session_id start_timestamp element_id element_key")
      .lean(),
  ]);

  if (clicks.length === 0) return emptyResult(totalSessions, 0);

  // Per-session index of first-fixation-time per element key. `$sort` above
  // ensures the first entry we encounter is the earliest, so we only set the
  // key once. A missing entry means "session never fixated on that key".
  const firstFixBySession = new Map();
  for (const f of fixations) {
    const key = f.element_key || f.element_id;
    if (!key) continue;
    let m = firstFixBySession.get(f.session_id);
    if (!m) {
      m = new Map();
      firstFixBySession.set(f.session_id, m);
    }
    if (!m.has(key)) m.set(key, new Date(f.start_timestamp).getTime());
  }

  const perElement = new Map();
  const sessionsWithCwl = new Set();
  let totalCwl = 0;

  for (const c of clicks) {
    const data = c.data ?? {};
    // Overlay instrumentation must not appear — a click on the gaze dot is
    // never a muscle-memory action about the page.
    if (isInstrumentElement(data.element_id)) continue;
    const key = data.element_key || data.element_id;
    if (!key) continue;

    const clickTs = new Date(c.timestamp).getTime();
    const priorFixTs = firstFixBySession.get(c.session_id)?.get(key);
    const hadPriorFixation = priorFixTs != null && priorFixTs < clickTs;

    if (hadPriorFixation) continue; // normal informed click — not CWL

    let stats = perElement.get(key);
    if (!stats) {
      stats = {
        key,
        element_id: data.element_id ?? key,
        label: describeElement(data).label,
        element_tag: data.element_tag ?? null,
        is_interactive: data.is_interactive ?? null,
        sessions: new Set(),
        click_count: 0,
      };
      perElement.set(key, stats);
    }
    stats.sessions.add(c.session_id);
    stats.click_count += 1;

    sessionsWithCwl.add(c.session_id);
    totalCwl += 1;
  }

  const topElements = [...perElement.values()]
    .map((s) => ({
      key: s.key,
      element_id: s.element_id,
      label: s.label,
      element_tag: s.element_tag,
      is_interactive: s.is_interactive,
      sessions_with_cwl: s.sessions.size,
      pct_sessions: Math.round((s.sessions.size / totalSessions) * 100),
      click_count: s.click_count,
    }))
    .filter((e) => e.sessions_with_cwl >= MIN_SESSIONS_FOR_TOP)
    .sort((a, b) => {
      if (b.sessions_with_cwl !== a.sessions_with_cwl)
        return b.sessions_with_cwl - a.sessions_with_cwl;
      return b.click_count - a.click_count;
    })
    .slice(0, TOP_ELEMENTS);

  return {
    total_sessions: totalSessions,
    total_clicks: clicks.length,
    total_cwl: totalCwl,
    sessions_with_cwl: sessionsWithCwl.size,
    pct_sessions_with_cwl: Math.round((sessionsWithCwl.size / totalSessions) * 100),
    pct_cwl_of_all_clicks:
      clicks.length > 0 ? Math.round((totalCwl / clicks.length) * 100) : 0,
    top_elements: topElements,
  };
}
