import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

export const BASELINE_FILES = [
  '202607140001_extensions_and_preflight.sql',
  '202607140002_core_schema.sql',
  '202607140003_feature_schema.sql',
  '202607140004_security_and_automation.sql',
  '202607140005_views_and_jobs.sql',
] as const;

export const FORWARD_MIGRATION_FILES = [
  '202607200001_p0_security_governance.sql',
  '202607210001_walkin_kontak_dan_layanan_perizinan.sql',
  '202607240001_pengunjung_no_hp.sql',
  '202607280001_layanan_jadwal.sql',
  '202607280002_chat_pesan_owner_strict.sql',
  '202607280003_faq_petugas_scope.sql',
  '202607280004_chat_pesan_client_uuid.sql',
  '202607280005_antrian_hari_ini.sql',
  '202607290001_observability_error_log.sql',
  '202607290002_faq_reembed.sql',
  '202607290003_antrean_counter.sql',
  '202607290004_petugas_aktif.sql',
  '202607290005_jadwal_harian_beku.sql',
  '202607290006_skm_response_rate.sql',
  '202607290007_pengaduan.sql',
  '202607290008_standar_pelayanan.sql',
  '202607290009_role_front_office.sql',
  '202607290010_jadwal_standby.sql',
  '202607290011_absensi_gerbang.sql',
  '202607290012_layanan_kontak_notifikasi.sql',
  '202607290013_kunjungan_tiket.sql',
  '202607300014_buku_tamu.sql',
  '202607300015_backfill_kunjungan_dual_write.sql',
  '202607300016_wp22_views_tiket_antrean.sql',
  '202607300017_wp23_akhir_hari_panggil.sql',
  '202607300018_chat_persisten.sql',
  '202607300019_wp26_cms_registry.sql',
  '202607300020_wp30_rekap_harian.sql',
  '202607300021_wp32_jejak_investasi.sql',
  '202607300022_wp29_layar_token.sql',
  '202607300023_wp27_dokumen_rag.sql',
  '202607300024_wp31_umkm_verifikasi.sql',
  '202608040001_catat_pulang_rpc.sql',
  '202608080001_chat_realtime_publication.sql',
  '202608080002_faq_embedding_3072.sql',
  '202608290001_pendataan_pelayanan.sql',
  '202608310001_finalize_pelayanan_rpc.sql',
  '202608310002_reservasi_no_show.sql',
  '202608310003_absensi_foto_fo.sql',
  '202609020001_estimasi_hari_libur.sql',
  '202609230001_chat_realtime_hardening.sql',
  '202609230002_faq_fts.sql',
  '202609230003_antrean_realtime.sql',
  '202610010001_non_oss_rename.sql',
  '202610070001_chat_fix_guard_ringkas.sql',
  '202610080001_rbac_tahap0_keamanan.sql',
  '202610080002_rbac_tahap0_layanan_admin_only.sql',
  '202610090001_rbac_tahap1.sql',
  '202610090002_akun_username.sql',
  '202610090003_konsol_pengaturan.sql',
  '202610090004_kelola_layanan_audit.sql',
  '202610090005_perbaikan_review.sql',
  '202610130001_faq_umum.sql',
  '202610130002_faq_petugas_hanya_petugas.sql',
  '202610140001_sesi_staf.sql',
  '202610140002_tiket_kepemilikan.sql',
  '202610140003_fo_model_data.sql',
  '202610140004_fo_rpc.sql',
  '202610140005_fo_selaras_antrean.sql',
  '202610140006_pernyataan_kebenaran.sql',
  '202610140007_wp24_akhiri_dual_write.sql',
  '202610140008_wp24_tutup_otomatis_retensi.sql',
  '202610140009_chat_online.sql',
  '202610140011_pendataan_wajib.sql',
  '202610140012_perbaikan_review.sql',
  '202610140013_fo_keterbukaan_data.sql',
  '202610140014_walkin_data_lengkap.sql',
  '202610140015_pendataan_tanpa_topik_email_opsional.sql',
  '202610270001_instansi_layanan_konten.sql',
  '202610270002_jadwal_tunggal_layanan.sql',
  '202610280001_homepage_etalase.sql',
  '202610290001_koordinator_akses_data.sql',
  '202610290002_rekap_terpadu.sql',
  '202610300001_pendataan_khusus.sql',
  '202610300002_selesai_dengan_pendataan.sql',
  '202610310001_chat_lingkup_percakapan.sql',
  '202610310002_chat_luar_jam.sql',
  '202610310003_chat_perbaikan_review.sql',
  '202611010001_fo_cari_pengunjung.sql',
  '202611010002_tiket_antrean_lingkup.sql',
] as const;

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

export function readBaseline(index: 0 | 1 | 2 | 3 | 4): string {
  return readFileSync(join(MIGRATIONS_DIR, BASELINE_FILES[index]), 'utf8');
}

export function readAllBaseline(): string {
  return BASELINE_FILES.map((_, index) => readBaseline(index as 0 | 1 | 2 | 3 | 4)).join('\n');
}

export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}
