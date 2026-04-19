import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Please define MONGODB_URI in .env.local");
}

// Cache the connection across hot-reloads in Next.js dev mode
let cached = global._mongoose;
if (!cached) {
  cached = global._mongoose = { conn: null, promise: null };
}

async function ensureTimeseriesCollection(db) {
  try {
    const colls = await db.listCollections({ name: "events" }).toArray();
    if (colls.length === 0) {
      await db.createCollection("events", {
        timeseries: {
          timeField: "timestamp",
          metaField: "metadata",
          granularity: "seconds",
        },
        // 90-day TTL — adjust via EVENTS_TTL_DAYS env var
        expireAfterSeconds: parseInt(process.env.EVENTS_TTL_DAYS ?? "90") * 86400,
      });
    }
  } catch (err) {
    // Collection already exists as timeseries — safe to ignore
    if (err?.codeName !== "NamespaceExists") throw err;
  }
}

export async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 5000,
      })
      .then(async (m) => {
        await ensureTimeseriesCollection(m.connection.db);
        return m;
      })
      .catch((error) => {
        cached.promise = null;

        if (error?.name === "MongooseServerSelectionError") {
          const message =
            "Could not reach MongoDB. If you are using MongoDB Atlas, make sure this machine's IP is allowed in Network Access, or switch MONGODB_URI to a local MongoDB instance for development.";
          throw new Error(message, { cause: error });
        }

        throw error;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
