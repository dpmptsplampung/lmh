import { z } from 'zod';
import { versiSchema } from './schemas';

const teks = (max: number) => z.string().trim().min(1).max(max);
export const perusahaanSchema = z.object({ nama: teks(200), jabatan: teks(200), setuju: z.literal(true) }).strict();
export const kebutuhanSchema = z.object({ teks: teks(200), kategori: teks(100),
  kabupaten_kota: z.string().trim().max(100).nullable().optional(), id: z.uuid().optional(),
}).strict();
export const ajukanSchema = z.object({ kebutuhan_id: z.uuid(), profil_ids: z.array(z.uuid()).min(1).max(50),
  operasi_id: z.uuid(),
}).strict();
export const tautkanSchema = z.object({ kode: teks(100) }).strict();
export const aksiPermintaanSchema = versiSchema.extend({ id: z.uuid() });
export const tolakPermintaanSchema = aksiPermintaanSchema.extend({ alasan: teks(240) });
export const hasilPermintaanSchema = z.enum(['belum_diketahui', 'kerja_sama', 'tidak_berlanjut']);
export const catatHasilSchema = z.object({ id: z.uuid(), hasil: hasilPermintaanSchema }).strict();
export const bantuanSchema = z.object({ nama_perusahaan: teks(200), jabatan: teks(200),
  nama_pemohon: teks(200), kontak: z.string().transform(v => v.replace(/[\s.()\-]/g, ''))
    .pipe(z.string().regex(/^\+?[0-9]{8,20}$/)),
  teks: teks(200), kategori: teks(100), kabupaten_kota: z.string().trim().max(100).nullable().optional(),
  profil_id: z.uuid(), operasi_id: z.uuid(),
}).strict();
