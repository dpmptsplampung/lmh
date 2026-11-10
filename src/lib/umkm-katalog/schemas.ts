import { z } from 'zod';
import { validasiUrlFoto } from '@/lib/umkm/foto-url';
import { todayWIB } from '@/lib/time';
import {
  BENTUK_USAHA, JENIS_USAHA, OMZET_RENTANG, PERIODE_KAPASITAS, TENAGA_KERJA_RENTANG, kategoriSah,
} from './taksonomi';
import { KABUPATEN_KOTA } from './wilayah';
const teks = (maks: number) => z.string().trim().max(maks);
const opsional = (maks: number) => teks(maks).nullable().optional();
const sosial = (domain: string) => z.string().trim().max(500).transform(v => v || null).nullable().optional()
  .refine(v => {
    if (!v) return true;
    try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      [domain, `www.${domain}`].includes(u.hostname) && u.pathname.length > 1; } catch { return false; }
  }, 'Tautan profil media sosial tidak valid');
const fotoDasar = z.object({
  asal: z.enum(['satudata', 'eksternal', 'unggahan']),
  url: z.string().trim().max(500).nullable().optional(),
  r2_key: z.string().max(310).nullable().optional(),
});
type IsiFoto = z.infer<typeof fotoDasar>;
function periksaFoto(f: IsiFoto, ctx: z.RefinementCtx) {
  if (f.asal === 'unggahan') {
    if (f.url || !f.r2_key || !/^umkm-draf\/[A-Za-z0-9_./-]+$/.test(f.r2_key) ||
      f.r2_key.split('/').some(v => !v || v === '.' || v === '..'))
      ctx.addIssue({ code: 'custom', path: ['r2_key'], message: 'Kunci foto privat tidak valid' });
  } else if (f.r2_key || !f.url || !validasiUrlFoto(f.url).ok) {
    ctx.addIssue({ code: 'custom', path: ['url'], message: 'Tautan foto tidak valid' });
  }
}
// Foto profil boleh ditandai utama; foto produk tidak.
export const fotoSchema = fotoDasar.extend({ utama: z.boolean().optional() }).strict().superRefine(periksaFoto);
export const fotoProdukSchema = fotoDasar.strict().superRefine(periksaFoto);
export type FotoInput = z.input<typeof fotoSchema>;

export const PESAN_KAPASITAS = 'Isi jumlah, satuan, dan periode kapasitas sekaligus, atau kosongkan ketiganya';
export const produkSchema = z.object({
  nama: teks(100).min(1), keterangan: opsional(500),
  kapasitas_jumlah: z.number().positive().max(1e9).multipleOf(0.01).nullable().optional(),
  kapasitas_satuan: opsional(20), kapasitas_periode: z.enum(PERIODE_KAPASITAS).nullable().optional(),
  foto: fotoProdukSchema.nullable().optional(),
}).strict().superRefine((p, ctx) => {
  const terisi = [p.kapasitas_jumlah != null, !!p.kapasitas_satuan, p.kapasitas_periode != null];
  if (terisi.some(Boolean) && !terisi.every(Boolean))
    ctx.addIssue({ code: 'custom', path: ['kapasitas_jumlah'], message: PESAN_KAPASITAS });
});
export type ProdukInput = z.input<typeof produkSchema>;

// Objek dasar tanpa pemeriksaan lintas kolom, supaya masih bisa di-omit (zod melarang omit setelah refine).
export const profilDasarSchema = z.object({
  nama: teks(200).min(1), deskripsi: teks(4000), alamat: opsional(500), jenis: z.enum(JENIS_USAHA),
  kategori: teks(100).min(1), spesifik: opsional(100),
  kabupaten_kota: z.string().trim().refine(v => KABUPATEN_KOTA.includes(v), 'Pilih kabupaten atau kota di Lampung'),
  kecamatan: opsional(100), nama_pemilik: opsional(200),
  bentuk_usaha: z.enum(BENTUK_USAHA).nullable().optional(),
  tahun_mulai: z.number().int().min(1900).nullable().optional()
    .refine(v => v == null || v <= Number(todayWIB().slice(0, 4)), 'Tahun mulai tidak boleh di depan tahun ini'),
  omzet_rentang: z.enum(OMZET_RENTANG).nullable().optional(),
  tenaga_kerja_rentang: z.enum(TENAGA_KERJA_RENTANG).nullable().optional(),
  memiliki_nib: z.boolean().nullable().optional(), instagram: sosial('instagram.com'), tiktok: sosial('tiktok.com'),
  sumber: z.enum(['kurasi', 'satudata', 'loket']), sumber_ref: opsional(200),
  nomor: z.string().transform(v => v.replace(/[\s.()\-]/g, ''))
    .pipe(z.string().regex(/^\+?[0-9]{8,20}$/)).nullable().optional(),
  foto: z.array(fotoSchema).max(10).optional(),
  produk: z.array(produkSchema).max(20).optional(),
}).strict();
type IsiProfil = Pick<z.infer<typeof profilDasarSchema>, 'jenis' | 'kategori' | 'foto'>;
export function periksaProfil(p: IsiProfil, ctx: z.RefinementCtx) {
  if (!kategoriSah(p.jenis, p.kategori))
    ctx.addIssue({ code: 'custom', path: ['kategori'], message: 'Kategori tidak sesuai dengan jenis usaha' });
  if ((p.foto ?? []).filter(f => f.utama).length > 1)
    ctx.addIssue({ code: 'custom', path: ['foto'], message: 'Hanya satu foto yang boleh jadi foto utama' });
}
export const profilSchema = profilDasarSchema.superRefine(periksaProfil);
export const versiSchema = z.object({ expected_version: z.number().int().min(1), operasi_id: z.uuid() }).strict();
export const simpanSchema = z.object({ data: profilSchema, operasi_id: z.uuid(), profil_id: z.uuid().optional(),
  expected_version: z.number().int().min(1).optional(),
}).strict().refine(b => b.profil_id ? b.expected_version !== undefined : b.expected_version === undefined);
export const putusanSchema = versiSchema.extend({
  keputusan: z.enum(['terbit', 'ditolak']), alasan: teks(240).nullable().optional(),
})
  .refine(b => b.keputusan !== 'ditolak' || !!b.alasan);
export const visibilitasSchema = versiSchema.extend({
  aksi: z.enum(['sembunyikan', 'pulihkan']), foto_id: z.uuid().nullable().optional(),
});
export const izinSchema = versiSchema.extend({ status: z.enum(['diberikan', 'dicabut']) });
export const flagSchema = z.object({ pemeriksa_umkm: z.boolean(), operasi_id: z.uuid() }).strict();
export const cursorSchema = z.object({ cursor: z.uuid().optional() }).strict();
export const cariSchema = cursorSchema.extend({ q: teks(200).min(2) });
export type ProfilInput = z.infer<typeof profilSchema>;
