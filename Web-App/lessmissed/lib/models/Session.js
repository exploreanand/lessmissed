import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    session_id: { type: String, required: true, unique: true },
    consumer_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    task_id: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
    project_id: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    status: { type: String, enum: ["active", "completed", "abandoned"], default: "active" },
    pages_visited: [
      {
        path: String,
        entered_at: Date,
        left_at: Date,
      },
    ],
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

export default mongoose.models.Session || mongoose.model("Session", sessionSchema);
