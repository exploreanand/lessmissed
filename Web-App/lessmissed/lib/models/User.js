import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["client", "consumer"], required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password_hash: { type: String, default: null },
    oauth_provider: { type: String, enum: ["google", null], default: null },
    oauth_id: { type: String, default: null },
    name: { type: String, required: true },
    last_login: { type: Date, default: null },
    // Client-only
    plan: { type: String, enum: ["starter", "growth", "enterprise"], default: "starter" },
    // Consumer-only
    trust_score: { type: Number, min: 0, max: 100, default: 100 },
    total_rewards_earned: { type: Number, default: 0 },
    // Set on consumers created by the tag flow: no login, no email verified,
    // identity is a first-party visitor_id cookie set on the brand's domain.
    // Distinguished from full consumers so rewards and account UI never treat
    // them as real users, and so a future upgrade path (visitor claims their
    // sessions when they sign up) can find them.
    anonymous: { type: Boolean, default: false },
    settings: {
      notifications: { type: Boolean, default: true },
      email_digest: { type: String, enum: ["weekly", "daily", "none"], default: "weekly" },
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export default mongoose.models.User || mongoose.model("User", userSchema);
