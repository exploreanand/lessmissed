import mongoose from "mongoose";

// Time series collection — raw events from the extension
// MongoDB time series: timeField=timestamp, metaField=metadata
const eventSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true },
    session_id: { type: String, required: true },
    type: {
      type: String,
      enum: ["gaze", "click", "scroll", "cursor", "visibility", "page_change"],
      required: true,
    },
    page_url: { type: String, required: true },
    // The page this URL belongs to, from lib/pathTemplate.js — "/products/8812"
    // and "/products/9143" both store "/products/:id". page_url keeps the raw
    // path; every insight query groups on the template, because a store with
    // 5000 products otherwise yields 5000 single-session pages.
    page_template: { type: String, default: null },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    metadata: {
      project_id: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
      consumer_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
  },
  {
    // Tell Mongoose to use the "events" collection (time series configured via seed script)
    collection: "events",
    // Disable automatic _id so MongoDB time series can manage its own id
    _id: false,
    timestamps: false,
  }
);

eventSchema.index({ session_id: 1, type: 1 });
eventSchema.index({ "metadata.project_id": 1, timestamp: -1 });
eventSchema.index({ "metadata.project_id": 1, page_template: 1, type: 1 });

export default mongoose.models.Event || mongoose.model("Event", eventSchema);
