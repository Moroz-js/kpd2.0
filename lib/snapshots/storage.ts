import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";

type BodyLike = {
  transformToByteArray?: () => Promise<Uint8Array>;
};

export type SnapshotStorageMode = "db" | "local" | "s3";

function mode(): SnapshotStorageMode {
  const value = process.env.SNAPSHOT_STORAGE_MODE ?? "db";
  if (value === "db" || value === "local" || value === "s3") return value;
  throw new Error("SNAPSHOT_STORAGE_MODE должен быть db, local или s3");
}

function localRoot() {
  return path.resolve(process.env.SNAPSHOT_LOCAL_DIR ?? path.join(process.cwd(), "snapshots"));
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
  const storageMode = mode();
  if (storageMode === "db") {
    const row = await prisma.snapshotObject.findUnique({ where: { key } });
    if (!row) throw new Error(`Пустой snapshot object: ${key}`);
    return Buffer.from(row.body);
  }

  if (storageMode === "local") {
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
  const storageMode = mode();
  if (storageMode === "db") {
    await prisma.snapshotObject.create({
      data: {
        key,
        body,
        contentType,
        contentEncoding: contentEncoding ?? null,
        byteSize: body.byteLength,
      },
    });
    return;
  }

  if (storageMode === "local") {
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

export async function deleteSnapshotPrefix(prefix: string): Promise<void> {
  const storageMode = mode();
  const normalized = prefix.replace(/\/+$/, "");

  if (storageMode === "db") {
    await prisma.snapshotObject.deleteMany({
      where: {
        OR: [{ key: { startsWith: `${normalized}/` } }, { key: normalized }],
      },
    });
    return;
  }

  if (storageMode === "local") {
    const target = path.resolve(localRoot(), normalized);
    if (target.startsWith(`${localRoot()}${path.sep}`)) {
      await fs.rm(target, { recursive: true, force: true });
    }
    return;
  }

  const { Bucket, client } = s3Config();
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket, Prefix: `${normalized}/`, ContinuationToken: token })
    );
    const objects = (page.Contents ?? []).flatMap((item) => (item.Key ? [{ Key: item.Key }] : []));
    if (objects.length) {
      await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objects, Quiet: true } }));
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

export function assertSnapshotStorageConfiguration() {
  const storageMode = mode();
  if (storageMode === "s3") {
    s3Config();
    if (!process.env.SNAPSHOT_S3_ENDPOINT && !process.env.AWS_REGION && !process.env.SNAPSHOT_S3_REGION) {
      throw new Error("Для S3 нужен SNAPSHOT_S3_REGION или AWS_REGION");
    }
  }
}
