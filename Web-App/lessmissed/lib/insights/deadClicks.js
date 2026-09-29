import Event from "@/lib/models/Event";
import Session from "@/lib/models/Session";
import { describeElement, isInstrumentElement } from "@/lib/insights/describeElement";
import { pageMatchFilter } from "@/lib/pathTemplate";

// INS-C03: Dead Clicks — clicks on non-interactive elements. The signal comes
// directly from the extension: contentScript stamps every click with
// `data.is_interactive`, true for a/button/input/select/textarea/label/summary
// and false for everything else. A dead click on an <img> or <span> that a
// user believed to be clickable reveals a misleading affordance: the visual
// weight promised interactivity the DOM never delivered. SRS §7.3.

// Structural tags where a click is almost always a miss, not a misleading
// affordance. Filtering them out is the difference between "your hero graphic
// looks like a button" and "someone missed a tiny link and hit the page".
const STRUCTURAL_TAGS = new Set(["html", "body", "main"]);

// An element enters the ranked list only when at least this many sessions
// dead-clicked it. Below the floor the finding is a single-user artefact.
const MIN_SESSIONS_FOR_TOP = 2;

const TOP_ELEMENTS = 5;

function emptyResult(totalSessions = 0) {
  return {
    total_sessions: totalSessions,
    total_dead_clicks: 0,
    sessions_with_dead_click: 0,
    pct_sessions_with_dead_click: 0,
    top_elements: [],
  };
}

// Takes lean project doc and page subdoc. Query is index-friendly:
// (metadata.project_id, page_template, type) is already covered and the
// is_interactive filter drops most events at the storage layer.
export async function computeDeadClicks(project, page) {
  const sessions = await Session.find(
    {
      project_id: project._id,
      status: "completed",
      "pages_visited.template": page.path,
    },
    { session_id: 1 }
  ).lean();

  const totalSessions = sessions.length;
  if (totalSessions === 0) return emptyResult(0);

  const events = await Event.find({
    "metadata.project_id": project._id,
    ...pageMatchFilter(page),
    type: "click",
    "data.is_interactive": false,
  })
    .select(
      "session_id data.element_id data.element_key data.element_tag data.element_text data.element_alt data.element_aria data.element_src"
    )
    .lean();

  if (events.length === 0) return emptyResult(totalSessions);

  const perElement = new Map();
  const sessionsAny = new Set();
  let totalDeadClicks = 0;

  for (const e of events) {
    const data = e.data ?? {};
    // Overlay instrumentation — a click on the gaze dot is never an affordance
    // problem in the page.
    if (isInstrumentElement(data.element_id)) continue;
    // Whole-page misses. STRUCTURAL_TAGS drop clicks on html/body/main; the
    // key check drops events with no element_key AND no element_id, which
    // happens when the target was the document itself.
    if (STRUCTURAL_TAGS.has(data.element_tag)) continue;
    const key = data.element_key || data.element_id;
    if (!key) continue;

    let stats = perElement.get(key);
    if (!stats) {
      stats = {
        key,
        element_id: data.element_id ?? key,
        label: describeElement(data).label,
        element_tag: data.element_tag ?? null,
        sessions: new Set(),
        click_count: 0,
      };
      perElement.set(key, stats);
    }
    stats.sessions.add(e.session_id);
    stats.click_count += 1;

    sessionsAny.add(e.session_id);
    totalDeadClicks += 1;
  }

  const topElements = [...perElement.values()]
    .map((s) => ({
      key: s.key,
      element_id: s.element_id,
      label: s.label,
      element_tag: s.element_tag,
      sessions_with_dead_click: s.sessions.size,
      pct_sessions: Math.round((s.sessions.size / totalSessions) * 100),
      click_count: s.click_count,
      avg_clicks_per_session: Math.round(s.click_count / s.sessions.size),
    }))
    .filter((e) => e.sessions_with_dead_click >= MIN_SESSIONS_FOR_TOP)
    // Breadth first (how many users tripped on this), depth as tiebreaker.
    .sort((a, b) => {
      if (b.sessions_with_dead_click !== a.sessions_with_dead_click)
        return b.sessions_with_dead_click - a.sessions_with_dead_click;
      return b.click_count - a.click_count;
    })
    .slice(0, TOP_ELEMENTS);

  return {
    total_sessions: totalSessions,
    total_dead_clicks: totalDeadClicks,
    sessions_with_dead_click: sessionsAny.size,
    pct_sessions_with_dead_click: Math.round(
      (sessionsAny.size / totalSessions) * 100
    ),
    top_elements: topElements,
  };
}
