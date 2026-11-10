import { z } from 'zod';
import { periksaProfil, profilDasarSchema, versiSchema } from './schemas';
export const profilPemilikSchema = profilDasarSchema.omit({ sumber: true, sumber_ref: true }).superRefine(periksaProfil);
export const daftarUsahaSchema = z.object({ data: profilPemilikSchema, operasi_id: z.uuid() }).strict();
export const drafPemilikSchema = versiSchema.extend({ id: z.uuid(), data: profilPemilikSchema });
export const klaimSchema = z.object({ profil_id: z.uuid(), alasan: z.string().trim().min(1).max(240),
  operasi_id: z.uuid() }).strict();
export const aksiKlaimSchema = versiSchema.extend({ id: z.uuid() });
export const putusanKlaimSchema = aksiKlaimSchema.extend({
  keputusan: z.enum(['disetujui', 'ditolak']), alasan: z.string().trim().max(240).nullable().optional(),
}).refine(b => b.keputusan !== 'ditolak' || !!b.alasan);
export const cabutKepemilikanSchema = aksiKlaimSchema.extend({ alasan: z.string().trim().min(1).max(240) });
export type ProfilPemilikInput = z.infer<typeof profilPemilikSchema>;
