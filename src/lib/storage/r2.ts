// Klien Cloudflare R2 (kompatibel S3). Server-only: memakai kunci rahasia dari env. Dibuat malas agar impor tidak
// gagal saat env kosong (build, test, atau deploy tanpa R2); fungsi melempar galat jelas bila env kurang.
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type Bucket = 'private' | 'public';

interface KonfigR2 {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketPrivate: string;
  bucketPublic: string;
  publicBase: string;
}

function baca(): KonfigR2 | null {
  const e = process.env;
  const k = {
    accountId: e.R2_ACCOUNT_ID?.trim(),
    accessKeyId: e.R2_ACCESS_KEY_ID?.trim(),
    secretAccessKey: e.R2_SECRET_ACCESS_KEY?.trim(),
    bucketPrivate: e.R2_BUCKET_PRIVATE?.trim(),
    bucketPublic: e.R2_BUCKET_PUBLIC?.trim(),
    publicBase: e.R2_PUBLIC_BASE_URL?.trim().replace(/\/+$/, ''),
  };
  if (!k.accountId || !k.accessKeyId || !k.secretAccessKey || !k.bucketPrivate || !k.bucketPublic || !k.publicBase) return null;
  return k as KonfigR2;
}

export function r2Tersedia(): boolean {
  return baca() !== null;
}

function konfig(): KonfigR2 {
  const k = baca();
  if (!k) throw new Error('R2 belum dikonfigurasi');
  return k;
}

let klien: { kunci: string; s3: S3Client } | null = null;
function s3(): S3Client {
  const k = konfig();
  const kunci = `${k.accountId}:${k.accessKeyId}`;
  if (!klien || klien.kunci !== kunci) {
    klien = {
      kunci,
      s3: new S3Client({
        region: 'auto',
        endpoint: `https://${k.accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: k.accessKeyId, secretAccessKey: k.secretAccessKey },
      }),
    };
  }
  return klien.s3;
}

const namaBucket = (b: Bucket): string => (b === 'private' ? konfig().bucketPrivate : konfig().bucketPublic);

function adalahTidakAda(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.Code === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

export async function putObject(bucket: Bucket, key: string, body: Uint8Array | Buffer, contentType: string): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket: namaBucket(bucket), Key: key, Body: body, ContentType: contentType }));
}

export async function getObjectBytes(bucket: Bucket, key: string): Promise<Uint8Array | null> {
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: namaBucket(bucket), Key: key }));
    return r.Body ? await r.Body.transformToByteArray() : null;
  } catch (err) {
    if (adalahTidakAda(err)) return null;
    throw err;
  }
}

export async function getObjectStream(
  bucket: Bucket,
  key: string,
): Promise<{ stream: ReadableStream; contentType: string; contentLength: number } | null> {
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: namaBucket(bucket), Key: key }));
    if (!r.Body) return null;
    return {
      stream: r.Body.transformToWebStream(),
      contentType: r.ContentType ?? 'application/octet-stream',
      contentLength: r.ContentLength ?? 0,
    };
  } catch (err) {
    if (adalahTidakAda(err)) return null;
    throw err;
  }
}

export async function headObject(bucket: Bucket, key: string): Promise<{ size: number; contentType: string } | null> {
  try {
    const r = await s3().send(new HeadObjectCommand({ Bucket: namaBucket(bucket), Key: key }));
    return { size: r.ContentLength ?? 0, contentType: r.ContentType ?? '' };
  } catch (err) {
    if (adalahTidakAda(err)) return null;
    throw err;
  }
}

/** N byte pertama objek (untuk pemeriksaan magic bytes). */
export async function getObjectRange(bucket: Bucket, key: string, bytes: number): Promise<Uint8Array | null> {
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: namaBucket(bucket), Key: key, Range: `bytes=0-${Math.max(0, bytes - 1)}` }));
    return r.Body ? await r.Body.transformToByteArray() : null;
  } catch (err) {
    if (adalahTidakAda(err)) return null;
    throw err;
  }
}

export async function deleteObjects(bucket: Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const potong = keys.slice(i, i + 1000);
    await s3().send(
      new DeleteObjectsCommand({ Bucket: namaBucket(bucket), Delete: { Objects: potong.map((Key) => ({ Key })), Quiet: true } }),
    );
  }
}

/** URL PUT bertanda tangan; ContentType dan ContentLength ikut ditandatangani sehingga klien tidak bisa mengganti ukuran/tipe. */
export async function presignPut(
  bucket: Bucket,
  key: string,
  opts: { contentType: string; contentLength: number; ttlDetik?: number },
): Promise<string> {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: namaBucket(bucket), Key: key, ContentType: opts.contentType, ContentLength: opts.contentLength }),
    { expiresIn: opts.ttlDetik ?? 120 },
  );
}

export async function presignGet(bucket: Bucket, key: string, ttlDetik = 60): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: namaBucket(bucket), Key: key }), { expiresIn: ttlDetik });
}

export function urlPublik(key: string): string {
  return `${konfig().publicBase}/${key}`;
}
