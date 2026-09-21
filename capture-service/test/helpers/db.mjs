// Per-file test databases.
//
// node --test runs test *files* in parallel. Both the queue and target-page
// suites clear the capturejobs collection between cases, so sharing one
// database makes them delete each other's fixtures mid-run — which shows up as
// a handful of unrelated assertions failing only when the whole suite runs.
//
// Giving each file its own database keeps them parallel and independent.

import mongoose from "mongoose";

/**
 * Connect to a database named for this test file.
 *
 * @param {string} suite short name, e.g. "queue"
 * @returns {Promise<boolean>} false when no test database is configured, so the
 *   caller can skip rather than fail — the suite must stay runnable offline.
 */
export async function connectTestDb(suite) {
  const base = process.env.CAPTURE_TEST_MONGO_URI;
  if (!base) return false;

  const uri = new URL(base);
  // Replace the path with a per-suite name, preserving any query options.
  uri.pathname = `/lm_test_${suite}`;

  try {
    await mongoose.connect(uri.toString(), { serverSelectionTimeoutMS: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Drop everything this suite created and disconnect. */
export async function dropTestDb() {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}
