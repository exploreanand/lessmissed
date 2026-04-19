import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    client_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    project_id: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    type: {
      type: String,
      enum: ["percentage", "fixed", "free_delivery", "custom"],
      required: true,
    },
    value: { type: Number, default: null },
    currency: { type: String, enum: ["INR", "USD", "EUR"], default: "INR" },
    description: { type: String, default: "" },
    code: { type: String, required: true, uppercase: true },
    rules: {
      max_redemptions: { type: Number, default: 100 },
      expiry_date: { type: Date, required: true },
      min_order_value: { type: Number, default: 0 },
      one_per_user: { type: Boolean, default: true },
    },
    stats: {
      total_earned: { type: Number, default: 0 },
      total_redeemed: { type: Number, default: 0 },
      total_expired: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ["active", "paused", "expired", "redeemed_out"],
      default: "active",
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export default mongoose.models.Coupon || mongoose.model("Coupon", couponSchema);
