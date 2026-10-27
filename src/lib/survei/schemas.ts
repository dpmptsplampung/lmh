// Skema zod untuk POST /api/survei/kirim (survei terpadu Fase A). Kunci dan rentang DIBANGUN dari konstanta
// pertanyaan.ts, bukan ditulis ulang, supaya skema, wizard, dan RPC kirim_survei tidak bisa berbeda diam-diam
// (kecocokan dengan CHECK/RPC dijaga supabase/migrations/survei_jawaban.test.ts). Semua objek `.strict()`: kunci asing ditolak.
// Modul murni (tanpa server-only): tipe hasilnya aman diimpor klien.
import { z } from 'zod';
import { PERTANYAAN_SPAK, RENTANG, UNSUR_SKM, type KunciSkm, type KunciSpak } from './pertanyaan';

/** Objek `{ kunci: bilangan bulat min..maks }` untuk semua kunci, wajib lengkap dan tanpa kunci lain. */
function objekSkala<K extends string>(kunci: readonly K[], rentang: { readonly min: number; readonly max: number }) {
  const bentuk = Object.fromEntries(
    kunci.map((k) => [k, z.number().int().min(rentang.min).max(rentang.max)]),
  ) as Record<K, z.ZodNumber>;
  return z.object(bentuk).strict();
}

export const kirimSurveiSchema = z
  .object({
    // Token undangan = 64 karakter heksadesimal; batas longgar 32-128 cukup untuk menolak sampah sebelum menyentuh RPC.
    token: z.string().min(32).max(128),
    spak: objekSkala<KunciSpak>(PERTANYAAN_SPAK.map((p) => p.kunci), RENTANG.spak),
    skm: objekSkala<KunciSkm>(UNSUR_SKM.map((u) => u.kunci), RENTANG.skm),
  })
  .strict();

export type KirimSurveiInput = z.infer<typeof kirimSurveiSchema>;
