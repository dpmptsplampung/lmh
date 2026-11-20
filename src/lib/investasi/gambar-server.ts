import 'server-only';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { deleteObjects, getObjectBytes, headObject, putObject } from '@/lib/storage/r2';
import { cocokMagicBytes } from '@/lib/storage/area';
import { logServerEvent } from '@/lib/observability/logger';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function kunciMentahSah(kunci: string, proyekId: string): boolean {
  return new RegExp(`^ipro-mentah/${UUID}/${UUID}\\.(jpg|jpeg|png|webp)$`).test(kunci) && kunci.split('/')[1] === proyekId;
}
export async function hapusObjekGambar(kunci: string[], bucket: 'private' | 'public' = 'public') {
  if (!kunci.length) return;
  await deleteObjects(bucket, kunci).catch(() => {
    logServerEvent('warn', { operation: 'investasi.gambar.hapus_gagal' });
  });
}
export async function olahGambarIpro(proyekId: string, kunciMentah: string) {
  if (!kunciMentahSah(kunciMentah, proyekId)) throw new Error('INPUT_TIDAK_VALID');
  const head = await headObject('private', kunciMentah);
  if (!head) throw new Error('TIDAK_DITEMUKAN');
  if (!head.size || head.size > 8 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(head.contentType.split(';')[0])) {
    await hapusObjekGambar([kunciMentah], 'private'); throw new Error('INPUT_TIDAK_VALID');
  }
  const bytes = await getObjectBytes('private', kunciMentah);
  if (!bytes) throw new Error('TIDAK_DITEMUKAN');
  let besar: Buffer;
  let mini: Buffer;
  let lebar: number, tinggi: number;
  try {
    if (bytes.length > 8 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].some(m => cocokMagicBytes(m, bytes))) throw new Error();
    const gambar = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate();
    const metadata = await gambar.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error();
    const [utama, kecil] = await Promise.all([
      gambar.clone().resize({ width: 1600, height: 4000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true }),
      gambar.clone().resize({ width: 640, height: 4000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer(),
    ]);
    if (utama.data.length > 2 * 1024 * 1024 || kecil.length > 2 * 1024 * 1024) throw new Error();
    besar = utama.data; mini = kecil; lebar = utama.info.width; tinggi = utama.info.height;
  } catch {
    await hapusObjekGambar([kunciMentah], 'private'); throw new Error('INPUT_TIDAK_VALID');
  }
  const dasar = `ipro-gambar/${proyekId}/${randomUUID()}`;
  const kunci = `${dasar}.webp`, kunci_mini = `${dasar}-640.webp`;
  try {
    await putObject('public', kunci, besar, 'image/webp');
    await putObject('public', kunci_mini, mini, 'image/webp');
  } catch {
    await hapusObjekGambar([kunci, kunci_mini]); throw new Error('GAGAL_INTERNAL');
  }
  await hapusObjekGambar([kunciMentah], 'private');
  return { kunci, kunci_mini, lebar, tinggi };
}
