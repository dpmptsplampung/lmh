import { z } from 'zod';
import { addDaysWIB, todayWIB } from '@/lib/time';

const uuidSchema = z.string().uuid().optional();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD');
const qSchema = z.string().max(100).default('');

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
  ...dateRangeBase,
}).strict();

export const layananOptionsQuerySchema = z.object({}).strict();

export type TicketsQuery = z.infer<typeof ticketsQuerySchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
export type LayananOptionsQuery = z.infer<typeof layananOptionsQuerySchema>;
