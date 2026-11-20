import { createClient } from '@/lib/supabase/client';
import type { KanalMinat } from './formulir-logika';

export class MinatError extends Error {
  constructor(public code: string, public status: number) {
    super(pesanGalatMinat(code, status));
  }
}

export function pesanGalatMinat(code: string, status: number): string {
  if (status === 0 || code === 'JARINGAN') return 'Koneksi terputus. Periksa jaringan lalu kirim kembali.';
  if (status === 429 || code === 'TERLALU_BANYAK') return 'Terlalu banyak pengiriman dari perangkat ini. Tunggu beberapa saat lalu coba lagi.';
  if (status === 400 || code === 'INPUT_TIDAK_VALID') return 'Periksa kembali isian Anda, lalu kirim ulang.';
  if (code === 'KONFLIK_OPERASI') return 'Kiriman sebelumnya sudah diterima dengan isian yang berbeda. Perubahan ini belum dikirim. Tutup lalu buka kembali formulir untuk mengirim pesan baru.';
  if (status === 401 || code === 'LOGIN_DIPERLUKAN') return 'Sesi belum berhasil disiapkan. Silakan coba kirim kembali.';
  if (status === 404 || code === 'TIDAK_DITEMUKAN') return 'Data ini tidak lagi tersedia. Muat ulang halaman lalu coba lagi.';
  return 'Pengiriman belum berhasil. Silakan coba kirim kembali.';
}

const RUTE: Record<KanalMinat, string> = { ipro: '/api/investasi/pesan', dokumen: '/api/investasi/lead' };

/**
 * Kirim minat tanpa login: sesi anonim Supabase dibuat otomatis bila belum ada (pola Katalog UMKM `kirimFormulir`),
 * lalu POST ke route publik. Mengembalikan tanda terima `{ id }`.
 */
export async function kirimMinat(kanal: KanalMinat, badan: Record<string, unknown>): Promise<{ id: string }> {
  try {
    const klien = createClient();
    const { data, error } = await klien.auth.getSession();
    if (error) throw new MinatError('LOGIN_DIPERLUKAN', 401);
    if (!data.session) {
      const anon = await klien.auth.signInAnonymously();
      if (anon.error || !anon.data.session) throw new MinatError('LOGIN_DIPERLUKAN', 401);
    }
  } catch (e) {
    if (e instanceof MinatError) throw e;
    throw new MinatError('JARINGAN', 0);
  }
  let respons: Response;
  try {
    respons = await fetch(RUTE[kanal], {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(badan),
      cache: 'no-store', credentials: 'same-origin',
    });
  } catch {
    throw new MinatError('JARINGAN', 0);
  }
  const isi = await respons.json().catch(() => null) as { data?: { id?: unknown }; error?: { code?: unknown } } | null;
  if (!respons.ok) throw new MinatError(typeof isi?.error?.code === 'string' ? isi.error.code : 'GAGAL_INTERNAL', respons.status);
  if (typeof isi?.data?.id !== 'string') throw new MinatError('GAGAL_INTERNAL', 500);
  return { id: isi.data.id };
}
