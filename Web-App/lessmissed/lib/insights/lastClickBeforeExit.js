import Event from "@/lib/models/Event";
import Session from "@/lib/models/Session";
import { describeElement, isInstrumentElement } from "@/lib/insights/describeElement";
import { pageMatchFilter } from "@/lib/pathTemplate";

// INS-C04: Last Click Before Exit — the final click a non-completing session
// made on this page, when this page was where they exited the site. Ranked by
// element, this names the conversion killers: buttons users pressed right
// before they gave up. SRS §7.3.
//
// The "before exit" scoping matters. A session that clicked around a product
// page, then navigated to checkout, then abandoned there — its "last click
// before exit" is on checkout, not on the product page. This query only
// aggregates sessions whose exit_template IS this page, so the finding on any
// given page is about that page's own conversion drop-off.

// An element enters the top list only when at least this many exiting
// sessions ended on it — below the floor it's one user's story, not a signal.
const MIN_SESSIONS_FOR_TOP = 2;

const TOP_ELEMENTS = 5;

function emptyResult(totalSessions = 0) {
  return {
    total_sessions: totalSessions,
    exiting_sessions: 0,
    exiting_sessions_with_click: 0,
    top_elements: [],
  };
}

// Takes lean project doc and page subdoc. Two-step: pull the eligible
// sessions (exit here, task not completed), then aggregate their last click
// on this page. Doing it in one pipeline would need a $lookup across the
// events time-series collection, which is an order of magnitude slower.
export async function computeLastClickBeforeExit(project, page) {
  // Total sessions on this page — the outer denominator, for context on the
  // card headline. Same scoping as every other page-level insight.
  const totalOnPage = await Session.countDocuments({
    project_id: project._id,
    status: "completed",
    "pages_visited.template": page.path,
  });

  // Eligible sessions: this was the exit page AND the session did not complete
  // the task. `status: "completed"` here means the session was properly
  // finalized (as opposed to still "active"); the task-completion flag is a
  // separate field that answers "did they achieve the goal". Both matter:
  // an abandoned session's exit_template is unreliable if the session was
  // interrupted mid-flow rather than truly ended.
  const exitingSessions = await Session.find(
    {
      project_id: project._id,
      status: "completed",
      exit_template: page.path,
      task_completed: false,
    },
    { session_id: 1 }
  ).lean();

  if (exitingSessions.length === 0) return emptyResult(totalOnPage);

  const sessionIds = exitingSessions.map((s) => s.session_id);

  // Last click per session on this page. $sort + $group with $first picks the
  // most recent click, which by "last click before exit" is what we want.
  const lastClicks = await Event.aggregate([
    {
      $match: {
        "metadata.project_id": project._id,
        ...pageMatchFilter(page),
        type: "click",
        session_id: { $in: sessionIds },
      },
    },
    { $sort: { session_id: 1, timestamp: -1 } },
    {
      $group: {
        _id: "$session_id",
        element_id: { $first: "$data.element_id" },
        element_key: { $first: "$data.element_key" },
        element_tag: { $first: "$data.element_tag" },
        element_text: { $first: "$data.element_text" },
        element_alt: { $first: "$data.element_alt" },
        element_aria: { $first: "$data.element_aria" },
        element_src: { $first: "$data.element_src" },
        is_interactive: { $first: "$data.is_interactive" },
        timestamp: { $first: "$timestamp" },
      },
    },
  ]);

  if (lastClicks.length === 0) {
    // The exiting sessions never clicked on this page — they may have scrolled
    // or fixated only. Report the counts but no top list.
    return {
      total_sessions: totalOnPage,
      exiting_sessions: exitingSessions.length,
      exiting_sessions_with_click: 0,
      top_elements: [],
    };
  }

  // Group by same identity ladder as C02/C03. Click events have no region_id,
  // so it's element_key → element_id.
  const perElement = new Map();
  for (const row of lastClicks) {
    // Overlay instrumentation must not appear as a conversion killer. A dead
    // click on the gaze dot is not a page problem.
    if (isInstrumentElement(row.element_id)) continue;
    const key = row.element_key || row.element_id;
    if (!key) continue;

    let stats = perElement.get(key);
    if (!stats) {
      stats = {
        key,
        element_id: row.element_id ?? key,
        label: describeElement(row).label,
        element_tag: row.element_tag ?? null,
        is_interactive: row.is_interactive ?? null,
        sessions: new Set(),
      };
      perElement.set(key, stats);
    }
    stats.sessions.add(row._id);
  }

  const denominator = exitingSessions.length;
  const topElements = [...perElement.values()]
    .map((s) => ({
      key: s.key,
      element_id: s.element_id,
      label: s.label,
      element_tag: s.element_tag,
      is_interactive: s.is_interactive,
      session_count: s.sessions.size,
      pct_of_exiting: Math.round((s.sessions.size / denominator) * 100),
      pct_of_page_sessions: totalOnPage
        ? Math.round((s.sessions.size / totalOnPage) * 100)
        : 0,
    }))
    .filter((e) => e.session_count >= MIN_SESSIONS_FOR_TOP)
    .sort((a, b) => b.session_count - a.session_count)
    .slice(0, TOP_ELEMENTS);

  return {
    total_sessions: totalOnPage,
    exiting_sessions: exitingSessions.length,
    exiting_sessions_with_click: lastClicks.length,
    top_elements: topElements,
  };
}
