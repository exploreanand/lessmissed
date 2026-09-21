import mongoose from "mongoose";

// The durable work queue for page captures.
//
// Nothing like this existed before. Task.js is a consumer-facing marketing
// record ("visit these pages, earn a coupon") with no payload, no attempts and
// nothing to lease; the only queue in the old design was an in-memory array
// inside an MV3 service worker, which Chrome is free to terminate mid-drain.
// That is why a failed capture simply vanished.
//
// Deliberately MongoDB rather than Redis/BullMQ: the volume is tens to hundreds
// of jobs a day, the app already owns a Mongo connection, and one atomic
// findOneAndUpdate gives correct leasing without a second piece of
// infrastructure to run, secure and pay for.
//
// Leasing, not deleting: a worker claims a job by moving it to "leased" with an
// expiry. If the worker dies, the lease lapses and a reaper returns the job to
// "queued". A job is therefore never lost by a crash, only ever retried — which
// is the property the old design lacked entirely.

const captureJobSchema = new mongoose.Schema(
  {
    project_id: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    page_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    breakpoint: { type: String, enum: ["desktop", "mobile"], default: "desktop" },

    reason: {
      type: String,
      enum: ["baseline", "manual", "drift", "scheduled"],
      required: true,
    },

    status: {
      type: String,
      enum: ["queued", "leased", "succeeded", "failed", "dead"],
      default: "queued",
      index: true,
    },

    // Higher runs first. A human waiting on a thumbnail outranks a nightly
    // drift check, so "manual" and "baseline" are enqueued above "scheduled".
    priority: { type: Number, default: 0 },

    // Backoff and scheduling in one field: a retry is just a job that is not
    // eligible yet. The lease query filters on run_after <= now.
    run_after: { type: Date, default: Date.now },

    leased_at: { type: Date, default: null },
    // A worker must finish, or heartbeat, before this. Past it, the reaper
    // assumes the worker is gone.
    lease_expires_at: { type: Date, default: null },
    worker_id: { type: String, default: null },

    attempts: { type: Number, default: 0 },
    max_attempts: { type: Number, default: 3 },
    last_error: { type: String, default: null },

    // Set on success so the job record points at what it produced.
    capture_id: { type: mongoose.Schema.Types.ObjectId, ref: "PageCapture", default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// The lease query: eligible work, best job first. Compound so the sort is
// served by the index rather than an in-memory sort of the whole backlog.
captureJobSchema.index({ status: 1, run_after: 1, priority: -1 });
// The reaper's query: leases that have lapsed.
captureJobSchema.index({ status: 1, lease_expires_at: 1 });
// "Is there already work queued for this page?" — the dedup check that stops a
// drift detection and an admin click producing two renders of the same page.
captureJobSchema.index({ page_id: 1, breakpoint: 1, status: 1 });

export default mongoose.models.CaptureJob ||
  mongoose.model("CaptureJob", captureJobSchema);
