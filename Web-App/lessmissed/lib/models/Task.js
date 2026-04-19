import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    project_id: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    client_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    pages: [{ type: String }],
    estimated_minutes: { type: Number, default: 5 },
    coupon_id: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },
    schedule: {
      start_date: { type: Date, required: true },
      end_date: { type: Date, required: true },
      daily_cap: { type: Number, default: 20 },
      total_cap: { type: Number, default: 500 },
    },
    status: { type: String, enum: ["active", "paused", "expired", "completed"], default: "active" },
    stats: {
      total_started: { type: Number, default: 0 },
      total_completed: { type: Number, default: 0 },
      total_rewarded: { type: Number, default: 0 },
      avg_engagement_score: { type: Number, default: 0 },
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

taskSchema.index({ status: 1, "schedule.end_date": 1 });
taskSchema.index({ project_id: 1 });

export default mongoose.models.Task || mongoose.model("Task", taskSchema);
