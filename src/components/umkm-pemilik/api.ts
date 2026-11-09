// Panggilan layar pemilik ke /api/umkm-pemilik. Semua no-store dan memakai cookie sesi.
// Nomor WhatsApp hanya lewat badan permintaan dan state komponen; tidak ditulis ke penyimpanan peramban.
export class PemilikError extends Error {
  constructor(public code: string, public status: number) {
    super(pesanGalat(code));
  }
}

export function hasilBelumPasti(error: unknown): boolean {
  return !(error instanceof PemilikError) || error.status === 0 || error.status === 408 || error.status >= 500;
}

function pesanGalat(code: string): string {
  switch (code) {
    case 'LOGIN_DIPERLUKAN': return 'Masuk dengan akun pribadi Anda untuk melanjutkan.';
    case 'DILARANG': return 'Akun ini belum berhak melakukan tindakan tersebut. '
      + 'Hak mengubah berlaku sesudah petugas memastikan penanggung jawab usaha.';
    case 'MODUL_BELUM_TERSEDIA': return 'Halaman Usaha saya belum dibuka. Silakan kembali lagi nanti.';
    case 'TIDAK_DITEMUKAN': return 'Usaha tidak ditemukan atau bukan milik akun ini.';
    case 'KONFLIK_VERSI': case 'KONFLIK_STATUS': return 'Data usaha sudah berubah. Muat ulang halaman sebelum melanjutkan.';
    case 'KONFLIK_OPERASI': return 'Isian sudah berubah. Periksa kembali sebelum mengirim.';
    case 'KONTAK_PUBLIK': return 'Nomor telepon, email, atau alamat rinci tidak boleh ada di bagian yang tampil publik. '
      + 'Bersihkan lalu kirim lagi.';
    case 'INPUT_TIDAK_VALID': return 'Periksa kembali isian. Tautan sosial hanya boleh HTTPS Instagram atau TikTok.';
    case 'TERLALU_BANYAK': return 'Permintaan sedang padat. Tunggu sebentar lalu coba lagi.';
    case 'JARINGAN': return 'Koneksi terputus. Periksa jaringan lalu coba lagi.';
    default: return 'Permintaan belum berhasil diproses. Silakan coba lagi.';
  }
}

export async function pemilikRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/umkm-pemilik${path}`, { ...init, cache: 'no-store', credentials: 'same-origin' });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new PemilikError('JARINGAN', 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new PemilikError(body?.error?.code ?? 'GAGAL_INTERNAL', response.status);
  if (!body || !('data' in body)) throw new PemilikError('GAGAL_INTERNAL', 500);
  return body.data as T;
}

export function kirimPemilik<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal) {
  return pemilikRequest<T>(path, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

export const TEKS_PENCABUTAN = 'Setelah dicabut, nomor Anda tidak lagi diberikan ke perusahaan baru dan tidak tampil '
  + 'di akun perusahaan di LMH. Perusahaan yang sudah menerima nomor Anda mungkin masih menyimpannya.';
export const TEKS_NIB = 'Usaha Anda belum tercatat memiliki NIB. NIB gratis dan dapat diurus lewat Helpdesk OSS '
  + 'DPMPTSP. Profil Anda tetap tampil tanpa NIB.';
