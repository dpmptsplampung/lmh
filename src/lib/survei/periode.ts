// Parameter periode (tanggal WIB inklusif) untuk rute hasil/unduhan survei. Tanggal kalender nyata (2026-02-31 ditolak).
import { z } from 'zod';

const tanggalSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Tanggal tidak valid');

export const periodeSchema = z
  .object({ dari: tanggalSchema, sampai: tanggalSchema })
  .refine((v) => v.dari <= v.sampai, { message: 'dari harus sebelum atau sama dengan sampai', path: ['sampai'] });
