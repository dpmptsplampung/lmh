// Aturan profil pengunjung (K12): SEMUA field wajib terisi benar. Satu definisi dipakai gerbang kelengkapan
// (`ProfileCompletenessGate`) untuk menilai profil tersimpan sekaligus memvalidasi isian form.
//
// Pasangan di database: fungsi `pengunjung_profil_lengkap(...)` (migrasi 202610140006_pernyataan_kebenaran) memakai
// aturan yang sama (tanpa NIK) untuk MENGUNCI Nama Lengkap setelah profil lengkap. Ubah keduanya bersamaan.
import { z } from 'zod';
import { KATEGORI_PENGUNJUNG, type KategoriPengunjung } from '@/lib/constants';

export function isPhoneValid(phone: string): boolean {
  const cleaned = phone.replace(/[\s-]/g, '');
  // Harus diawali 08, 628, atau +628, diikuti 7 sampai 12 digit (minimal 10 digit total)
  return /^(?:\+?62|62|0)8[1-9]\d{7,12}$/.test(cleaned);
}

export const NAMA_MIN_KARAKTER = 3;

const KUNCI_KATEGORI = Object.keys(KATEGORI_PENGUNJUNG) as [KategoriPengunjung, ...KategoriPengunjung[]];

export const profilPengunjungSchema = z.object({
  nama: z
    .string()
    .trim()
    .min(NAMA_MIN_KARAKTER, `Nama Lengkap wajib diisi dengan benar (minimal ${NAMA_MIN_KARAKTER} karakter).`)
    .max(120, 'Nama Lengkap terlalu panjang (maksimal 120 karakter).'),
  no_hp: z
    .string()
    .trim()
    .min(1, 'Nomor HP / WhatsApp wajib diisi.')
    .refine(isPhoneValid, 'Nomor HP tidak valid. Harus diawali 08 / 628 / +628 dan minimal 10 digit.'),
  asal_instansi: z
    .string()
    .trim()
    .min(1, 'Asal / Instansi wajib diisi.')
    .max(200, 'Asal / Instansi terlalu panjang (maksimal 200 karakter).'),
  kategori: z.enum(KUNCI_KATEGORI, { error: 'Kategori Pengunjung wajib dipilih.' }),
  email: z
    .string()
    .trim()
    .min(1, 'Email wajib diisi.')
    .pipe(z.email('Format email tidak valid.'))
    .pipe(z.string().max(254, 'Email terlalu panjang.')),
});

export type ProfilPengunjung = z.infer<typeof profilPengunjungSchema>;

export type HasilValidasiProfil =
  | { ok: true; data: ProfilPengunjung }
  | { ok: false; pesan: string };

/** Validasi isian form; `pesan` = galat pertama (berbahasa Indonesia, siap tampil). */
export function validasiProfil(masukan: Record<keyof ProfilPengunjung, unknown>): HasilValidasiProfil {
  const hasil = profilPengunjungSchema.safeParse(masukan);
  if (hasil.success) return { ok: true, data: hasil.data };
  return { ok: false, pesan: hasil.error.issues[0]?.message ?? 'Data profil belum lengkap.' };
}

/** Profil tersimpan dianggap lengkap bila SEMUA field wajib lolos validasi (null/kosong = tidak lengkap). */
export function profilLengkap(profil: Partial<Record<keyof ProfilPengunjung, string | null | undefined>> | null): boolean {
  if (!profil) return false;
  return profilPengunjungSchema.safeParse({
    nama: profil.nama ?? '',
    no_hp: profil.no_hp ?? '',
    asal_instansi: profil.asal_instansi ?? '',
    kategori: profil.kategori ?? '',
    email: profil.email ?? '',
  }).success;
}
