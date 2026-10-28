// Pendataan Khusus (Fase 4, spec §7): jenis isian dan tipe bersama. Modul murni (tanpa React/Supabase).
// Batas (Keputusan pelaksana K6) harus sama dengan migrasi 202610300001.

export const JENIS_KHUSUS = [
  'teks_singkat',
  'teks_panjang',
  'angka',
  'tanggal',
  'pilihan_tunggal',
  'pilihan_ganda',
  'ya_tidak',
] as const;

export type JenisKhusus = (typeof JENIS_KHUSUS)[number];

export const LABEL_JENIS: Record<JenisKhusus, string> = {
  teks_singkat: 'Teks singkat',
  teks_panjang: 'Teks panjang',
  angka: 'Angka',
  tanggal: 'Tanggal',
  pilihan_tunggal: 'Pilihan tunggal',
  pilihan_ganda: 'Pilihan ganda',
  ya_tidak: 'Ya / Tidak',
};

export const BATAS_KHUSUS = {
  labelMin: 2,
  labelMaks: 100,
  teksSingkat: 200,
  teksPanjang: 2000,
  angkaMaks: 1_000_000_000_000,
  opsiMin: 2,
  opsiMaks: 20,
  opsiPanjang: 100,
  isianPerLayanan: 40,
} as const;

export function jenisButuhOpsi(jenis: string): boolean {
  return jenis === 'pilihan_tunggal' || jenis === 'pilihan_ganda';
}

/** Satu baris pendataan_khusus_field. */
export interface FieldKhusus {
  id: string;
  layanan_id: string;
  label: string;
  jenis: JenisKhusus;
  wajib: boolean;
  opsi: string[];
  urut: number;
  tersembunyi: boolean;
  pernah_diisi: boolean;
}

export type NilaiKhusus = string | number | boolean | string[];

const adalahJenis = (v: unknown): v is JenisKhusus => typeof v === 'string' && (JENIS_KHUSUS as readonly string[]).includes(v);

/** Normalisasi baris DB/JSON menjadi FieldKhusus (opsi non-array menjadi []). */
export function petaFieldKhusus(r: Record<string, unknown>): FieldKhusus {
  return {
    id: String(r.id ?? ''),
    layanan_id: String(r.layanan_id ?? ''),
    label: String(r.label ?? ''),
    jenis: adalahJenis(r.jenis) ? r.jenis : 'teks_singkat',
    wajib: r.wajib === true,
    opsi: Array.isArray(r.opsi) ? r.opsi.filter((o): o is string => typeof o === 'string') : [],
    urut: typeof r.urut === 'number' ? r.urut : Number(r.urut) || 0,
    tersembunyi: r.tersembunyi === true,
    pernah_diisi: r.pernah_diisi === true,
  };
}
