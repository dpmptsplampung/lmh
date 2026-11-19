import { z } from 'zod';
import { KAB_KOTA_IPRO, MATA_UANG, SEKTOR_IPRO, SKEMA_IPRO, STATUS_LAHAN, TAHAP_KAJIAN } from './konstanta';
import { slugFoila, validasiUrlFoila } from './foila';

const teks = (maks: number, min = 0) => z.string()
  .refine(v => !Array.from(v).some(c => (c.charCodeAt(0) < 32 && c !== '\n') || c.charCodeAt(0) === 127), 'Karakter kontrol tidak diizinkan')
  .trim().min(min).max(maks);
const opsional = (maks: number, min = 0) => teks(maks, min).nullable().optional();
const integer = z.number().int().min(-2147483648).max(2147483647);
const uang = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const slug = teks(120, 3).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const urlFoila = teks(2048, 1).refine(v => {
  try { return !!validasiUrlFoila(v) && !!slugFoila(v); } catch { return false; }
}, 'Gunakan tautan proyek FOILA resmi');
const umum = {
  judul: teks(200, 3), judul_en: opsional(200, 3), ringkasan: teks(600, 1), ringkasan_en: opsional(600, 1),
  slug: slug.optional(), sektor: z.enum(SEKTOR_IPRO.map(v => v.nilai)),
  kab_kota: teks(60, 3).refine(v => KAB_KOTA_IPRO.includes(v)),
  nilai_investasi: uang.nonnegative().nullable().optional(), mata_uang: z.enum(MATA_UANG).optional(),
  nilai_teks: opsional(200), urutan: integer.optional(),
};
const detail = {
  deskripsi: opsional(20000), deskripsi_en: opsional(20000), lokasi_teks: opsional(300),
  lat: z.number().min(-6.6).max(-3).nullable().optional(), lng: z.number().min(103).max(106.6).nullable().optional(),
  pemilik: opsional(200), irr_persen: z.number().min(-100).max(1000).nullable().optional(),
  npv_nilai: uang.nullable().optional(), payback_bulan: z.number().int().min(1).max(600).nullable().optional(),
  skema: z.enum(SKEMA_IPRO.map(v => v.nilai)).nullable().optional(),
  status_lahan: z.enum(STATUS_LAHAN.map(v => v.nilai)).nullable().optional(),
  luas_ha: z.number().positive().max(9999999999.99).nullable().optional(),
  tahap_kajian: z.enum(TAHAP_KAJIAN.map(v => v.nilai)).nullable().optional(), perizinan: opsional(2000),
  dokumen_id: z.uuid().nullable().optional(), kontak_instansi: opsional(200),
  kontak_email: teks(254, 1).pipe(z.email()).nullable().optional(),
  kontak_telepon: teks(21, 6).regex(/^\+?[0-9][0-9 -]{5,19}$/).nullable().optional(),
};
export const iproPtspSchema = z.object({ sumber: z.literal('ptsp'), ...umum, ...detail }).strict();
export const iproFoilaSchema = z.object({ sumber: z.literal('foila'), ...umum, sumber_url: urlFoila }).strict();
export const iproBuatSchema = z.discriminatedUnion('sumber', [iproPtspSchema, iproFoilaSchema])
  .refine(v => !('lat' in v) || (v.lat == null) === (v.lng == null), 'Koordinat harus berpasangan');
export const iproUbahSchema = z.object({ ...umum, ...detail, sumber_url: urlFoila }).partial()
  .extend({ versi: z.number().int().positive() }).strict()
  .refine(v => Object.keys(v).length > 1, 'Isi perubahan');
export const statusAksiSchema = z.object({ aksi: z.enum(['terbit', 'arsip', 'kembali_draf']), versi: z.number().int().positive() }).strict();
const gambar = { alt: teks(200, 3), alt_en: opsional(200, 3), keterangan: opsional(300), keterangan_en: opsional(300),
  utama: z.boolean().optional(), urutan: integer.optional() };
export const gambarSchema = z.object({ ...gambar, kunci_mentah: teks(300, 1) }).strict();
export const gambarUbahSchema = z.object(gambar).partial().strict().refine(v => Object.keys(v).length > 0);
export const daftarIproSchema = z.object({ status: z.enum(['draf', 'terbit', 'arsip']).optional(), sumber: z.enum(['ptsp', 'foila']).optional(),
  cari: teks(200).optional(), dari: z.coerce.number().int().min(0).default(0), sampai: z.coerce.number().int().min(0).default(49),
}).strict().refine(v => v.sampai >= v.dari && v.sampai - v.dari < 100);
