import {
  buildClickTargets,
  buildSessionClicks,
  buildSessionVisits,
  isNearKey,
  loadGazeSequences,
} from "./gazeSequence.js";

// INS-GC05: Distraction Mapping — SRS §7.4: "User fixating near target, gaze
// pulled to different element, never returns to click target. Identifies
// attention cannibalization."
//
// Operationally, per session and per candidate target E:
//
//   * the session looked at E and never clicked it, and
//   * E's LAST visit in that session is followed by a visit to some other
//     element D.
//
// Then D is what took the attention for good, and (E -> D) is one defection.
// Taking E's *last* visit is what makes "never returns" true by construction:
// a session that left E, came back, then finally drifted to F is recorded as
// E -> F, the defection that stuck, not as the detour it recovered from.
//
// "Target" has to mean something, or every paragraph on the page counts as an
// abandoned CTA and the card is noise. A target here is an element that some
// session clicked AND that the DOM reported as interactive — see
// buildClickTargets, which explains why the interactivity test is not
// optional on real data.
// The blind spot is deliberate and worth stating: a CTA that nobody ever
// clicks is never a target, so the most catastrophically cannibalized button
// on a page can be invisible to this insight. `targets_considered` is returned
// so the card can say how wide the net was.
//
// Targets are matched on the gaze visit's own key. Clicks carry no region_id,
// so if a page ever does get a region map, region-keyed visits and
// element-keyed clicks live in different namespaces and such targets go
// unmatched — the same structural limit GC04 documents. No page currently has
// regions, so this is latent rather than live.
//
// Relative imports, no "@/" alias, so tests and scripts can load it.

// An element is ranked only when this many distinct sessions showed the
// behaviour. One visitor's wandering eye is not cannibalization.
const MIN_SESSIONS_FOR_TOP = 2;

// How far above a control a fixation may land and still count as a look at it.
// NOT from the spec, which says only "fixating near target" — see isNearKey for
// the measurement behind the number. 2 keeps it to the control's immediate
// container; raising it starts attributing a glance at a whole section to every
// button inside it.
const MAX_ANCESTOR_LEVELS = 2;

const TOP_ELEMENTS = 5;

// Accepts the Map from buildClickTargets, a bare Set of keys, or nothing.
function normalizeTargets(provided, clicksBySession) {
  if (provided instanceof Map) return provided;
  const keys =
    provided instanceof Set
      ? provided
      : new Set([...clicksBySession.values()].flatMap((set) => [...set]));
  return new Map([...keys].map((k) => [k, null]));
}

function emptyResult(totalSessions = 0, targetsConsidered = 0) {
  return {
    total_sessions: totalSessions,
    targets_considered: targetsConsidered,
    targets_reachable: 0,
    sessions_with_distraction: 0,
    pct_sessions_with_distraction: 0,
    total_defections: 0,
    abandoned_at_end: 0,
    top_distractors: [],
    top_targets: [],
  };
}

// Pure. `sequences` is Map<session_id, visit[]> from buildSessionVisits,
// `clicksBySession` is Map<session_id, Set<key>> from buildSessionClicks, and
// `targets` is Map<key, meta> from buildClickTargets.
export function computeDistractionStats({
  sequences = new Map(),
  clicksBySession = new Map(),
  targets: providedTargets,
  totalSessions = 0,
} = {}) {
  // "Is this element a target" is a property of the page, while "did THIS
  // session click it" is what makes a particular look an abandonment — so the
  // target set is a union across sessions, and the per-session click set is
  // consulted separately below.
  //
  // Callers normally pass the Map from buildClickTargets, which keeps dead
  // clicks out and carries each control's real name. A Set is accepted, and
  // without either, every clicked element becomes a target.
  const targets = normalizeTargets(providedTargets, clicksBySession);

  if (targets.size === 0 || sequences.size === 0) {
    return emptyResult(totalSessions, targets.size);
  }

  const distractors = new Map();
  const perTarget = new Map();
  const sessionsWithDistraction = new Set();
  const reachable = new Set();
  let totalDefections = 0;
  let abandonedAtEnd = 0;

  for (const [sessionId, visits] of sequences) {
    const clicked = clicksBySession.get(sessionId) ?? new Set();

    for (const [targetKey, meta] of targets) {
      // The LAST look at or near this target. Scanning from the end is what
      // makes "never returns" true by construction: a session that drifted
      // off, came back, then finally left is judged on the departure that
      // stuck, not on the detour it recovered from. And because this is the
      // last near-visit, whatever follows it is by definition not near the
      // target, so no extra check is needed below.
      let i = -1;
      for (let j = visits.length - 1; j >= 0; j--) {
        if (isNearKey(visits[j].key, targetKey, MAX_ANCESTOR_LEVELS)) {
          i = j;
          break;
        }
      }
      if (i === -1) continue; // this session never looked anywhere near it

      reachable.add(targetKey);
      if (clicked.has(targetKey)) continue; // they acted on it — nothing lost

      let t = perTarget.get(targetKey);
      if (!t) {
        // The control's name comes from the click that proved it clickable.
        // Without that metadata, the look itself can only name the target when
        // it landed on the target exactly — a container's label describes the
        // container, not the button inside it.
        const seenExactly = visits[i].key === targetKey;
        t = {
          key: targetKey,
          element_id: meta?.element_id ?? (seenExactly ? visits[i].element_id : targetKey),
          label: meta?.label ?? (seenExactly ? visits[i].label : targetKey),
          sessions: new Set(),
          distractors: new Map(),
        };
        perTarget.set(targetKey, t);
      }

      if (i === visits.length - 1) {
        // Still looking at it when the recording ended. Nothing pulled them
        // away, so no element is blamed.
        abandonedAtEnd += 1;
        continue;
      }

      const next = visits[i + 1];
      if (!next) continue;

      totalDefections += 1;
      sessionsWithDistraction.add(sessionId);
      t.sessions.add(sessionId);

      let viaForTarget = t.distractors.get(next.key);
      if (!viaForTarget) {
        viaForTarget = { key: next.key, label: next.label, sessions: new Set() };
        t.distractors.set(next.key, viaForTarget);
      }
      viaForTarget.sessions.add(sessionId);

      let dStats = distractors.get(next.key);
      if (!dStats) {
        dStats = {
          key: next.key,
          element_id: next.element_id,
          label: next.label,
          element_tag: next.element_tag,
          sessions: new Set(),
          targets: new Map(),
        };
        distractors.set(next.key, dStats);
      }
      dStats.sessions.add(sessionId);
      let victim = dStats.targets.get(targetKey);
      if (!victim) {
        victim = { key: targetKey, label: t.label, sessions: new Set() };
        dStats.targets.set(targetKey, victim);
      }
      victim.sessions.add(sessionId);
    }
  }

  const worst = (m) =>
    [...m.values()].sort((a, b) => b.sessions.size - a.sessions.size)[0] ?? null;

  const topDistractors = [...distractors.values()]
    .filter((x) => x.sessions.size >= MIN_SESSIONS_FOR_TOP)
    .sort((a, b) => {
      if (b.sessions.size !== a.sessions.size) return b.sessions.size - a.sessions.size;
      return b.targets.size - a.targets.size;
    })
    .slice(0, TOP_ELEMENTS)
    .map((x) => {
      const victim = worst(x.targets);
      return {
        key: x.key,
        element_id: x.element_id,
        label: x.label,
        element_tag: x.element_tag,
        sessions: x.sessions.size,
        pct_sessions: totalSessions > 0 ? Math.round((x.sessions.size / totalSessions) * 100) : 0,
        targets_affected: x.targets.size,
        top_target: victim
          ? { key: victim.key, label: victim.label, sessions: victim.sessions.size }
          : null,
      };
    });

  const topTargets = [...perTarget.values()]
    .filter((t) => t.sessions.size >= MIN_SESSIONS_FOR_TOP)
    .sort((a, b) => b.sessions.size - a.sessions.size)
    .slice(0, TOP_ELEMENTS)
    .map((t) => {
      const via = worst(t.distractors);
      return {
        key: t.key,
        element_id: t.element_id,
        label: t.label,
        sessions_abandoned: t.sessions.size,
        pct_sessions: totalSessions > 0 ? Math.round((t.sessions.size / totalSessions) * 100) : 0,
        top_distractor: via
          ? { key: via.key, label: via.label, sessions: via.sessions.size }
          : null,
      };
    });

  return {
    total_sessions: totalSessions,
    targets_considered: targets.size,
    // How many of those anyone actually looked at or near. Without this the
    // card cannot tell "nobody is distracted" from "gaze never reached a
    // control", which are opposite findings that both produce a zero.
    targets_reachable: reachable.size,
    sessions_with_distraction: sessionsWithDistraction.size,
    pct_sessions_with_distraction:
      totalSessions > 0 ? Math.round((sessionsWithDistraction.size / totalSessions) * 100) : 0,
    total_defections: totalDefections,
    abandoned_at_end: abandonedAtEnd,
    top_distractors: topDistractors,
    top_targets: topTargets,
  };
}

// Takes the lean project doc and page subdoc, like every sibling.
export async function computeDistraction(project, page) {
  const { totalSessions, sequences, clicksBySession, targets } = await loadGazeSequences(
    project,
    page
  );
  if (totalSessions === 0) return emptyResult(0, 0);
  return computeDistractionStats({ sequences, clicksBySession, targets, totalSessions });
}

export {
  MIN_SESSIONS_FOR_TOP,
  MAX_ANCESTOR_LEVELS,
  buildClickTargets,
  buildSessionVisits,
  buildSessionClicks,
};
