// Next.js runs this once per server process, at boot rather than on first
// request, so an idle task still sweeps.
//
// It is what makes session finalization independent of the capture worker: that
// worker is a single Fargate Spot task, and while it was the only process
// running the sweep, a reclaim meant no session was ever finalized and no
// fixations were ever derived. See lib/sessions/sweepLoop.js.
export async function register() {
  // register() also runs for the edge runtime, which has no Mongo driver and
  // no long-lived process to hold a timer.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.WEB_SESSION_SWEEP === "0") return;

  const { startSessionSweepLoop } = await import("./lib/sessions/sweepLoop.js");
  startSessionSweepLoop();
}
