import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";

// The production screenshots bucket lives in a SEPARATE AWS account. When
// AWS_S3_ROLE_ARN is set, assume that account's cross-account role — using
// whatever the default provider chain gives us (the ECS task role in prod) as
// the source credentials. When it's unset (local dev), fall back to the
// default chain, which reads AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from
// .env.local. The rest of this module is identical either way.
function makeS3Client() {
  const region = process.env.AWS_REGION;
  const roleArn = process.env.AWS_S3_ROLE_ARN;
  if (roleArn) {
    return new S3Client({
      region,
      credentials: fromTemporaryCredentials({
        params: { RoleArn: roleArn, RoleSessionName: "lessmissed-web" },
        clientConfig: { region },
      }),
    });
  }
  return new S3Client({ region });
}

const s3 = makeS3Client();

export async function uploadToS3(buffer, key, contentType = "image/jpeg") {
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return `${process.env.AWS_S3_BASE_URL}/${key}`;
}

export async function deleteProjectFromS3(projectId) {
  const prefix = `screenshots/${projectId}/`;
  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: process.env.AWS_S3_BUCKET, Prefix: prefix })
  );
  if (!listed.Contents?.length) return;
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Delete: { Objects: listed.Contents.map((o) => ({ Key: o.Key })) },
    })
  );
}