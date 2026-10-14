// Konstanta aplikasi Lampung Maju Hub

// Nama layanan konsultatif (sesuai seed data)
export const LAYANAN = {
  HELPDESK_OSS: 'Helpdesk OSS',
  SERTIFIKASI_HALAL: 'Sertifikasi Halal',
  CS_BPJS: 'BPJS Kesehatan',
  BANK_LAMPUNG: 'Bank Lampung',
  MATCHMAKING_UMKM: 'Matchmaking UMKM',
  INVESTMENT_GALLERY: 'Investment Gallery',
  PERIZINAN_DPMPTSP: 'Non OSS (SiCantik Lampung)',
} as const;

export const LAYANAN_LIST = Object.values(LAYANAN);

// Status kunjungan
export const STATUS_KUNJUNGAN = {
  MENUNGGU: 'menunggu',
  SELESAI: 'selesai',
} as const;

// Status kunjungan lengkap (kolom kunjungan.status; kontrak FO §1.3). Arti: dilayani = sedang ditangani FO atau
// petugas; menunggu = antre di layanan atau di kotak masuk FO.
export const STATUS_KUNJUNGAN_DB = {
  TERJADWAL: 'terjadwal',
  MENUNGGU: 'menunggu',
  DILAYANI: 'dilayani',
  SELESAI: 'selesai',
  BATAL: 'batal',
  NO_SHOW: 'no_show',
  TIDAK_TERLAYANI: 'tidak_terlayani',
} as const;

export type StatusKunjunganDb = (typeof STATUS_KUNJUNGAN_DB)[keyof typeof STATUS_KUNJUNGAN_DB];

// Asal kunjungan (kunjungan.asal): 'online' = sesi chat (Tahap C).
export const ASAL_KUNJUNGAN = {
  WALK_IN: 'walk_in',
  RESERVASI: 'reservasi',
  ONLINE: 'online',
} as const;

export type AsalKunjungan = (typeof ASAL_KUNJUNGAN)[keyof typeof ASAL_KUNJUNGAN];

export const LABEL_ASAL_KUNJUNGAN: Record<AsalKunjungan, string> = {
  walk_in: 'Walk-in',
  reservasi: 'Reservasi',
  online: 'Online (chat)',
};

// Status tiket antrean (tiket_antrean.status). 'dikembalikan' (dikembalikan petugas ke FO) dan 'dialihkan'
// (dipindah Admin, lihat dialihkan_ke) adalah status AKHIR.
export const STATUS_TIKET = {
  MENUNGGU: 'menunggu',
  DIPANGGIL: 'dipanggil',
  DILAYANI: 'dilayani',
  SELESAI: 'selesai',
  BATAL: 'batal',
  NO_SHOW: 'no_show',
  TIDAK_TERLAYANI: 'tidak_terlayani',
  DIKEMBALIKAN: 'dikembalikan',
  DIALIHKAN: 'dialihkan',
} as const;

export type StatusTiket = (typeof STATUS_TIKET)[keyof typeof STATUS_TIKET];

export const LABEL_STATUS_TIKET: Record<StatusTiket, string> = {
  menunggu: 'Menunggu',
  dipanggil: 'Dipanggil',
  dilayani: 'Sedang Dilayani',
  selesai: 'Selesai',
  batal: 'Dibatalkan',
  no_show: 'Tidak Hadir',
  tidak_terlayani: 'Tidak Terlayani',
  dikembalikan: 'Dikembalikan ke Front Office',
  dialihkan: 'Dialihkan ke Layanan Lain',
};

// Status reservasi
export const STATUS_RESERVASI = {
  TERJADWAL: 'terjadwal',
  HADIR: 'hadir',
  DILAYANI: 'dilayani',
  SELESAI: 'selesai',
  BATAL: 'batal',
} as const;

export type StatusReservasi = (typeof STATUS_RESERVASI)[keyof typeof STATUS_RESERVASI];

// Tujuan reservasi
export const TUJUAN_RESERVASI = {
  LOKET: 'loket',
  BERTEMU_SESEORANG: 'bertemu_seseorang',
} as const;

export type TujuanReservasi = (typeof TUJUAN_RESERVASI)[keyof typeof TUJUAN_RESERVASI];

// Status listing UMKM
export const STATUS_LISTING = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  PUBLISHED: 'published',
  NONAKTIF: 'nonaktif',
  EXPIRED: 'expired',
} as const;

// Kategori kebutuhan UMKM
export const KATEGORI_UMKM = {
  bahan_baku: 'Bahan Baku',
  pemasaran: 'Pemasaran',
  modal: 'Modal Usaha',
  peralatan: 'Peralatan',
  pelatihan: 'Pelatihan',
  kemitraan: 'Kemitraan',
  lainnya: 'Lainnya',
} as const;

export type KategoriUMKM = keyof typeof KATEGORI_UMKM;

// Kategori pengunjung — must match pengunjung.kategori CHECK exactly
export const KATEGORI_PENGUNJUNG = {
  Umum: 'Masyarakat Umum',
  UMKM: 'Pelaku Usaha / UMKM',
  Investor: 'Investor / Pelaku Bisnis',
  Instansi: 'Instansi Pemerintah / Swasta',
} as const;

export type KategoriPengunjung = keyof typeof KATEGORI_PENGUNJUNG;

// Status chat
export const STATUS_CHAT = {
  BOT: 'bot',
  ESKALASI: 'eskalasi',
  AKTIF: 'aktif',
  SELESAI: 'selesai',
} as const;

// Status dokumen investasi
export const STATUS_DOKUMEN = {
  AKTIF: 'aktif',
  NONAKTIF: 'nonaktif',
} as const;

// Roles
export const ROLES = {
  PETUGAS: 'petugas',
  ADMIN: 'admin',
  FRONT_OFFICE: 'front_office',
} as const;

// App info
export const APP_NAME = 'Lampung Maju Hub';
export const APP_DESCRIPTION = 'Sistem Digital Pelayanan Terpadu DPMPTSP Provinsi Lampung';

// WhatsApp — fallback jika site_settings (wa_number / wa_default_message) belum diisi
export const WA_NUMBER = '6281234567890';
export const WA_DEFAULT_MESSAGE = 'Halo, saya ingin bertanya tentang layanan DPMPTSP Provinsi Lampung.';

// Kontak resmi — fallback; nilai aktual dibaca dari site_settings
export const CONTACT_EMAIL_FALLBACK = 'info@lmh.lampungprov.go.id';
