// Aturan per "area" penyimpanan R2: bucket, tipe berkas, batas ukuran, dan peran yang boleh mengunggah.
// Hak akses yang dulu ada di policy storage.objects Supabase kini dijaga route /api/storage/*.
import type { Bucket } from './r2';

export type Area = 'investment-docs' | 'umkm-photos' | 'absensi-foto' | 'pengaduan-bukti' | 'umkm-legalitas' | 'chat-lampiran';
export type PeranStaf = 'admin' | 'petugas' | 'front_office';

const GAMBAR = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const ATURAN_AREA: Record<Area, { bucket: Bucket; mime: readonly string[]; maksByte: number; peran: readonly PeranStaf[] }> = {
  'investment-docs': { bucket: 'private', mime: ['application/pdf'], maksByte: 50 * 1024 * 1024, peran: ['admin'] },
  'umkm-photos': { bucket: 'public', mime: GAMBAR, maksByte: 2 * 1024 * 1024, peran: ['admin', 'petugas'] },
  'absensi-foto': { bucket: 'private', mime: GAMBAR, maksByte: 5 * 1024 * 1024, peran: ['admin', 'front_office'] },
  'pengaduan-bukti': { bucket: 'private', mime: [...GAMBAR, 'application/pdf'], maksByte: 5 * 1024 * 1024, peran: ['admin', 'front_office'] },
  'umkm-legalitas': { bucket: 'private', mime: [...GAMBAR, 'application/pdf'], maksByte: 5 * 1024 * 1024, peran: ['admin', 'front_office'] },
  'chat-lampiran': { bucket: 'private', mime: GAMBAR, maksByte: 5 * 1024 * 1024, peran: ['admin', 'petugas', 'front_office'] },
};

export function adalahArea(v: unknown): v is Area {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ATURAN_AREA, v);
}

/** Kunci objek = `<area>/<path>`. Menolak path kosong, `..`, awalan `/`, `\`, karakter kontrol, atau > 300 karakter. */
export function kunciObjek(area: Area, path: string): string {
  if (
    !path ||
    path.length > 300 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.split('/').some((b) => b === '..' || b === '.' || b === '')
  ) {
    throw new Error('path penyimpanan tidak valid');
  }
  return `${area}/${path}`;
}

/** Pemeriksaan tanda tangan berkas (magic bytes) agar tipe yang diklaim klien tidak sekadar dipercaya. */
export function cocokMagicBytes(mime: string, head: Uint8Array): boolean {
  const s = (...b: number[]) => b.every((v, i) => head[i] === v);
  switch (mime) {
    case 'image/jpeg': return head.length >= 3 && s(0xff, 0xd8, 0xff);
    case 'image/png': return head.length >= 4 && s(0x89, 0x50, 0x4e, 0x47);
    case 'image/webp': return head.length >= 12 && s(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    case 'application/pdf': return head.length >= 5 && s(0x25, 0x50, 0x44, 0x46, 0x2d);
    default: return false;
  }
}
