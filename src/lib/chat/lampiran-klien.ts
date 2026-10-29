// Sisi browser: foto -> dikompres (JPEG, sisi terpanjang 1280 px) -> presign -> PUT ke R2. Hasilnya dilampirkan ke POST /api/chat/messages.
import { kompresBerkas } from '@/lib/foto/kompres';
import { MAKS_LAMPIRAN_BYTE, MIME_LAMPIRAN, type LampiranChat } from './lampiran';

export const PESAN_UKURAN = 'Ukuran maksimal 5 MB';

export async function unggahLampiranChat(sesiId: string, berkas: File): Promise<LampiranChat> {
  if (!(MIME_LAMPIRAN as readonly string[]).includes(berkas.type)) throw new Error('Hanya foto JPG, PNG, atau WEBP');
  // Foto kamera ponsel bisa 5-12 MB: dikompres dulu; batas 5 MB berlaku pada hasil kompresi.
  const blob = berkas.size > 300 * 1024 ? await kompresBerkas(berkas).catch(() => berkas) : berkas;
  if (blob.size > MAKS_LAMPIRAN_BYTE) throw new Error(PESAN_UKURAN);
  const mime = blob.type || berkas.type;

  const pre = await fetch('/api/chat/lampiran/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sesi_id: sesiId, mime, ukuran: blob.size }),
  });
  if (!pre.ok) throw new Error(((await pre.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Gagal menyiapkan unggahan');
  const { uploadUrl, kunci, headers } = (await pre.json()) as { uploadUrl: string; kunci: string; headers: Record<string, string> };

  let put: Response;
  try {
    put = await fetch(uploadUrl, { method: 'PUT', headers, body: blob });
  } catch {
    throw new Error('Unggah foto gagal. Periksa koneksi.');
  }
  if (!put.ok) throw new Error('Unggah foto gagal');
  return { kunci, mime: mime as LampiranChat['mime'], ukuran: blob.size, nama: berkas.name || 'foto' };
}
