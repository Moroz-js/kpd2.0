import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type BodyLike = {
  transformToByteArray?: () => Promise<Uint8Array>;
};

function mode() {
  return process.env.SNAPSHOT_STORAGE_MODE ?? (process.env.NODE_ENV === "production" ? "s3" : "local");
}

function localRoot() {
  return path.resolve(process.env.SNAPSHOT_LOCAL_DIR ?? path.join(process.cwd(), ".snapshots"));
}

function safeLocalPath(key: string) {
  const root = localRoot();
  const target = path.resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Некорректный ключ snapshot object");
  }
  return target;
}

function s3Config() {
  const Bucket = process.env.SNAPSHOT_S3_BUCKET;
  if (!Bucket) throw new Error("Не задан SNAPSHOT_S3_BUCKET");
  const endpoint = process.env.SNAPSHOT_S3_ENDPOINT || undefined;
  if (process.env.NODE_ENV === "production" && endpoint?.startsWith("http://")) {
    throw new Error("Production snapshot storage требует TLS (https endpoint)");
  }
  return {
    Bucket,
    client: new S3Client({
      region: process.env.SNAPSHOT_S3_REGION ?? "us-east-1",
      endpoint,
      forcePathStyle: process.env.SNAPSHOT_S3_FORCE_PATH_STYLE === "true",
    }),
  };
}

export async function readSnapshotObject(key: string): Promise<Buffer> {
  if (mode() === "local") {
    return fs.readFile(safeLocalPath(key));
  }

  const { Bucket, client } = s3Config();
  const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
  const body = response.Body as BodyLike | undefined;
  if (!body?.transformToByteArray) throw new Error(`Пустой snapshot object: ${key}`);
  return Buffer.from(await body.transformToByteArray());
}

export async function writeSnapshotObject(
  key: string,
  body: Buffer,
  contentType: string,
  contentEncoding?: string
): Promise<void> {
  if (mode() === "local") {
    const target = safeLocalPath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body, { flag: "wx" });
    return;
  }

  const { Bucket, client } = s3Config();
  await client.send(
    new PutObjectCommand({
      Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentEncoding: contentEncoding,
      ServerSideEncryption: "AES256",
    })
  );
}

export function assertSnapshotStorageConfiguration() {
  const storageMode = mode();
  if (!["local", "s3"].includes(storageMode)) {
    throw new Error("SNAPSHOT_STORAGE_MODE должен быть local или s3");
  }
  if (storageMode === "s3") {
    s3Config();
    if (!process.env.SNAPSHOT_S3_ENDPOINT && !process.env.AWS_REGION && !process.env.SNAPSHOT_S3_REGION) {
      throw new Error("Для S3 нужен SNAPSHOT_S3_REGION или AWS_REGION");
    }
  }
}
