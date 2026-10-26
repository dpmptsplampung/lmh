// Skema zod bersama untuk API admin Layanan/Instansi/website terkait (Fase 1, fondasi layanan dinamis).
// Batas panjang mengikuti CHECK di migrasi 202610270001; di sini ditambah .trim() + panjang minimal SETELAH trim
// karena CHECK DB masih menerima teks yang hanya spasi.
import { z } from 'zod';

const URL_HTTPS = /^https:\/\/\S+$/;

/** Teks opsional: dipangkas, string kosong -> null. */
const teksOpsional = (maks: number) =>
  z.string().trim().max(maks).transform((v) => (v === '' ? null : v)).nullable();

const urlHttps = z.string().trim().max(500).regex(URL_HTTPS, 'URL harus diawali https://');

// Prefiks antrean (migrasi 202610140003): TEPAT 2 huruf A-Z (CHECK ^[A-Z]{2}$ + UNIQUE di DB). Kosong / null = minta kode
// otomatis (trigger trg_layanan_isi_prefiks). Huruf kecil diubah ke kapital; 1 atau 3 huruf, angka, atau simbol ditolak.
export const PESAN_PREFIKS = 'Prefiks antrean harus tepat 2 huruf (A-Z), atau dikosongkan agar dibuat otomatis';
const prefiksSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.string().regex(/^[A-Z]{2}$/, PESAN_PREFIKS).nullable())
  .nullable();

export const tautanSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: urlHttps,
});
export type TautanInput = z.infer<typeof tautanSchema>;

export const TAUTAN_MAKS = 10;
export const tautanDaftarSchema = z.object({ tautan: z.array(tautanSchema).max(TAUTAN_MAKS) }).strict();

/** Seluruh field konten/pengaturan layanan. POST memakai `layananBuatSchema`, PATCH `layananUbahSchema`. */
export const layananKontenSchema = z.object({
  nama: z.string().trim().min(2).max(100),
  nomor_loket: z.string().trim().min(1).max(20).nullable(),
  prefiks: prefiksSchema,
  status_tampilan: z.enum(['aktif', 'coming_soon', 'nonaktif']),
  tampil_di_layar: z.boolean(),
  // Saklar etalase homepage (migrasi 202610280001): kartu layanan tampil di halaman utama.
  tampil_di_homepage: z.boolean(),
  punya_antrean: z.boolean(),
  punya_chat: z.boolean(),
  // Formulir Pendataan wajib saat layanan diselesaikan (migrasi 202610140012; ditegakkan layanan_selesai).
  // null = "tanpa formulir tetap"; tidak lagi ditebak dari nama (trigger tebakan dicabut di 202610270001).
  form_pendataan: z.enum(['oss', 'perizinan']).nullable(),
  instansi_id: z.uuid().nullable(),
  slug: z.string().max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug hanya huruf kecil, angka, dan tanda hubung'),
  deskripsi: teksOpsional(4000),
  urutan: z.number().int().min(0).max(9999),
  konten_sumber_url: urlHttps.nullable(),
});

export const layananUbahSchema = layananKontenSchema.partial().strict();
export const layananBuatSchema = layananKontenSchema.partial().required({ nama: true }).strict();

export const instansiSchema = z.object({
  nama: z.string().trim().min(2).max(150),
  singkatan: teksOpsional(30),
});
export const instansiBuatSchema = instansiSchema.partial({ singkatan: true }).strict();
export const instansiUbahSchema = instansiSchema.partial().strict();

export const arsipSchema = z.object({ arsip: z.boolean() }).strict();

export type LayananTautan = { label: string; url: string };

/** Baris GET /api/admin/layanan. */
export type LayananAdmin = {
  id: string;
  nama: string;
  tipe: string;
  aktif: boolean;
  penyerta: boolean;
  status_tampilan: 'aktif' | 'coming_soon' | 'nonaktif';
  tampil_di_layar: boolean;
  tampil_di_homepage: boolean;
  punya_antrean: boolean;
  punya_chat: boolean;
  chatbot_aktif: boolean;
  nomor_loket: string | null;
  prefiks_antrean: string | null;
  form_pendataan: 'oss' | 'perizinan' | null;
  instansi_id: string | null;
  slug: string;
  deskripsi: string | null;
  urutan: number;
  konten_sumber_url: string | null;
  konten_diperbarui_at: string | null;
  diarsipkan_at: string | null;
  website_terkait: LayananTautan[];
};

export type InstansiRow = { id: string; nama: string; singkatan: string | null };
