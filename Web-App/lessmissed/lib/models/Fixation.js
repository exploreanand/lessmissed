import mongoose from "mongoose";

// Derived collection — computed from raw gaze events after session ends
const fixationSchema = new mongoose.Schema(
  {
    session_id: { type: String, required: true },
    project_id: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    page_url: { type: String, required: true },
    element_id: { type: String, default: null },
    // Positionally unique key ("div>ul>li:nth-of-type(3)>p"). element_id alone
    // collapses every unclassed <p> on a page into one bucket.
    element_key: { type: String, default: null },
    element_xpath: { type: String, default: null },
    // Semantic fields carried over from the raw gaze events so insight
    // aggregations can render a human label without re-reading `events`.
    element_tag: { type: String, default: null },
    element_text: { type: String, default: null },
    element_alt: { type: String, default: null },
    element_aria: { type: String, default: null },
    element_src: { type: String, default: null },
    // Document-space bounding box of the element, when the extension sent one.
    element_rect: {
      x: { type: Number, default: null },
      y: { type: Number, default: null },
      w: { type: Number, default: null },
      h: { type: Number, default: null },
    },
    // Screenshot region this fixation was attributed to (see regionMap.js).
    region_id: { type: String, default: null },
    center_x: { type: Number, required: true },
    center_y: { type: Number, required: true },
    duration_ms: { type: Number, required: true },
    start_timestamp: { type: Date, required: true },
    end_timestamp: { type: Date, required: true },
    sample_count: { type: Number, default: 1 },
  },
  { collection: "fixations", timestamps: false }
);

fixationSchema.index({ session_id: 1, page_url: 1 });
fixationSchema.index({ session_id: 1, element_id: 1 });
fixationSchema.index({ project_id: 1, page_url: 1 });

export default mongoose.models.Fixation || mongoose.model("Fixation", fixationSchema);
