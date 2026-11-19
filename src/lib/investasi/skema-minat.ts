import { z } from 'zod';

import { STATUS_MINAT } from './konstanta';

const isianMinat = {
  nama: z.string().trim().min(1).max(200),
  email: z.email().max(254),
  instansi: z.string().trim().max(200).optional(),
  setuju_pdp: z.literal(true),
  operasi_id: z.uuid(),
  situs_web: z.string().optional(),
};

export const pesanIproSchema = z.object({
  ...isianMinat,
  ipro_id: z.uuid(),
  no_hp: z.string().transform(value => value.replace(/[\s.()\-]/g, ''))
    .pipe(z.string().regex(/^\+?[0-9]{8,20}$/)).optional(),
  pesan: z.string().trim().min(10).max(2000),
}).strict();

export const pesanDokumenSchema = z.object({
  ...isianMinat,
  doc_id: z.uuid(),
  pesan: z.string().trim().max(2000).optional(),
}).strict();

export const ubahStatusMinatSchema = z.object({
  status: z.enum(STATUS_MINAT),
  versi: z.number().int().positive().max(2147483647),
}).strict();
