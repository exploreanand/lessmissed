import mongoose from "mongoose";

// A named area of the page screenshot. Attention is attributed to regions by
// fixation coordinates rather than by DOM selector, because one selector (e.g.
// "img.image-image") can cover the hero banner, a promo strip and every
// category tile at once. Rebuilt whenever the page screenshot changes.
const regionSchema = new mongoose.Schema(
  {
    region_id: { type: String, required: true },
    label: { type: String, required: true },
    category: { type: String, default: "content" },
    // Document-space box, aligned to the stitched screenshot (no scaling).
    bbox: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
      w: { type: Number, required: true },
      h: { type: Number, required: true },
    },
    // Which rung of the labelling ladder produced this name.
    source: {
      type: String,
      enum: ["aria", "alt", "title", "text", "ocr", "heading", "src", "vlm", "selector"],
      default: "selector",
    },
    confidence: { type: Number, default: 0 },
    labeled_at: { type: Date, default: Date.now },
    // Ties the label to the screenshot it was derived from; a re-shot page
    // invalidates the map.
    screenshot_captured_at: { type: Date, default: null },
  },
  { _id: false }
);

const pageSchema = new mongoose.Schema(
  {
    path: { type: String, required: true },
    slug: { type: String, required: true },
    regions: { type: [regionSchema], default: [] },
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
    screenshot_header_url: { type: String, default: null },
    screenshot_header_height: { type: Number, default: null },
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