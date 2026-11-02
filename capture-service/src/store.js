// S3 for capture artifacts.
//
// The one rule that makes everything else work: keys are unique per capture and
// never reused. The old design wrote every capture of a page to
// "screenshots/{projectId}/{slug}.jpg", so each render destroyed its
// predecessor — which is why the system could not diff old against new, could
// not roll back a bad capture, and served stale images from CDN caches forever
// behind a URL that never changed.

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { config } from "./config.js";

// The production screenshots bucket lives in a SEPARATE AWS account. When
// AWS_S3_ROLE_ARN is set, assume that account's cross-account role (sourced
// from the ECS task role via the default chain); otherwise fall back to the
// default chain for local dev. Mirrors Web-App/lessmissed/lib/s3.js.
function makeS3Client() {
  const region = config.s3.region;
  const roleArn = process.env.AWS_S3_ROLE_ARN;
  if (roleArn) {
    return new S3Client({
      region,
      credentials: fromTemporaryCredentials({
        params: { RoleArn: roleArn, RoleSessionName: "lessmissed-capture" },
        clientConfig: { region },
      }),
    });
  }
  return new S3Client({ region });
}

const s3 = makeS3Client();

/** screenshots/{projectId}/{pageId}/{captureId}[.thumb].jpg */
export function captureKey(projectId, pageId, captureId, variant = "full") {
  const suffix = variant === "thumb" ? ".thumb" : "";
  return `screenshots/${projectId}/${pageId}/${captureId}${suffix}.jpg`;
}

export async function putCapture({ projectId, pageId, captureId, buffer, thumbnail }) {
  const key = captureKey(projectId, pageId, captureId, "full");
  const thumbKey = captureKey(projectId, pageId, captureId, "thumb");

  await Promise.all([
    s3.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: buffer,
        ContentType: "image/jpeg",
        // Immutable by construction, so it can be cached hard. A new capture is
        // a new key, which is exactly what makes this safe to say.
        CacheControl: "public, max-age=31536000, immutable",
      })
    ),
    s3.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: thumbKey,
        Body: thumbnail,
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=31536000, immutable",
      })
    ),
  ]);

  return { key, thumbKey, bytes: buffer.length };
}

/** Fetch a stored capture back, to diff a new render against it. */
export async function getCapture(key) {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: config.s3.bucket, Key: key })
  );
  return Buffer.from(await result.Body.transformToByteArray());
}

/**
 * Delete specific objects.
 *
 * Paginated in batches of 1000, which is the API's hard limit — the existing
 * `deleteProjectFromS3` in the web app passes an unbounded list straight to
 * DeleteObjects and silently leaks everything past the first thousand.
 */
export async function deleteKeys(keys) {
  const pending = keys.filter(Boolean);
  for (let i = 0; i < pending.length; i += 1000) {
    const batch = pending.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: config.s3.bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      })
    );
  }
  return pending.length;
}

/** Every key under a prefix, following continuation tokens to the end. */
export async function listPrefix(prefix) {
  const keys = [];
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.s3.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    for (const object of page.Contents ?? []) keys.push(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
