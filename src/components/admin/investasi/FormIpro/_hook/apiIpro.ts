import { unggahKeR2 } from '@/lib/storage/unggah';
import type { GambarIpro, GambarIproKelola, IproAdmin } from '@/lib/data/investasi';
import { pathMentah } from '../_logika/gambar';

// Galat dari /api/admin/ipro/**: { error: { code, message, kekurangan? }, request_id }.
export class GalatIpro extends Error {
  constructor(readonly kode: string, readonly status: number, pesan: string, readonly kekurangan: string[] = []) {
    super(pesan);
    this.name = 'GalatIpro';
  }
}
export const kodeGalat = (e: unknown) => (e instanceof GalatIpro ? e.kode : 'GAGAL_INTERNAL');

async function panggil<T>(url: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new GalatIpro('GAGAL_JARINGAN', 0, 'Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.');
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string; kekurangan?: string[] } } | null;
  if (!res.ok) {
    throw new GalatIpro(json?.error?.code ?? 'GAGAL_INTERNAL', res.status, json?.error?.message ?? 'Permintaan belum dapat diproses.',
      Array.isArray(json?.error?.kekurangan) ? json.error.kekurangan : []);
  }
  return json?.data as T;
}

const DASAR = '/api/admin/ipro';
export const muatIproApi = (id: string) => panggil<IproAdmin & { gambar: GambarIproKelola[] }>(`${DASAR}/${id}`, 'GET');
export const buatIproApi = (payload: Record<string, unknown>) => panggil<IproAdmin>(DASAR, 'POST', payload);
export const ubahIproApi = (id: string, payload: Record<string, unknown>, versi: number) =>
  panggil<IproAdmin>(`${DASAR}/${id}`, 'PATCH', { ...payload, versi });
export const statusIproApi = (id: string, aksi: 'terbit' | 'arsip' | 'kembali_draf', versi: number) =>
  panggil<IproAdmin>(`${DASAR}/${id}/status`, 'POST', { aksi, versi });
export const hapusIproApi = (id: string) => panggil<void>(`${DASAR}/${id}`, 'DELETE');

export type IsianGambar = { alt: string; alt_en?: string | null; keterangan?: string | null; keterangan_en?: string | null; utama?: boolean };
export const tambahGambarApi = (id: string, kunciMentah: string, isian: IsianGambar) =>
  panggil<GambarIpro>(`${DASAR}/${id}/gambar`, 'POST', { kunci_mentah: kunciMentah, ...isian });
export const ubahGambarApi = (id: string, gambarId: string, isian: Partial<IsianGambar> & { urutan?: number }) =>
  panggil<GambarIpro>(`${DASAR}/${id}/gambar/${gambarId}`, 'PATCH', isian);
export const hapusGambarApi = (id: string, gambarId: string) => panggil<void>(`${DASAR}/${id}/gambar/${gambarId}`, 'DELETE');

// Presign -> PUT langsung ke R2 -> konfirmasi (pola lib/storage/unggah.ts), lalu server mengolah dan menyimpan gambar.
export async function unggahGambarIpro(id: string, berkas: File, isian: IsianGambar): Promise<GambarIpro> {
  let kunci: string;
  try {
    ({ kunci } = await unggahKeR2('ipro-mentah', pathMentah(id, berkas.type, crypto.randomUUID()), berkas));
  } catch (e) {
    throw new GalatIpro('UNGGAH_GAGAL', 0, e instanceof Error ? e.message : 'Unggah gambar gagal.');
  }
  return tambahGambarApi(id, kunci, isian);
}
