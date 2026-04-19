import mongoose from "mongoose";

const consumerRewardSchema = new mongoose.Schema(
  {
    consumer_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    coupon_id: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", required: true },
    task_id: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true },
    session_id: { type: String, required: true },
    code: { type: String, required: true },
    brand_name: { type: String, required: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ["earned", "redeemed", "expired"], default: "earned" },
    earned_at: { type: Date, default: Date.now },
    redeemed_at: { type: Date, default: null },
    expires_at: { type: Date, required: true },
  },
  { timestamps: false }
);

consumerRewardSchema.index({ consumer_id: 1, status: 1 });

export default mongoose.models.ConsumerReward ||
  mongoose.model("ConsumerReward", consumerRewardSchema);
