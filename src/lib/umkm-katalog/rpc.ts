import type { SupabaseClient } from '@supabase/supabase-js';
import type { DaftarTugas, Detail, Mutasi, ProfilPublik, DetailPesan, DetailLaporan,
  MutasiPekerjaan, RingkasanPengawasan, DaftarJejakPengawasan, DaftarProfilPengawasan, MutasiDarurat,
  StatusStatistik, LaporanStatistik } from './types';
import type { ProfilInput } from './schemas';
import type { RpcG4 } from './rpc-g4';
type Versi = { p_profil_id: string; p_expected_version: number; p_operasi_id: string };
export type RpcKontrak = RpcG4 & {
  umkm_suka: { args: { p_profil_id: string; p_aktif: boolean };
    hasil: { profil_id: string; suka_saya: boolean; suka: number } };
  umkm_status_suka: { args: { p_profil_id: string }; hasil: { suka_saya: boolean } };
  umkm_laporan_statistik: { args: { p_cursor: string | null }; hasil: LaporanStatistik };
  umkm_ekspor_statistik: { args: Record<string, never>; hasil: LaporanStatistik };
  umkm_atur_telemetri: { args: { p_aktif: boolean; p_versi_naskah: string; p_kebijakan_terbit: boolean };
    hasil: StatusStatistik };
  umkm_profil_publik: { args: { p_profil_id: string }; hasil: ProfilPublik };
  umkm_daftar_tugas: { args: { p_cursor: string | null }; hasil: DaftarTugas };
  umkm_cari_profil: { args: { p_q: string; p_cursor: string | null }; hasil: DaftarTugas };
  umkm_detail_tugas: { args: { p_profil_id: string }; hasil: Detail };
  umkm_simpan_profil: {
    args: { p_data: ProfilInput; p_operasi_id: string; p_profil_id: string | null; p_expected_version: number | null };
    hasil: Mutasi;
  };
  umkm_ambil_tugas: { args: Versi; hasil: Mutasi };
  umkm_putuskan_profil: { args: Versi & { p_keputusan: 'terbit' | 'ditolak'; p_alasan: string | null }; hasil: Mutasi };
  umkm_ubah_visibilitas: {
    args: Versi & { p_aksi: 'sembunyikan' | 'pulihkan'; p_foto_id: string | null }; hasil: Mutasi;
  };
  umkm_ubah_izin: { args: Versi & { p_status: 'diberikan' | 'dicabut' }; hasil: Mutasi };
  umkm_akses_kontak_petugas: { args: { p_profil_id: string }; hasil: { nomor: string | null } };
  umkm_atur_pemeriksa: {
    args: { p_petugas_id: string; p_pemeriksa_umkm: boolean; p_operasi_id: string };
    hasil: { id: string; pemeriksa_umkm: boolean };
  };
  umkm_kirim_pesan_kontak: {
    args: { p_nama: string; p_perusahaan: string; p_nomor: string; p_pesan: string; p_operasi_id: string;
      p_profil_id: string | null; p_kata_kunci: string | null }; hasil: { id: string };
  };
  umkm_laporkan: {
    args: { p_profil_id: string; p_alasan: string; p_operasi_id: string; p_foto_id: string | null;
      p_catatan: string | null }; hasil: { id: string };
  };
  umkm_detail_pesan: { args: { p_id: string }; hasil: DetailPesan };
  umkm_detail_laporan: { args: { p_id: string }; hasil: DetailLaporan };
  umkm_ambil_pekerjaan: { args: { p_jenis: 'pesan' | 'laporan' | 'permintaan'; p_id: string;
    p_expected_version: number; p_operasi_id: string };
    hasil: MutasiPekerjaan | import('./types-g4').MutasiPermintaan };
  umkm_selesaikan_pekerjaan: { args: { p_jenis: 'pesan' | 'laporan'; p_id: string;
    p_expected_version: number; p_operasi_id: string }; hasil: MutasiPekerjaan };
  umkm_ringkasan_pengawasan: { args: Record<string, never>; hasil: RingkasanPengawasan };
  umkm_jejak_pengawasan: { args: { p_cursor: string | null }; hasil: DaftarJejakPengawasan };
  umkm_cari_pengawasan: { args: { p_q: string; p_cursor: string | null }; hasil: DaftarProfilPengawasan };
  umkm_tindakan_darurat: { args: Versi & { p_aksi: 'sembunyikan' | 'catat_pencabutan'; p_alasan: string };
    hasil: MutasiDarurat };
  umkm_selesaikan_mendesak: { args: Versi; hasil: MutasiDarurat };
};
export async function panggilRpc<K extends keyof RpcKontrak>(
  client: Pick<SupabaseClient, 'rpc'>, nama: K, args: RpcKontrak[K]['args'],
) {
  const { data, error } = await client.rpc(nama, args);
  return { data: data as RpcKontrak[K]['hasil'] | null, error };
}
