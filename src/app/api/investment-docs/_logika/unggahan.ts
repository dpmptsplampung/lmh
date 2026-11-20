import { deleteObjects, listObjects } from '@/lib/storage/r2';
import { logServerEvent } from '@/lib/observability/logger';
import { pathPdfInvestasiSah } from '@/lib/storage/area';
import { nowServer } from '@/lib/time';

/** Lease render; lebih panjang dari maxDuration 60 detik agar fungsi lama pasti sudah berhenti. */
export const LEASE_MS = 65_000;

export const sumberFinal = (id: string) => `src/${id}.pdf`;

/**
 * Path dari baris DB tidak dipercaya mentah: pengelola dapat mengubah kolom lewat PostgREST.
 * Kunci alur baru hanya milik dokumen bila ber-id sama; raw/ tidak pernah milik dokumen.
 * Path lama di luar awalan itu (mis. demo/) tetap dilayani seperti sebelumnya.
 */
export function milikDokumen(path: string, id: string): boolean {
  if (path.startsWith('raw/')) return false;
  if (path.startsWith('src/')) return path === sumberFinal(id);
  if (path.startsWith('_raw/')) return path === `_raw/${id}.pdf`;
  if (path.startsWith('pages/')) return path.startsWith(`pages/${id}/`);
  return true;
}

export async function hapusAman(kunci: string[], docId?: string): Promise<void> {
  try { await deleteObjects('private', kunci); }
  catch {
    logServerEvent('warn', { operation: 'investment_docs.cleanup_gagal', route: '/api/investment-docs', nFile: kunci.length, docId });
  }
}

export async function hapusHalaman(id: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const hasil = await listObjects('private', `investment-docs/pages/${id}/`, cursor);
    if (hasil.items.length) await deleteObjects('private', hasil.items.map(o => o.key));
    cursor = hasil.nextCursor ?? undefined;
  } while (cursor);
}

// Rekonsiliasi manual server, tidak dipanggil dari request atau DB/cron.
// Maksimal 1000 objek per pemanggilan; teruskan cursor sampai null untuk menyapu berikutnya.
export async function bersihkanRawLama(cursor?: string) {
  const hasil = await listObjects('private', 'investment-docs/raw/', cursor);
  const batas = nowServer().getTime() - 24 * 60 * 60 * 1000;
  const kunci = hasil.items.filter(o => o.lastModified.getTime() < batas
    && pathPdfInvestasiSah(o.key.slice('investment-docs/'.length))).map(o => o.key);
  await deleteObjects('private', kunci);
  return { dihapus: kunci.length, cursor: hasil.nextCursor };
}
