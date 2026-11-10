import type { Foto, Produk, Revisi, Status } from './types';

export type StatusPemilik = 'diajukan' | 'disetujui' | 'ditolak';
export type AkunPemilik = { nama: string; hp: string | null; email: string | null };
export type PerubahanUsaha = 'menunggu' | 'ditolak' | null;
export type Usaha = {
  id: string; profil_nama: string; status: Status; versi: number; pemilik_id: string;
  pemilik_status: StatusPemilik; dibuat_pada: string; alasan_tolak: string | null;
  catatan_petugas: string | null; memiliki_nib: boolean | null; perubahan: PerubahanUsaha;
};
// Detail pemilik tidak mengirim identitas pelaku revisi dan pemeriksa foto.
export type RevisiPemilik = Omit<Revisi, 'dibuat_oleh' | 'aktor_uid'>;
export type FotoPemilik = Omit<Foto, 'diperiksa_oleh'>;
export type DetailUsaha = Usaha & {
  revisi: RevisiPemilik | null; foto: FotoPemilik[]; produk: Produk[]; nomor: string | null;
  izin_status: 'diberikan' | 'dicabut' | null;
};
export type PemilikTerdaftar = { id: string; nama: string; versi: number };
export type MutasiPemilik = {
  id: string; versi: number; status: Status; revisi_id: string | null;
  pemilik_id: string | null; pemilik_status: StatusPemilik | null;
};
export type MutasiKlaim = { id: string; jenis: 'klaim'; profil_id: string; status: StatusPemilik; versi: number };
export type TugasKlaim = MutasiKlaim & {
  nama: 'Klaim profil'; profil_nama: string; mendesak: false; petugas_id: string | null;
  petugas_nama: string | null; dibuat_pada: string;
};
export type DetailKlaim = TugasKlaim & {
  pemilik: AkunPemilik; alasan: string; alasan_tolak: string | null; dipegang_saya: boolean;
};
export type AngkaPemilik = { dilihat: number | null; suka: number; permintaan: number; nomor_dibuka: number };
export type StatistikPemilik = AngkaPemilik & {
  telemetri_opsional_aktif: boolean; tren: (AngkaPemilik & { hari: string })[];
};
export type PenerimaPemilik = { items: { nama: string; dibuka_pada: string }[]; next_cursor: string | null };
