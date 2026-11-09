import { z } from 'zod';
import { validasiUrlFoto } from '@/lib/umkm/foto-url';
const teks = (maks: number) => z.string().trim().max(maks);
const opsional = (maks: number) => teks(maks).nullable().optional();
const sosial = (domain: string) => z.string().trim().max(500).transform(v => v || null).nullable().optional()
  .refine(v => {
    if (!v) return true;
    try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      [domain, `www.${domain}`].includes(u.hostname) && u.pathname.length > 1; } catch { return false; }
  }, 'Tautan profil media sosial tidak valid');
export const fotoSchema = z.object({
  asal: z.enum(['satudata', 'eksternal', 'unggahan']),
  url: z.string().trim().max(500).nullable().optional(),
  r2_key: z.string().max(310).nullable().optional(),
}).strict().superRefine((f, ctx) => {
  if (f.asal === 'unggahan') {
    if (f.url || !f.r2_key || !/^umkm-draf\/[A-Za-z0-9_./-]+$/.test(f.r2_key) ||
      f.r2_key.split('/').some(v => !v || v === '.' || v === '..'))
      ctx.addIssue({ code: 'custom', path: ['r2_key'], message: 'Kunci foto privat tidak valid' });
  } else if (f.r2_key || !f.url || !validasiUrlFoto(f.url).ok) {
    ctx.addIssue({ code: 'custom', path: ['url'], message: 'Tautan foto tidak valid' });
  }
});
export const profilSchema = z.object({
  nama: teks(200).min(1), deskripsi: teks(4000), alamat: opsional(500), jenis: teks(100).min(1),
  kategori: teks(100).min(1), spesifik: opsional(100), kabupaten_kota: teks(100).min(1),
  memiliki_nib: z.boolean().nullable().optional(), instagram: sosial('instagram.com'), tiktok: sosial('tiktok.com'),
  sumber: z.enum(['kurasi', 'satudata', 'loket']), sumber_ref: opsional(200),
  nomor: z.string().transform(v => v.replace(/[\s.()\-]/g, ''))
    .pipe(z.string().regex(/^\+?[0-9]{8,20}$/)).nullable().optional(),
  foto: z.array(fotoSchema).max(10).optional(),
}).strict();
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
