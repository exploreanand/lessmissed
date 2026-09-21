import mongoose from "mongoose";

// One rendered version of one target page.
//
// The screenshot is not decoration: it is the coordinate reference frame every
// insight is drawn in. regionMap.js states the contract — "fixation
// center_x/center_y are absolute document pixels that align to the screenshot
// with no scaling" — so the dimensions a capture was taken at are part of the
// data, not metadata about it. They live here, on the version, rather than on
// the page, because a page re-shot at a different height must not silently
// re-point every existing region box at a picture it was never measured against.
//
// Captures are immutable. A new render writes a new document and a new S3 key;
// nothing is ever overwritten. That is what makes old-vs-new comparison, region
// staleness and rollback possible at all — the previous design used one fixed
// key per page, so every capture destroyed the evidence needed to tell whether
// it should have been taken.

const diffSchema = new mongoose.Schema(
  {
    // Share of non-masked pixels that changed against previous_capture_id.
    // Null on a baseline, which has nothing to compare to.
    changed_pct: { type: Number, default: null },
    // Bounding boxes of the changed areas, in the same document-pixel space as
    // regionSchema.bbox, so the dashboard can outline *what* moved.
    changed_boxes: {
      type: [
        {
          _id: false,
          x: Number,
          y: Number,
          w: Number,
          h: Number,
        },
      ],
      default: [],
    },
    // Set when the two captures had different document heights — a pure pixel
    // diff is meaningless across a reflow, so the comparison falls back to the
    // overlapping region and this flag explains the lower confidence.
    height_changed: { type: Boolean, default: false },
  },
  { _id: false }
);

const pageCaptureSchema = new mongoose.Schema(
  {
    project_id: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    // The _id of the page subdocument inside Project.pages. Pages are embedded,
    // so there is no collection to ref — this is a manual join key. Slug is not
    // usable as the link: it is derived from the path template and changes if
    // the admin edits the page.
    page_id: { type: mongoose.Schema.Types.ObjectId, required: true },

    // The URL actually rendered. For a wildcard page ("/products/:id") this is
    // the admin-chosen representative URL, and it is worth recording per-version
    // because that choice can change between captures.
    capture_url: { type: String, required: true },

    // Which device profile this version represents. Sessions are bucketed to the
    // nearest breakpoint and drawn against the matching capture; a session
    // recorded at 1280 CSS px must not be plotted on a 390-wide render.
    breakpoint: { type: String, enum: ["desktop", "mobile"], default: "desktop" },

    // ---- Geometry. The coordinate contract. --------------------------------
    // CSS pixels: the layout width the page was rendered at.
    viewport_width: { type: Number, default: null },
    viewport_height: { type: Number, default: null },
    // Rendered at 2x for OCR legibility, then downscaled on write so the stored
    // image stays 1:1 with document CSS pixels. Kept for provenance.
    device_scale_factor: { type: Number, default: 1 },
    // CSS pixels: the full scrollable height of the rendered document — the
    // honest number, even when more than we captured.
    document_height: { type: Number, default: null },
    // CSS pixels: the height the stored image actually spans. Equal to
    // document_height unless the page exceeded the capture cap.
    //
    // These are two different numbers and conflating them is precisely the bug
    // the old extension shipped: it clamped at 15000 px and then reported the
    // clamped value *as* the document height, so the viewer scaled overlays by
    // a height the image did not span and every fixation below the fold landed
    // in the wrong place. Overlays must always be scaled by captured_height.
    captured_height: { type: Number, default: null },
    truncated: { type: Boolean, default: false },
    // Actual decoded pixel dimensions of the stored image, read back from the
    // encoded bytes rather than trusted from the renderer. image_width must
    // equal viewport_width and image_height must equal document_height; a
    // capture that fails that check is rejected before it can be made current.
    image_width: { type: Number, default: null },
    image_height: { type: Number, default: null },

    // ---- Element inventory -------------------------------------------------
    // Every component a visitor could look at as one thing, measured in this
    // render: visible, at least 24 px a side, and a control, media, own text or
    // a painted background, leaf-most only. Boxes are document CSS pixels —
    // the same frame as fixation centres and as this image.
    //
    // This is what "missed elements" (INS-G03) is counted against. It did not
    // exist before, so missed elements had no denominator and was never
    // computed — the dashboard showed a stored 0. Null means the inventory was
    // not taken (an older capture, or enumeration ran out of time), and the UI
    // shows "unknown" rather than 0.
    elements: {
      type: [
        {
          _id: false,
          tag: String,
          label: String,
          bbox: { x: Number, y: Number, w: Number, h: Number },
        },
      ],
      default: null,
    },

    // ---- Storage -----------------------------------------------------------
    s3_key: { type: String, default: null },
    thumb_key: { type: String, default: null },
    bytes: { type: Number, default: 0 },

    // ---- Change detection --------------------------------------------------
    // Tier 1: hash of the page's tag skeleton plus visible text, from a plain
    // HTTP fetch with no browser. Cheap enough to run daily per page.
    content_hash: { type: String, default: null },
    // Tier 2: perceptual hash of the rendered image, robust to re-encoding and
    // sub-pixel noise in a way a byte hash is not.
    perceptual_hash: { type: String, default: null },
    diff_vs_previous: { type: diffSchema, default: () => ({}) },
    previous_capture_id: { type: mongoose.Schema.Types.ObjectId, ref: "PageCapture", default: null },

    // ---- Lifecycle ---------------------------------------------------------
    // "discarded_no_change" is a real outcome, not a failure: the page was
    // rendered, compared, found visually identical and the bytes thrown away.
    // Recording it is what stops the scheduler re-rendering the same unchanged
    // page every day, and it is why capture volume tracks change rather than
    // traffic.
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "discarded_no_change"],
      default: "pending",
    },
    reason: {
      type: String,
      enum: ["baseline", "manual", "drift", "scheduled"],
      required: true,
    },
    error: { type: String, default: null },
    // Wall-clock render time, for cost tracking and for spotting sites whose
    // capture is degrading before it starts failing outright.
    duration_ms: { type: Number, default: 0 },
    captured_at: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// "The current and previous versions of this page at this breakpoint" — the
// query behind the viewer, the version history strip and every diff.
pageCaptureSchema.index({ page_id: 1, breakpoint: 1, captured_at: -1 });
pageCaptureSchema.index({ project_id: 1, captured_at: -1 });

export default mongoose.models.PageCapture ||
  mongoose.model("PageCapture", pageCaptureSchema);
