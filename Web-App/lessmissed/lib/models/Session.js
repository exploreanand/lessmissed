import mongoose from "mongoose";

// One page the consumer landed on during the session. Sessions span a whole site
// now, so this is an ordered journey rather than the single entry-page record it
// used to hold — it backs the flow graph, the per-page session scoping and the
// session journey view. Counters are filled in server-side at finalize time from
// the raw events, so they always agree with the fixation aggregations.
const pageVisitSchema = new mongoose.Schema(
  {
    path: { type: String, required: true },
    // Page identity — see Event.page_template. `path` is the raw URL path.
    template: { type: String, default: null },
    entered_at: { type: Date, default: null },
    left_at: { type: Date, default: null },
    dwell_ms: { type: Number, default: 0 },
    fixation_count: { type: Number, default: 0 },
    click_count: { type: Number, default: 0 },
    max_scroll_depth_percent: { type: Number, default: 0 },
    // Which page they arrived from — the edge in the flow graph.
    referrer_template: { type: String, default: null },
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    session_id: { type: String, required: true, unique: true },
    consumer_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    task_id: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
    project_id: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    status: { type: String, enum: ["active", "completed", "abandoned"], default: "active" },

    // The consumer's own layout frame, reported once at session start.
    //
    // Every gaze and click is stored as viewportXY + scrollXY in *these* CSS
    // pixels, and then drawn on a screenshot captured at some other width. Until
    // now nothing recorded what that width was, so the resulting misalignment
    // was not merely uncorrected, it was undetectable — there was no way to ask
    // after the fact whether a heatmap could be trusted. Recording it makes the
    // error measurable, and bucketing on it makes the error go away.
    viewport_width: { type: Number, default: null },
    viewport_height: { type: Number, default: null },
    dpr: { type: Number, default: null },
    // Nearest canonical capture width, assigned at session start from
    // viewport_width. Sessions are drawn against the capture for their own
    // bucket rather than against one arbitrary desktop render.
    breakpoint: { type: String, enum: ["desktop", "mobile"], default: "desktop" },

    pages_visited: { type: [pageVisitSchema], default: [] },
    // Denormalised first and last page of the journey, so the flow graph can
    // count entries and exits without unwinding every session's visit array.
    entry_template: { type: String, default: null },
    exit_template: { type: String, default: null },
    pages_required: [{ type: String }],
    task_completed: { type: Boolean, default: false },
    engagement_score: { type: Number, min: 0, max: 100, default: 0 },
    engagement_breakdown: {
      fixation_diversity: { type: Number, default: 0 },
      saccade_naturalness: { type: Number, default: 0 },
      scroll_gaze_correlation: { type: Number, default: 0 },
      page_coverage: { type: Number, default: 0 },
      interaction_signals: { type: Number, default: 0 },
    },
    data_accepted: { type: Boolean, default: false },
    reward_given: { type: Boolean, default: false },
    duration_ms: { type: Number, default: 0 },
    active_time_ms: { type: Number, default: 0 },
    started_at: { type: Date, required: true },
    ended_at: { type: Date, default: null },
    summary: {
      total_fixations: { type: Number, default: 0 },
      total_clicks: { type: Number, default: 0 },
      total_scroll_events: { type: Number, default: 0 },
      max_scroll_depth_percent: { type: Number, default: 0 },
      rage_clicks: { type: Number, default: 0 },
      dead_clicks: { type: Number, default: 0 },
      scroll_backs: { type: Number, default: 0 },
      confusion_score: { type: Number, default: 0 },
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

sessionSchema.index({ project_id: 1, status: 1 });
sessionSchema.index({ consumer_id: 1, status: 1 });
sessionSchema.index({ task_id: 1 });
// Per-page session scoping — "which sessions touched this page" is now a real
// question with a real answer, asked by every page-detail query.
sessionSchema.index({ project_id: 1, "pages_visited.template": 1 });

export default mongoose.models.Session || mongoose.model("Session", sessionSchema);
