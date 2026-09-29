import { connectDB } from "@/lib/mongoose";
import User from "@/lib/models/User";

// Every Session, Event and Fixation carries a consumer_id ObjectId ref to
// User. The tag surface identifies consumers by a first-party visitor_id
// cookie (UUID) — there is no login step. To keep the entire downstream
// analytics pipeline unchanged, we mint one User row per visitor_id, flagged
// `anonymous: true`, and hand its ObjectId back for the request to attach to
// the session.
//
// This creates one User row per visitor per brand — visitor_ids are scoped to
// the brand's cookie domain, and the same person visiting two different
// brand sites is two visitor_ids by design (no cross-site linking without
// explicit account handoff). If a future account-linking flow is added, it
// can merge these anonymous users into a signed-up one by rewriting the
// consumer_id on their sessions.

const EMAIL_PREFIX = "anon:";

function anonEmail(visitorId) {
  // Not a valid email — no @ — which prevents any code path that treats
  // User.email as a real address from touching these rows. Prefix makes them
  // greppable and eyeball-recognisable in the users collection.
  return `${EMAIL_PREFIX}${visitorId.toLowerCase()}`;
}

export function isValidVisitorId(id) {
  // A UUIDv4 the head script generates. Constrained to hex+dashes to avoid
  // arbitrary strings turning into User.email injections.
  return (
    typeof id === "string" &&
    id.length >= 8 &&
    id.length <= 128 &&
    /^[a-zA-Z0-9-]+$/.test(id)
  );
}

// Upsert the anonymous User row for a visitor_id and return its ObjectId.
// findOneAndUpdate with upsert:true is the tight version — we do not need to
// know whether it was created or found, only the resulting _id.
export async function getOrCreateAnonymousConsumer(visitorId) {
  if (!isValidVisitorId(visitorId)) return null;
  await connectDB();

  const email = anonEmail(visitorId);
  const user = await User.findOneAndUpdate(
    { email },
    {
      $setOnInsert: {
        type: "consumer",
        anonymous: true,
        email,
        name: "Anonymous visitor",
        // password_hash stays null: this account cannot log in, by design.
      },
      $set: {
        last_login: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return user._id;
}
