export const headersPrivat = { 'Cache-Control': 'private, no-store' };
const pesan: Record<string, string> = {
  INPUT_TIDAK_VALID: 'Periksa kembali isian Anda.', LOGIN_DIPERLUKAN: 'Silakan masuk untuk melanjutkan.',
  DILARANG: 'Akun ini tidak berwenang mengelola investasi.', TIDAK_DITEMUKAN: 'Data tidak ditemukan.',
  KONFLIK_VERSI: 'Data telah berubah. Muat ulang sebelum melanjutkan.', KONFLIK_STATUS: 'Tindakan tidak sesuai status saat ini.',
  KONFLIK_OPERASI: 'Kunci operasi sudah digunakan untuk isian berbeda.', SLUG_TERKUNCI: 'Slug proyek yang pernah terbit tidak dapat diubah.',
  SYARAT_TERBIT: 'Lengkapi persyaratan penerbitan.', TERLALU_BANYAK: 'Coba kembali beberapa saat lagi.',
  GAGAL_INTERNAL: 'Permintaan belum dapat diproses. Silakan coba kembali.',
};
export function kodeRpc(error: unknown): string {
  if (!error || typeof error !== 'object') return 'GAGAL_INTERNAL';
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof message === 'string' && Object.hasOwn(pesan, message)) return message;
  return ({ '42501': 'DILARANG', '28000': 'LOGIN_DIPERLUKAN', PGRST301: 'LOGIN_DIPERLUKAN',
    PGRST302: 'LOGIN_DIPERLUKAN', P0002: 'TIDAK_DITEMUKAN', '40001': 'KONFLIK_VERSI', '55P03': 'KONFLIK_VERSI',
    '23505': 'KONFLIK_STATUS', '23503': 'KONFLIK_STATUS', '23514': 'INPUT_TIDAK_VALID',
    '22023': 'INPUT_TIDAK_VALID', '22P02': 'INPUT_TIDAK_VALID', '22003': 'INPUT_TIDAK_VALID',
  } as Record<string, string>)[typeof code === 'string' ? code : ''] ?? 'GAGAL_INTERNAL';
}
export function galat(code: string, requestId: string, kekurangan?: string[]): Response {
  if (!Object.hasOwn(pesan, code)) code = 'GAGAL_INTERNAL';
  const status = ({ INPUT_TIDAK_VALID: 400, LOGIN_DIPERLUKAN: 401, DILARANG: 403, TIDAK_DITEMUKAN: 404,
    SLUG_TERKUNCI: 409, SYARAT_TERBIT: 409, TERLALU_BANYAK: 429 } as Record<string, number>)[code]
    ?? (code.startsWith('KONFLIK_') ? 409 : 500);
  return Response.json({ error: { code, message: pesan[code] ?? (status === 409 ? pesan.KONFLIK_STATUS : pesan.GAGAL_INTERNAL),
    ...(kekurangan ? { kekurangan } : {}) }, request_id: requestId }, {
    status, headers: { ...headersPrivat, ...(status === 429 ? { 'Retry-After': '60' } : {}) },
  });
}
// DETAIL hanya boleh membawa nama field publik yang sudah dikenal.
export function galatRpc(error: unknown, requestId: string): Response {
  const code = kodeRpc(error);
  let kekurangan: string[] | undefined;
  if (code === 'SYARAT_TERBIT' && error && typeof error === 'object' && 'details' in error && typeof error.details === 'string') {
    try {
      const fields: unknown = JSON.parse(error.details);
      const sah = ['kab_kota', 'sektor', 'deskripsi', 'gambar_utama', 'sumber_url', 'gambar'];
      if (Array.isArray(fields)) kekurangan = sah.filter(field => fields.includes(field));
    } catch { /* Pesan internal tidak menjadi bagian respons. */ }
  }
  return galat(code, requestId, kekurangan);
}
export async function bacaJson(request: Request): Promise<unknown> {
  const batas = 16 * 1024;
  if (Number(request.headers.get('content-length') ?? 0) > batas) throw new Error('INPUT_TIDAK_VALID');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INPUT_TIDAK_VALID');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > batas) { await reader.cancel(); throw new Error('INPUT_TIDAK_VALID'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw new Error('INPUT_TIDAK_VALID'); } finally { reader.releaseLock(); }
}
export const sukses = (data: unknown, status = 200) => Response.json({ data }, { status, headers: headersPrivat });
