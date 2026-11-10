// Konstanta taksonomi dan rentang profil UMKM. Daftar yang sama disalin sebagai literal ke SQL
// (migrasi 202611100001); ubah keduanya bersamaan.
export const JENIS_USAHA = ['Produk', 'Bahan Baku', 'Jasa'] as const;
export type JenisUsaha = (typeof JENIS_USAHA)[number];

export const KATEGORI_PER_JENIS: Readonly<Record<JenisUsaha, readonly string[]>> = {
  Produk: [
    'Makanan Olahan', 'Minuman Olahan', 'Pakaian & Tekstil', 'Kerajinan & Suvenir',
    'Mebel & Produk Kayu', 'Bahan Bangunan Olahan', 'Produk Logam & Alat',
    'Kosmetik, Herbal & Kebersihan', 'Kemasan', 'Tanaman & Hewan Hias', 'Grosir Barang Konsumsi',
  ],
  'Bahan Baku': [
    'Hasil Perkebunan', 'Tanaman Pangan', 'Sayur & Buah Segar', 'Peternakan', 'Perikanan',
    'Kayu, Bambu & Rotan', 'Pangan Setengah Jadi', 'Galian & Bahan Alam Bangunan',
    'Barang Bekas & Daur Ulang', 'Pupuk, Bibit & Pakan',
  ],
  Jasa: [
    'Katering & Nasi Kotak', 'Penjahitan Pesanan', 'Angkutan & Logistik',
    'Kebersihan, Laundry & Pertamanan', 'Percetakan, Sablon & Desain', 'Bengkel, Las & Perbaikan',
    'Konstruksi & Pertukangan', 'Acara & Dokumentasi', 'Jasa Pertanian & Perikanan',
    'Pelatihan & Jasa Profesional',
  ],
};

export function kategoriSah(jenis: string, kategori: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(KATEGORI_PER_JENIS, jenis)) return false;
  return KATEGORI_PER_JENIS[jenis as JenisUsaha].includes(kategori);
}

export const BENTUK_USAHA = ['Perorangan', 'CV', 'PT', 'Firma', 'Yayasan', 'NV', 'Lainnya'] as const;
export type BentukUsaha = (typeof BENTUK_USAHA)[number];

export const OMZET_RENTANG = ['sd_10jt', '10_50jt', '50_300jt', '300jt_2m', '2_15m', '15_50m'] as const;
export type OmzetRentang = (typeof OMZET_RENTANG)[number];
export const LABEL_OMZET: Record<OmzetRentang, string> = {
  sd_10jt: 'Sampai Rp10 juta',
  '10_50jt': 'Lebih dari Rp10 juta sampai Rp50 juta',
  '50_300jt': 'Lebih dari Rp50 juta sampai Rp300 juta',
  '300jt_2m': 'Lebih dari Rp300 juta sampai Rp2 miliar',
  '2_15m': 'Lebih dari Rp2 miliar sampai Rp15 miliar',
  '15_50m': 'Lebih dari Rp15 miliar sampai Rp50 miliar',
};

export const TENAGA_KERJA_RENTANG = ['1-4', '5-19', '20-99', '100+'] as const;
export type TenagaKerjaRentang = (typeof TENAGA_KERJA_RENTANG)[number];
export const LABEL_TENAGA_KERJA: Record<TenagaKerjaRentang, string> = {
  '1-4': '1 sampai 4 orang',
  '5-19': '5 sampai 19 orang',
  '20-99': '20 sampai 99 orang',
  '100+': '100 orang atau lebih',
};

export const PERIODE_KAPASITAS = ['hari', 'minggu', 'bulan', 'tahun'] as const;
export type PeriodeKapasitas = (typeof PERIODE_KAPASITAS)[number];

// Saran isian satuan (datalist), bukan batasan.
export const SARAN_SATUAN = [
  'kg', 'ton', 'liter', 'pcs', 'unit', 'paket', 'porsi', 'lembar', 'meter', 'karung',
] as const;

export function formatKapasitas(p: {
  kapasitas_jumlah: number; kapasitas_satuan: string; kapasitas_periode: PeriodeKapasitas;
}): string {
  return `Kapasitas ${new Intl.NumberFormat('id-ID').format(p.kapasitas_jumlah)} ${p.kapasitas_satuan} per ${p.kapasitas_periode} (menurut UMKM)`;
}
