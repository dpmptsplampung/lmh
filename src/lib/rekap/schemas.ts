import { z } from 'zod';
import { addDaysWIB, todayWIB } from '@/lib/time';

const uuidSchema = z.string().uuid().optional();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD');
const qSchema = z.string().max(100).default('');
const exportTabSchema = z.enum(['umum', 'oss', 'perizinan', 'layanan']).default('layanan');

const dateRangeBase = {
  dari: dateSchema.default(() => addDaysWIB(-30)),
  sampai: dateSchema.default(() => todayWIB()),
};

export const ticketsQuerySchema = z.object({
  layanan_id: uuidSchema,
  q: qSchema,
  ...dateRangeBase,
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

export const exportQuerySchema = z.object({
  layanan_id: uuidSchema,
  q: qSchema,
  tab: exportTabSchema,
  ...dateRangeBase,
}).strict();

export const layananOptionsQuerySchema = z.object({}).strict();

export type TicketsQuery = z.infer<typeof ticketsQuerySchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
export type LayananOptionsQuery = z.infer<typeof layananOptionsQuerySchema>;

// ---------------------------------------------------------------------------
// Rekap penanganan (FO / petugas layanan) dan performa (Tahap D).
// ---------------------------------------------------------------------------

/** Rentang maksimum satu permintaan rekap penanganan/performa (hari kalender, inklusif). */
export const MAKS_RENTANG_HARI = 366;

export function jumlahHariRentang(dari: string, sampai: string): number {
  const a = Date.UTC(+dari.slice(0, 4), +dari.slice(5, 7) - 1, +dari.slice(8, 10));
  const b = Date.UTC(+sampai.slice(0, 4), +sampai.slice(5, 7) - 1, +sampai.slice(8, 10));
  return Math.round((b - a) / 86_400_000) + 1;
}

const rentangValid = (v: { dari: string; sampai: string }) =>
  v.sampai >= v.dari && jumlahHariRentang(v.dari, v.sampai) <= MAKS_RENTANG_HARI;
const PESAN_RENTANG = `Rentang tanggal tidak valid (sampai >= dari, maksimal ${MAKS_RENTANG_HARI} hari)`;

const peranSchema = z.enum(['fo', 'layanan']).default('fo');

export const penangananQuerySchema = z
  .object({
    peran: peranSchema,
    petugas_id: uuidSchema,
    layanan_id: uuidSchema,
    ...dateRangeBase,
    page: z.coerce.number().int().min(0).default(0),
    page_size: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine(rentangValid, { message: PESAN_RENTANG, path: ['sampai'] });

export const penangananExportQuerySchema = z
  .object({
    peran: peranSchema,
    petugas_id: uuidSchema,
    layanan_id: uuidSchema,
    ...dateRangeBase,
  })
  .strict()
  .refine(rentangValid, { message: PESAN_RENTANG, path: ['sampai'] });

export const performaQuerySchema = z
  .object({ ...dateRangeBase })
  .strict()
  .refine(rentangValid, { message: PESAN_RENTANG, path: ['sampai'] });

export type PenangananQuery = z.infer<typeof penangananQuerySchema>;
export type PenangananExportQuery = z.infer<typeof penangananExportQuerySchema>;
export type PerformaQuery = z.infer<typeof performaQuerySchema>;
