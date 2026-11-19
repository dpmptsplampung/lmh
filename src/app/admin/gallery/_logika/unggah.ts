import type { GalleryDoc } from './tipe';

interface Hasil {
  id: string;
  jumlah_halaman: number;
  halaman_selesai: number;
  selesai: boolean;
  uploadUrl: string;
  kunci: string;
  headers: Record<string, string>;
}
export async function jsonPost(url: string, body: unknown): Promise<Hasil> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'Pemrosesan terhenti. Segarkan daftar lalu lanjutkan pemrosesan.');
  return data;
}

export async function prosesDokumen(doc: Pick<GalleryDoc, 'id' | 'halaman_selesai' | 'jumlah_halaman'>,
  kemajuan: (selesai: number, total: number) => void): Promise<void> {
  let n = doc.halaman_selesai;
  do {
    const data = await jsonPost(`/api/investment-docs/${doc.id}/render`, { mulai: n + 1 });
    if (!Number.isInteger(data.halaman_selesai) || (data.halaman_selesai < n || (data.halaman_selesai === n && !data.selesai)) || data.jumlah_halaman !== doc.jumlah_halaman
      || data.halaman_selesai > doc.jumlah_halaman || (data.selesai && data.halaman_selesai !== doc.jumlah_halaman)) throw new Error('Kemajuan dokumen berubah. Segarkan daftar lalu lanjutkan.');
    n = data.halaman_selesai;
    kemajuan(n, data.jumlah_halaman);
    if (data.selesai) return;
  } while (n <= doc.jumlah_halaman);
}
