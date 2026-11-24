// Kontrak tautan dalam dokumen (anotasi Link PDF) untuk penampil Investment Gallery.
// Koordinat berupa pecahan 0..1 dari sudut KIRI-ATAS halaman (sudah dibalik dari sumbu PDF).
import { z } from 'zod';

export const TautanHalamanSchema = z.object({
  hal: z.number().int().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  /** Nomor slide tujuan (1-based) untuk tautan internal. */
  ke: z.number().int().min(1).optional(),
  /** URL tujuan; hanya http(s). */
  url: z.string().url().max(2048).optional(),
});

export const BerkasTautanSchema = z.object({
  versi: z.literal(1),
  tautan: z.array(TautanHalamanSchema).max(5000),
});

export type TautanHalaman = z.infer<typeof TautanHalamanSchema>;
export type BerkasTautan = z.infer<typeof BerkasTautanSchema>;

export const BERKAS_TAUTAN_KOSONG: BerkasTautan = { versi: 1, tautan: [] };

/** Hanya skema web yang boleh dibuka dari penampil. */
export function urlTautanAman(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
