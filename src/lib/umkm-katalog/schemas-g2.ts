import { z } from 'zod';
import { versiSchema } from './schemas';
const teks = (maks: number) => z.string().trim().max(maks);
export const cursorOpaqueSchema = z.object({
  cursor: z.string().max(4096).regex(/^[A-Za-z0-9+/=]+\.[a-f0-9]{64}$/).optional(),
}).strict();
export const katalogSchema = cursorOpaqueSchema.extend({
  q: teks(100).optional(), jenis: teks(100).optional(), kategori: teks(100).optional(),
  spesifik: teks(100).optional(), kabupaten_kota: teks(100).optional(), sort: z.literal('terbaru').optional(),
});
export const kosongSchema = z.object({}).strict();
export const pesanSchema = z.object({
  nama: teks(200).min(1), perusahaan: teks(200).min(1), pesan: teks(1000).min(1),
  nomor: z.string().transform(v => v.replace(/[\s.()\-]/g, ''))
    .pipe(z.string().regex(/^\+?[0-9]{8,20}$/)),
  operasi_id: z.uuid(), profil_id: z.uuid().nullable().optional(), kata_kunci: teks(100).nullable().optional(),
}).strict();
export const alasanLaporanSchema = z.enum(['penipuan', 'nomor_tampil', 'data_salah', 'foto_tidak_pantas', 'lainnya']);
export const laporanSchema = z.object({
  profil_id: z.uuid(), alasan: alasanLaporanSchema, operasi_id: z.uuid(),
  foto_id: z.uuid().nullable().optional(), catatan: teks(500).nullable().optional(),
}).strict();
export const daruratSchema = versiSchema.extend({ aksi: z.enum(['sembunyikan', 'catat_pencabutan']),
  alasan: teks(240).min(1),
});
export const cariPengawasanSchema = z.object({ q: teks(100).min(2), cursor: z.uuid().optional() }).strict();
export function queryInput(request: Request) {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new Error('INPUT_TIDAK_VALID');
  return Object.fromEntries(params);
}
