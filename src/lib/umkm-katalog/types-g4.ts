import type { Kartu } from './types';

export type StatusPermintaan = 'diajukan' | 'menunggu_izin' | 'nomor_dibuka' | 'ditolak' | 'dibatalkan';
export type HasilPermintaan = 'belum_diketahui' | 'kerja_sama' | 'tidak_berlanjut';
export type Perusahaan = { id: string; nama: string; jabatan: string; diperiksa: boolean };
export type Kebutuhan = {
  id: string; teks: string; kategori: string; kabupaten_kota: string | null;
  status: 'aktif' | 'ditutup'; dibuat_pada: string;
};
export type PermintaanSaya = {
  id: string; kebutuhan_id: string; profil_id: string; kode: string; status: StatusPermintaan;
  versi: number; dibuat_pada: string; alasan_tolak: string | null; profil_nama: string;
  petugas_nama: string | null; petugas_hp_akhir: string | null; tahan_darurat: boolean;
};
export type TugasPermintaan = {
  id: string; jenis: 'permintaan'; nama: string; profil_id: string; profil_nama: string;
  status: StatusPermintaan; versi: number; mendesak: boolean; petugas_id: string | null;
  petugas_nama: string | null; dibuat_pada: string; kode: string;
};
export type DetailPermintaan = TugasPermintaan & {
  kebutuhan: Kebutuhan; perusahaan: Perusahaan;
  pemohon: { nama: string; hp: string | null; email: string | null };
  bantuan: { nama: string; kontak: string } | null;
  tertaut: boolean; dipegang_saya: boolean; pemeriksa_nama: string; profil_versi: number;
  izin_ada: boolean; kontak_ada: boolean; alasan_tolak: string | null;
  pembukaan: { id: string; dibuat_pada: string; hasil: HasilPermintaan; petugas_nama: string } | null;
};
export type MutasiPermintaan = {
  id: string; jenis: 'permintaan'; status: StatusPermintaan; versi: number; tahan_darurat: boolean;
  pembukaan_id: string | null;
};
export type DaftarKebutuhan = { items: Kebutuhan[]; next_cursor: string | null };
export type DaftarPermintaanSaya = { items: PermintaanSaya[]; next_cursor: string | null };
export type PengajuanKontak = {
  items: { id: string; profil_id: string; kode: string; status: StatusPermintaan; versi: number }[];
};
export type BantuanPermintaan = {
  id: string; kebutuhan_id: string; kode: string; status: StatusPermintaan; versi: number;
  kode_tautan: string | null;
};
export type InputBantuan = {
  nama_perusahaan: string; jabatan: string; nama_pemohon: string; kontak: string; teks: string;
  kategori: string; kabupaten_kota: string | null; profil_id: string; operasi_id: string;
};
export type NomorPemohon = { nomor: string; petugas_nama: string; dibuka_pada: string; kode: string };
export type RekomendasiKebutuhan = { items: Kartu[] };
