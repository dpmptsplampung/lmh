export class PengawasanError extends Error {
  constructor(public code: string, public status: number) {
    const message = code === 'MODUL_BELUM_TERSEDIA'
      ? 'Pengawasan UMKM belum tersedia. Silakan coba kembali setelah layanan diaktifkan.'
      : code === 'DILARANG' || code === 'LOGIN_DIPERLUKAN'
        ? 'Pengawasan hanya untuk Front Office dan admin yang aktif. Hubungi admin bila akses belum sesuai.'
        : code === 'TERLALU_BANYAK' ? 'Permintaan sedang padat. Tunggu sebentar lalu coba lagi.'
          : code === 'KONFLIK_STATUS' ? 'Tindakan belum dapat dilakukan pada kondisi profil ini. Muat ulang profil.'
            : code === 'KONFLIK_VERSI' || code === 'KONFLIK_OPERASI'
              ? 'Profil telah berubah. Muat ulang hasil pencarian sebelum melanjutkan.'
              : code === 'KONTAK_PUBLIK' ? 'Alasan tidak boleh memuat nomor atau informasi kontak.'
                : code === 'INPUT_TIDAK_VALID' ? 'Periksa isian. Alasan harus singkat dan tanpa informasi kontak.'
                  : code === 'JARINGAN' ? 'Koneksi terputus. Periksa jaringan lalu coba lagi.'
                    : 'Pengawasan belum berhasil dimuat. Silakan coba lagi.';
    super(message);
  }
}

export async function pengawasanRequest<T>(path = '', init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/umkm-pengawasan${path}`, {
      ...init, cache: 'no-store', credentials: 'same-origin',
    });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new PengawasanError('JARINGAN', 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new PengawasanError(body?.error?.code ?? 'GAGAL_INTERNAL', response.status);
  if (!body || !('data' in body)) throw new PengawasanError('GAGAL_INTERNAL', 500);
  return body.data as T;
}
