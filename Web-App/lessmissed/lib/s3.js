import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

// No explicit credentials: let the AWS SDK's default provider chain resolve
// them. Locally that picks up AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from
// .env.local; in production it uses whatever the task is given — the ECS task
// role, or (because the prod screenshots bucket lives in a separate AWS
// account) our own IAM keys for that account passed in as env. Either way the
// code stays the same.
const s3 = new S3Client({ region: process.env.AWS_REGION });

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