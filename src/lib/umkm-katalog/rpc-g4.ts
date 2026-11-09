import type {
  BantuanPermintaan, DaftarKebutuhan, DaftarPermintaanSaya, DetailPermintaan, HasilPermintaan,
  InputBantuan, Kebutuhan, MutasiPermintaan, NomorPemohon, PengajuanKontak, Perusahaan,
  RekomendasiKebutuhan, StatusPermintaan,
} from './types-g4';
type Versi = { p_id: string; p_expected_version: number; p_operasi_id: string };
export type RpcG4 = {
  umkm_tahap_b: { args: Record<string, never>; hasil: { aktif: true } };
  umkm_perusahaan_saya: { args: Record<string, never>; hasil: { perusahaan: Perusahaan | null } };
  umkm_simpan_perusahaan: {
    args: { p_nama: string; p_jabatan: string; p_setuju: boolean }; hasil: Perusahaan;
  };
  umkm_kebutuhan_saya: { args: { p_cursor: string | null }; hasil: DaftarKebutuhan };
  umkm_simpan_kebutuhan: { args: { p_teks: string; p_kategori: string; p_kabupaten_kota: string | null;
    p_id: string | null }; hasil: Kebutuhan };
  umkm_tutup_kebutuhan: { args: { p_id: string }; hasil: { id: string; status: 'ditutup' } };
  umkm_cari_rekomendasi: { args: { p_kebutuhan_id: string }; hasil: RekomendasiKebutuhan };
  umkm_ajukan_kontak: { args: { p_kebutuhan_id: string; p_profil_ids: string[]; p_operasi_id: string };
    hasil: PengajuanKontak };
  umkm_permintaan_saya: { args: { p_cursor: string | null }; hasil: DaftarPermintaanSaya };
  umkm_batalkan_permintaan: { args: { p_id: string }; hasil: { id: string; status: 'dibatalkan' } };
  umkm_baca_nomor: { args: { p_permintaan_id: string }; hasil: NomorPemohon };
  umkm_tautkan_akun: { args: { p_kode: string };
    hasil: { id: string; kebutuhan_id: string; status: StatusPermintaan } | { tertaut: false } };
  umkm_detail_permintaan: { args: { p_id: string }; hasil: DetailPermintaan };
  umkm_setujui_dan_buka: { args: Versi; hasil: MutasiPermintaan };
  umkm_tolak_permintaan: { args: Versi & { p_alasan: string }; hasil: MutasiPermintaan };
  umkm_lepas_tahan: { args: Versi; hasil: MutasiPermintaan };
  umkm_tahan_permintaan: { args: Versi & { p_alasan: string }; hasil: MutasiPermintaan };
  umkm_catat_pemberitahuan: { args: { p_id: string }; hasil: { dicatat: true } };
  umkm_catat_hasil: { args: { p_id: string; p_hasil: HasilPermintaan }; hasil: { id: string; hasil: HasilPermintaan } };
  umkm_bantu_permintaan: {
    args: { [K in keyof InputBantuan as `p_${K}`]: InputBantuan[K] }; hasil: BantuanPermintaan;
  };
};
