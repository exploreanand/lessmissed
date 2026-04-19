import mongoose from "mongoose";

// Derived collection — computed from raw gaze events after session ends
const fixationSchema = new mongoose.Schema(
  {
    session_id: { type: String, required: true },
    project_id: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    page_url: { type: String, required: true },
    element_id: { type: String, default: null },
    element_xpath: { type: String, default: null },
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
