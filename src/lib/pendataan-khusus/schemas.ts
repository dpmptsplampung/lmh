// Skema zod Pendataan Khusus untuk route Admin (Fase 4). Batas = migrasi 202610300001 (K6).
import { z } from 'zod';
import { BATAS_KHUSUS, JENIS_KHUSUS, jenisButuhOpsi } from './jenis';

const label = z
  .string()
  .trim()
  .min(BATAS_KHUSUS.labelMin, `Label minimal ${BATAS_KHUSUS.labelMin} karakter`)
  .max(BATAS_KHUSUS.labelMaks, `Label maksimal ${BATAS_KHUSUS.labelMaks} karakter`);

const opsi = z.array(z.string().trim().min(1).max(BATAS_KHUSUS.opsiPanjang)).max(BATAS_KHUSUS.opsiMaks);

function opsiTidakKembar(o: string[]): boolean {
  return new Set(o.map((x) => x.toLowerCase())).size === o.length;
}

export const fieldBaruSchema = z
  .object({
    label,
    jenis: z.enum(JENIS_KHUSUS),
    wajib: z.boolean().default(false),
    opsi: opsi.default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (jenisButuhOpsi(v.jenis)) {
      if (v.opsi.length < BATAS_KHUSUS.opsiMin) {
        ctx.addIssue({ code: 'custom', path: ['opsi'], message: `Pilihan minimal ${BATAS_KHUSUS.opsiMin} butir` });
      } else if (!opsiTidakKembar(v.opsi)) {
        ctx.addIssue({ code: 'custom', path: ['opsi'], message: 'Butir pilihan tidak boleh kembar' });
      }
    } else if (v.opsi.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['opsi'], message: 'Opsi hanya untuk pilihan tunggal/ganda' });
    }
  });

// PATCH: jenis TIDAK ada (jenis tidak dapat diubah; DB juga menegakkan untuk isian yang pernah diisi).
export const fieldUbahSchema = z
  .object({
    label: label.optional(),
    wajib: z.boolean().optional(),
    opsi: opsi.optional(),
    tersembunyi: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Tidak ada perubahan' })
  .refine((v) => v.opsi === undefined || opsiTidakKembar(v.opsi), { path: ['opsi'], message: 'Butir pilihan tidak boleh kembar' });

export const urutanSchema = z
  .object({ urutan: z.array(z.uuid()).min(1).max(BATAS_KHUSUS.isianPerLayanan) })
  .strict()
  .refine((v) => new Set(v.urutan).size === v.urutan.length, { path: ['urutan'], message: 'Urutan memuat id kembar' });

export type FieldBaruInput = z.infer<typeof fieldBaruSchema>;
export type FieldUbahInput = z.infer<typeof fieldUbahSchema>;
