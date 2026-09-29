import Event from "@/lib/models/Event";
import Session from "@/lib/models/Session";
import { describeElement, isInstrumentElement } from "@/lib/insights/describeElement";
import { pageMatchFilter } from "@/lib/pathTemplate";

// INS-C02: Rage Clicks — bursts of ≥3 clicks on the same element where each
// successive gap is within the rage window. A single rage event is one such
// burst; a session hammering the same button ten times in a row is one rage
// event, not eight. Ranked per element by the number of sessions in which
// that element caused rage — breadth trumps depth. SRS §7.3.

// The SRS ships "click_count >= 3 on same element within 1500ms". Interpreted
// as an inter-click gap: each click within 1500ms of the previous one is part
// of the same burst; a 1500ms+ pause closes the burst. This matches the plain
// meaning of "rapid clicking on the same thing" better than a fixed 1500ms
// wall-clock window (which would arbitrarily split a slightly-slower burst).
const RAGE_MAX_GAP_MS = 1500;
const RAGE_MIN_CLICKS = 3;

const TOP_ELEMENTS = 5;

function emptyResult(totalSessions = 0) {
  return {
    total_sessions: totalSessions,
    total_rage_events: 0,
    sessions_with_rage: 0,
    pct_sessions_with_rage: 0,
    top_elements: [],
  };
}

// Same identity ladder as the fixation-based insights, minus the region rung
// (click events do not carry region_id — the extension resolves regions from
// the page-region editor, which only applies to gaze). element_key is the
// positional selector, so unclassed <button>s do not collapse together.
function keyFor(clickData) {
  return clickData?.element_key || clickData?.element_id || null;
}

// Takes lean project doc and page subdoc. Uses find() rather than an
// aggregation because burst detection needs an ordered walk and $group can't
// express "count clicks whose gap to their predecessor is under X".
export async function computeRageClicks(project, page) {
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
  })
    .sort({ session_id: 1, timestamp: 1 })
    .select(
      "session_id timestamp data.element_id data.element_key data.element_tag data.element_text data.element_alt data.element_aria data.element_src"
    )
    .lean();

  if (events.length === 0) return emptyResult(totalSessions);

  // element key → aggregate stats across sessions. label is captured from the
  // first click's element metadata; describeElement handles missing fields.
  const perElement = new Map();
  const sessionsWithRage = new Set();
  let totalRageEvents = 0;

  // Per-session burst state. Reset on session change.
  let currentSession = null;
  let burstKey = null;
  let burstCount = 0;
  let burstLastMs = 0;
  let burstSample = null; // click data for the burst — used only for labelling

  const finalizeBurst = (sessionId) => {
    if (burstKey == null) return;
    if (burstCount >= RAGE_MIN_CLICKS) {
      let stats = perElement.get(burstKey);
      if (!stats) {
        stats = {
          key: burstKey,
          element_id: burstSample?.element_id ?? burstKey,
          label: describeElement(burstSample ?? {}).label,
          sessions_with_rage: new Set(),
          total_rage_events: 0,
          total_rage_clicks: 0,
        };
        perElement.set(burstKey, stats);
      }
      stats.sessions_with_rage.add(sessionId);
      stats.total_rage_events += 1;
      stats.total_rage_clicks += burstCount;
      sessionsWithRage.add(sessionId);
      totalRageEvents += 1;
    }
    burstKey = null;
    burstCount = 0;
    burstLastMs = 0;
    burstSample = null;
  };

  for (const e of events) {
    const data = e.data ?? {};
    // Overlay instrumentation — clicks on the gaze dot or debug panels — is
    // never a rage signal about the page. Same guard the fixation insights
    // apply to element_id.
    if (isInstrumentElement(data.element_id)) continue;

    const key = keyFor(data);
    if (!key) continue;

    if (e.session_id !== currentSession) {
      // Any burst dangling from the previous session still counts — the user
      // may have simply stopped clicking after the last one.
      if (currentSession != null) finalizeBurst(currentSession);
      currentSession = e.session_id;
      burstKey = null;
      burstCount = 0;
      burstLastMs = 0;
      burstSample = null;
    }

    const tsMs = new Date(e.timestamp).getTime();

    if (
      burstKey === key &&
      burstCount > 0 &&
      tsMs - burstLastMs <= RAGE_MAX_GAP_MS
    ) {
      burstCount += 1;
      burstLastMs = tsMs;
    } else {
      // Element changed, or the gap exceeded the rage window — the previous
      // burst is over. Finalize it (records if ≥3 clicks) and start a fresh
      // one at this click.
      finalizeBurst(currentSession);
      burstKey = key;
      burstCount = 1;
      burstLastMs = tsMs;
      burstSample = data;
    }
  }

  // Session-final burst dangling at the very last event.
  if (currentSession != null) finalizeBurst(currentSession);

  const topElements = [...perElement.values()]
    .map((s) => ({
      key: s.key,
      element_id: s.element_id,
      label: s.label,
      sessions_with_rage: s.sessions_with_rage.size,
      pct_sessions: Math.round((s.sessions_with_rage.size / totalSessions) * 100),
      total_rage_events: s.total_rage_events,
      total_rage_clicks: s.total_rage_clicks,
      avg_burst_length: Math.round(s.total_rage_clicks / s.total_rage_events),
    }))
    .sort((a, b) => {
      if (b.sessions_with_rage !== a.sessions_with_rage)
        return b.sessions_with_rage - a.sessions_with_rage;
      return b.total_rage_events - a.total_rage_events;
    })
    .slice(0, TOP_ELEMENTS);

  return {
    total_sessions: totalSessions,
    total_rage_events: totalRageEvents,
    sessions_with_rage: sessionsWithRage.size,
    pct_sessions_with_rage: Math.round(
      (sessionsWithRage.size / totalSessions) * 100
    ),
    top_elements: topElements,
  };
}
