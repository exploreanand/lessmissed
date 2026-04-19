import mongoose from "mongoose";

const pageSchema = new mongoose.Schema(
  {
    path: { type: String, required: true },
    slug: { type: String, required: true },
    type: { type: String, enum: ["exact", "wildcard"], default: "exact" },
    status: { type: String, enum: ["active", "paused", "awaiting_data"], default: "active" },
    added_at: { type: Date, default: Date.now },
    session_count: { type: Number, default: 0 },
    last_session_at: { type: Date, default: null },
    // Cached insight metrics (updated by aggregation jobs)
    avg_fixation_per_session: { type: Number, default: 0 },
    missed_elements_pct: { type: Number, default: 0 },
    health_score: { type: Number, default: 0 },
    // Screenshot captured by extension
    screenshot_url: { type: String, default: null },
    screenshot_viewport_width: { type: Number, default: null },
    screenshot_viewport_height: { type: Number, default: null },
    screenshot_document_height: { type: Number, default: null },
    screenshot_captured_at: { type: Date, default: null },
  },
  { _id: true }
);

const projectSchema = new mongoose.Schema(
  {
    client_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    domain: { type: String, required: true },
    pages: [pageSchema],
    health_score: { type: Number, default: 0 },
    total_sessions: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "paused", "archived"], default: "active" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export default mongoose.models.Project || mongoose.model("Project", projectSchema);
