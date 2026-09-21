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
    // The same tie, but to a specific immutable capture version rather than a
    // timestamp. A timestamp could only ever say "this label is older than the
    // picture"; this says which picture it was measured on, so a stale map is
    // detectable by identity instead of by clock skew.
    capture_id: { type: mongoose.Schema.Types.ObjectId, ref: "PageCapture", default: null },
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
    // Auto-registered by the extension on first visit rather than typed into the
    // setup wizard. Clients see these flagged so they can tell what they asked
    // for apart from what their site turned out to contain.
    discovered: { type: Boolean, default: false },
    first_seen_at: { type: Date, default: null },
    last_seen_at: { type: Date, default: null },

    // ---- Target-page configuration -----------------------------------------
    // Explicitly configured by an admin, as opposed to merely discovered. Only
    // target pages are ever captured. This is the whole point of the redesign:
    // the system no longer photographs whatever a consumer happened to browse,
    // it photographs the short list of pages a brand actually reasons about.
    target: { type: Boolean, default: false },
    // Discovery still runs and still attributes gaze, but a discovered page is
    // a suggestion until someone accepts it. "ignored" is remembered so the
    // same URL does not reappear in the inbox every week.
    approval_status: {
      type: String,
      enum: ["pending", "approved", "ignored"],
      default: "pending",
    },
    // The concrete URL the capture worker navigates to.
    //
    // Required for a target page and not derivable from `path`: `path` is a
    // template, and "/products/:id" is not navigable. Project.domain is only a
    // bare hostname (the setup wizard strips scheme and any path), so there is
    // no origin to reassemble one from either. For a wildcard page this is the
    // admin's chosen representative URL, seeded from sample_urls.
    capture_url: { type: String, default: null },
    // CSS selectors painted over before diffing — timestamps, cart counts,
    // "Hi, Dana", rotating hero slots. Masked area is excluded from the change
    // comparison, so genuinely dynamic content stops producing daily false
    // positives without suppressing real changes around it.
    mask_selectors: { type: [String], default: [] },
    // Selectors clicked before capture to clear consent walls and interstitials
    // that would otherwise be photographed instead of the page.
    dismiss_selectors: { type: [String], default: [] },
    capture_breakpoints: {
      type: [String],
      enum: ["desktop", "mobile"],
      default: ["desktop"],
    },
    // Current capture per breakpoint, as { desktop: ObjectId, mobile: ObjectId }.
    // Mixed rather than a sub-schema so a new breakpoint does not need a
    // migration to start being stored.
    current_capture: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    // ---- Change detection bookkeeping --------------------------------------
    // False for pages whose served HTML is a shell (client-rendered SPAs),
    // where a structural hash of the raw response says nothing about what a
    // user sees. Those pages skip tier 1 and go on a slower browser-based check.
    content_hash_reliable: { type: Boolean, default: true },
    last_checked_at: { type: Date, default: null },
    availability_status: {
      type: String,
      enum: ["ok", "redirected", "not_found", "unreachable"],
      default: "ok",
    },
    availability_error: { type: String, default: null },
    // A few real URLs behind a template, so "/products/:id" is recognisable in
    // the dashboard. Capped at SAMPLE_URL_LIMIT by the visits endpoint.
    sample_urls: { type: [String], default: [] },
    // Drives the status chip in the dashboard. "queued" and "failed" were dead
    // enum values until now — the old client-side capture path only ever wrote
    // "captured", so a page whose capture never happened was indistinguishable
    // from one that had never been asked for. The job queue writes all four.
    screenshot_status: {
      type: String,
      enum: ["none", "queued", "capturing", "captured", "failed"],
      default: "none",
    },
    // Cached insight metrics (updated by aggregation jobs)
    avg_fixation_per_session: { type: Number, default: 0 },
    missed_elements_pct: { type: Number, default: 0 },
    health_score: { type: Number, default: 0 },

    // ---- DEPRECATED: flat screenshot fields --------------------------------
    // Superseded by the PageCapture collection, which versions these per render
    // instead of overwriting them. Still written by the capture worker for one
    // release so relabel-pages.mjs and HeatmapViewer keep working unchanged
    // during the migration; removed once both read `current_capture`.
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