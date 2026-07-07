// Konstanta aplikasi Lampung Maju Hub

// Nama layanan konsultatif (sesuai seed data)
export const LAYANAN = {
  HELPDESK_OSS: 'Helpdesk OSS',
  SERTIFIKASI_HALAL: 'Sertifikasi Halal',
  CS_BPJS: 'CS BPJS Kesehatan',
} as const;

export const LAYANAN_LIST = Object.values(LAYANAN);

// Status kunjungan
export const STATUS_KUNJUNGAN = {
  MENUNGGU: 'menunggu',
  SELESAI: 'selesai',
} as const;

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
} as const;

// App info
export const APP_NAME = 'Lampung Maju Hub';
export const APP_DESCRIPTION = 'Sistem Digital Pelayanan Terpadu DPMPTSP Provinsi Lampung';

// WhatsApp — nomor DPMPTSP (ganti dengan nomor asli)
export const WA_NUMBER = '6281234567890';
export const WA_DEFAULT_MESSAGE = 'Halo, saya ingin bertanya tentang layanan DPMPTSP Provinsi Lampung.';
