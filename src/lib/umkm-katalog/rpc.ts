import type { SupabaseClient } from '@supabase/supabase-js';
import type { DaftarTugas, Detail, Mutasi, ProfilPublik } from './types';
import type { ProfilInput } from './schemas';
type Versi = { p_profil_id: string; p_expected_version: number; p_operasi_id: string };
export type RpcKontrak = {
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
};
export async function panggilRpc<K extends keyof RpcKontrak>(
  client: Pick<SupabaseClient, 'rpc'>, nama: K, args: RpcKontrak[K]['args'],
) {
  const { data, error } = await client.rpc(nama, args);
  return { data: data as RpcKontrak[K]['hasil'] | null, error };
}
