export class LaporanError extends Error {
  constructor(public code: string, public status: number) {
    super(code === 'MODUL_BELUM_TERSEDIA'
      ? 'Laporan UMKM belum tersedia. Silakan kembali setelah modul diaktifkan.'
      : status === 401 || status === 403
        ? 'Laporan hanya dapat dibaca admin dan pemeriksa UMKM yang aktif. Hubungi admin untuk mengatur akses.'
        : code === 'INPUT_TIDAK_VALID'
          ? 'Periksa versi naskah dan konfirmasi kebijakan, lalu coba lagi.'
          : code === 'JARINGAN' ? 'Koneksi terputus. Periksa jaringan lalu coba lagi.'
            : 'Laporan belum berhasil diproses. Silakan coba lagi.');
  }
}

export async function laporanResponse(path = '', init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`/api/admin/umkm-laporan${path}`, {
      ...init, cache: 'no-store', credentials: 'same-origin',
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new LaporanError('JARINGAN', 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new LaporanError(body?.error?.code ?? 'GAGAL_INTERNAL', response.status);
  }
  return response;
}

export async function laporanRequest<T>(path = '', init: RequestInit = {}): Promise<T> {
  const response = await laporanResponse(path, init);
  const body = await response.json().catch(() => null);
  if (!body || !('data' in body)) throw new LaporanError('GAGAL_INTERNAL', 500);
  return body.data as T;
}
