import { createClient } from '@/lib/supabase/client';

export class KatalogError extends Error {
  constructor(public code: string, public status: number) {
    super(pesanGalat(code));
  }
}

function pesanGalat(code: string) {
  switch (code) {
    case 'MODUL_BELUM_TERSEDIA': return 'Katalog belum tersedia. Silakan kembali setelah layanan diaktifkan.';
    case 'TERLALU_BANYAK': return 'Permintaan sedang padat. Tunggu sebentar lalu coba lagi.';
    case 'TIDAK_DITEMUKAN': return 'Profil belum dapat ditampilkan';
    case 'INPUT_TIDAK_VALID': return 'Periksa kembali isian atau ulangi pencarian dari halaman pertama.';
    case 'LOGIN_DIPERLUKAN': return 'Sesi belum berhasil disiapkan. Silakan coba kirim kembali.';
    case 'DILARANG': return 'Permintaan belum dapat dilanjutkan. Silakan kembali ke katalog.';
    case 'JARINGAN': return 'Koneksi terputus. Periksa jaringan lalu coba lagi.';
    case 'NOMOR_TIDAK_TERSEDIA': return 'Nomor tidak lagi ditampilkan.';
    case 'KODE_TIDAK_VALID': return 'Kode belum dapat dipakai. Periksa kembali kode Anda.';
    case 'BELUM_TERTAUT': return 'Permintaan belum dapat dilanjutkan. Lengkapi data perusahaan Anda lebih dulu.';
    case 'KONFLIK_OPERASI': return 'Isian sudah berubah. Periksa kembali sebelum mengirim.';
    default: return 'Katalog belum berhasil dimuat. Silakan coba lagi.';
  }
}

export async function katalogRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/umkm-katalog${path}`, {
      ...init, cache: 'no-store', credentials: 'same-origin',
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new KatalogError('JARINGAN', 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new KatalogError(body?.error?.code ?? 'GAGAL_INTERNAL', response.status);
  if (!body || !('data' in body)) throw new KatalogError('GAGAL_INTERNAL', 500);
  return body.data as T;
}

export async function kirimFormulir(path: '/pesan' | '/laporan', body: Record<string, unknown>) {
  try {
    const client = createClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw new KatalogError('LOGIN_DIPERLUKAN', 401);
    if (!data.session) {
      const result = await client.auth.signInAnonymously();
      if (result.error || !result.data.session) throw new KatalogError('LOGIN_DIPERLUKAN', 401);
    }
  } catch (error) {
    if (error instanceof KatalogError) throw error;
    throw new KatalogError('JARINGAN', 0);
  }
  return katalogRequest<{ id: string }>(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
