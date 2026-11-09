const ROOT = '/api/admin/umkm-tugas';

export class TugasError extends Error {
  constructor(public code: string, public status: number) {
    super(pesanGalat(code));
  }
}

export function hasilBelumPasti(error: unknown): boolean {
  return !(error instanceof TugasError) || error.status === 0 || error.status === 408 || error.status >= 500;
}

function pesanGalat(code: string): string {
  switch (code) {
    case 'LOGIN_DIPERLUKAN': case 'DILARANG': return 'Akses tugas UMKM hanya untuk petugas pemeriksa yang aktif. Hubungi admin untuk mengatur akses.';
    case 'MODUL_BELUM_TERSEDIA': return 'Tugas UMKM belum tersedia. Silakan coba kembali setelah modul diaktifkan.';
    case 'TIDAK_DITEMUKAN': return 'Tugas tidak ditemukan atau sudah tidak dapat diakses. Kembali ke daftar tugas.';
    case 'KONFLIK_VERSI': case 'KONFLIK_STATUS': case 'KONFLIK_OPERASI': return 'Tugas berubah atau telah diambil petugas lain. Muat ulang sebelum melanjutkan.';
    case 'KONTAK_PUBLIK': return 'Bersihkan informasi kontak pada bagian yang ditandai sebelum menerbitkan.';
    case 'INPUT_TIDAK_VALID': return 'Periksa kembali isian. Tautan sosial hanya boleh HTTPS Instagram atau TikTok; alasan tolak tidak boleh memuat kontak.';
    case 'BELUM_TERTAUT': return 'Pemohon belum menautkan akunnya. Kirim kode tautan kepada pemohon dan minta ia memasukkannya di akun LMH.';
    case 'NOMOR_TIDAK_TERSEDIA': return 'Nomor belum dapat dibuka. Periksa izin UMKM, profil, dan status tahan, lalu muat ulang.';
    case 'TERLALU_BANYAK': return 'Permintaan sedang padat. Tunggu sebentar lalu coba lagi.';
    case 'JARINGAN': return 'Koneksi terputus. Periksa jaringan lalu coba lagi.';
    default: return 'Tugas belum berhasil diproses. Silakan coba lagi.';
  }
}

export async function tugasRequest<T>(path = '', init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ROOT}${path}`, { ...init, cache: 'no-store', credentials: 'same-origin' });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new TugasError('JARINGAN', 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new TugasError(body?.error?.code ?? 'GAGAL_INTERNAL', response.status);
  if (!body || !('data' in body)) throw new TugasError('GAGAL_INTERNAL', 500);
  return body.data as T;
}

export function kirimTugas<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal) {
  return tugasRequest<T>(path, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
