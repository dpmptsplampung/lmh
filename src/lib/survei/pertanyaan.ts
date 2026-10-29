// Konfigurasi pertanyaan "Pesan Perilaku" (survei terpadu Fase A): SPAK (5 butir, skala 1-6) dan SKM (11 unsur,
// skala 1-4). Teks, label skala, dan pembagian langkah PERSIS Lampiran A spec
// (docs/superpowers/specs/2026-10-26-survei-terpadu-design.md); dikunci uji golden di pertanyaan.test.ts.
// Rentang di sini harus sama dengan CHECK di migrasi 202611020002 dan konstanta di RPC kirim_survei
// (diperiksa supabase/migrations/survei_jawaban.test.ts). Modul murni: aman dipakai klien maupun server.

export type KunciSpak = 'p1' | 'p2' | 'p3' | 'p4' | 'p5';
export type KunciSkm = 'u1' | 'u2' | 'u3' | 'u4' | 'u5' | 'u6' | 'u7' | 'u8' | 'u9' | 'u10' | 'u11';
export type Jawaban = Partial<Record<KunciSpak | KunciSkm, number>>;

/** Rentang nilai sah per survei (inklusif). SPAK 6 = Sangat Setuju; SKM 4 = Sangat Baik. */
export const RENTANG = {
  spak: { min: 1, max: 6 },
  skm: { min: 1, max: 4 },
} as const;

export const SKALA_SPAK: readonly { nilai: 1 | 2 | 3 | 4 | 5 | 6; label: string }[] = [
  { nilai: 1, label: 'Sangat Tidak Setuju' },
  { nilai: 2, label: 'Tidak Setuju' },
  { nilai: 3, label: 'Kurang Setuju' },
  { nilai: 4, label: 'Cukup Setuju' },
  { nilai: 5, label: 'Setuju' },
  { nilai: 6, label: 'Sangat Setuju' },
];

// Urutan sumber (Lampiran A) dari yang terbaik. Wizard menampilkannya terbalik (Kurang di kiri, Sangat Baik di kanan),
// lihat components/survei/SegmenSkm.tsx.
export const SKALA_SKM: readonly { nilai: 4 | 3 | 2 | 1; label: string }[] = [
  { nilai: 4, label: 'Sangat Baik' },
  { nilai: 3, label: 'Baik' },
  { nilai: 2, label: 'Cukup' },
  { nilai: 1, label: 'Kurang' },
];

export const PERTANYAAN_SPAK: readonly { kunci: KunciSpak; teks: string }[] = [
  { kunci: 'p1', teks: 'Tidak ada diskriminasi pelayanan pada unit layanan ini' },
  { kunci: 'p2', teks: 'Tidak ada pelayanan diluar prosedur/kecurangan pelayanan pada unit layanan ini' },
  { kunci: 'p3', teks: 'Tidak ada penerimaan imbalan uang/barang/fasilitas diluar ketentuan yang berlaku pada unit layanan ini' },
  { kunci: 'p4', teks: 'Tidak ada pungutan liar (pungli) pada unit layanan ini' },
  { kunci: 'p5', teks: 'Tidak ada percaloan/perantara tidak resmi pada unit layanan ini' },
];

export const UNSUR_SKM: readonly { kunci: KunciSkm; teks: string }[] = [
  { kunci: 'u1', teks: 'Persyaratan Pelayanan' },
  { kunci: 'u2', teks: 'Prosedur Pelayanan' },
  { kunci: 'u3', teks: 'Waktu Pelayanan' },
  { kunci: 'u4', teks: 'Tarif Pelayanan' },
  { kunci: 'u5', teks: 'Produk/Hasil Pelayanan' },
  { kunci: 'u6', teks: 'Kemampuan Petugas Pelayanan' },
  { kunci: 'u7', teks: 'Perilaku Petugas Pelayanan' },
  { kunci: 'u8', teks: 'Kualitas Sarana dan Prasarana' },
  { kunci: 'u9', teks: 'Mekanisme Pengaduan' },
  { kunci: 'u10', teks: 'Transparansi Pelayanan' },
  { kunci: 'u11', teks: 'Integritas Petugas Pelayanan' },
];

export const SURVEI: {
  spak: { judul: string; instruksi: string };
  skm: { judul: string };
} = {
  spak: {
    judul: 'Survey Persepsi Anti Korupsi',
    instruksi: 'Berikan penilaian Anda dari skala 1-6 dengan keterangan sebagai berikut',
  },
  skm: {
    judul: 'Survey Kepuasan Masyarakat',
  },
};

/** Lima langkah wizard: SPAK 3+2 butir, SKM 4+4+3 unsur. Setiap kunci tepat satu kali, berurutan. */
export const LANGKAH: readonly { survei: 'spak' | 'skm'; kunci: readonly (KunciSpak | KunciSkm)[] }[] = [
  { survei: 'spak', kunci: ['p1', 'p2', 'p3'] },
  { survei: 'spak', kunci: ['p4', 'p5'] },
  { survei: 'skm', kunci: ['u1', 'u2', 'u3', 'u4'] },
  { survei: 'skm', kunci: ['u5', 'u6', 'u7', 'u8'] },
  { survei: 'skm', kunci: ['u9', 'u10', 'u11'] },
];
