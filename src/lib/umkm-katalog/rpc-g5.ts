import type { ProfilPemilikInput } from './schemas-g5';
import type { DetailKlaim, DetailUsaha, MutasiKlaim, MutasiPemilik, PenerimaPemilik,
  StatistikPemilik, Usaha } from './types-g5';
type Profil = { p_profil_id: string };
type Versi = { p_expected_version: number; p_operasi_id: string };
export type RpcG5 = {
  umkm_tahap_c: { args: Record<string, never>; hasil: { aktif: boolean } };
  umkm_usaha_saya: { args: { p_cursor: string | null }; hasil: { items: Usaha[]; next_cursor: string | null } };
  umkm_detail_usaha: { args: Profil; hasil: DetailUsaha };
  umkm_daftar_usaha: { args: { p_data: ProfilPemilikInput; p_operasi_id: string }; hasil: MutasiPemilik };
  umkm_simpan_draf: { args: Profil & Versi & { p_data: ProfilPemilikInput }; hasil: MutasiPemilik };
  umkm_cabut_izin_pemilik: { args: Profil & Versi; hasil: MutasiPemilik };
  umkm_klaim_profil: { args: Profil & { p_alasan: string; p_operasi_id: string }; hasil: MutasiKlaim };
  umkm_akses_draf_pemilik: { args: Profil; hasil: { diizinkan: true } };
  umkm_statistik_pemilik: { args: Profil; hasil: StatistikPemilik };
  umkm_perusahaan_penerima: { args: Profil & { p_cursor: string | null }; hasil: PenerimaPemilik };
  umkm_detail_klaim: { args: { p_id: string }; hasil: DetailKlaim };
  umkm_ambil_klaim: { args: { p_id: string } & Versi; hasil: MutasiKlaim };
  umkm_putuskan_klaim: { args: { p_id: string; p_keputusan: 'disetujui' | 'ditolak'; p_alasan: string | null }
    & Versi; hasil: MutasiKlaim };
  umkm_cabut_kepemilikan: { args: { p_id: string; p_alasan: string } & Versi; hasil: MutasiKlaim };
};
