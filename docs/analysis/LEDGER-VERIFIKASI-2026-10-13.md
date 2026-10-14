# Verifikasi ledger migrasi — 2026-10-13

Dibuat oleh `scripts/verify-migration-ledger.mjs` (READ ONLY: transaksi `BEGIN READ ONLY` + hanya SELECT, diakhiri ROLLBACK).
Tidak ada nilai rahasia/URL koneksi di laporan ini.

## Ringkasan

- File di `supabase/migrations/*.sql`: **59**
- Entri di `supabase_migrations.schema_migrations` (produksi): **54** (versi terakhir: 202610130002)
- File TIDAK tercatat di ledger: **5** (202608040001 s.d. 202609020001)
- Entri ledger tanpa file: tidak ada; nama berbeda antara ledger dan file: tidak ada
- Katalog opsional: pg_cron dapat dibaca; storage.buckets dapat dibaca
- Sidik jari isi fungsi (fungsi yang ada di DB, migrasi tidak tercatat): lebih_baru 2

### Hasil per status (migrasi tidak tercatat)

| Status | Jumlah | Arti |
|---|---|---|
| terpasang | 0 | semua penanda aktif ada dan sedikitnya satu penanda KUAT (hanya dibuat oleh migrasi ini) ditemukan |
| sebagian | 0 | sebagian penanda ada, sebagian hilang |
| tidak_ditemukan | 1 | objek hasil migrasi tidak ada |
| tidak_dapat_ditentukan | 4 | tidak ada penanda yang membuktikan migrasi ini (objek bersama / tanpa DDL / digantikan) |

### Cara membaca

- **Penanda**: objek yang dibuat migrasi (tabel, kolom, fungsi+jumlah argumen, indeks, policy, view, trigger, constraint, cron job, publikasi, ekstensi, bucket, tipe kolom).
- **Kuat**: objek hanya dibuat oleh migrasi ini, sehingga keberadaannya membuktikan migrasi ini. **Lemah**: objek juga dibuat/didefinisikan ulang migrasi lain (mis. CREATE OR REPLACE FUNCTION, DROP POLICY + CREATE POLICY); keberadaannya tidak membuktikan migrasi ini, tetapi KETIADAANNYA tetap bukti bahwa migrasi belum terpasang.
- **Digantikan**: objek di-DROP (dan tidak dibuat ulang) oleh migrasi yang lebih baru, atau tipenya diubah; ketiadaannya tidak dihitung.
- **Cek DROP**: objek yang seharusnya sudah di-DROP oleh migrasi ini. Bila masih ada, migrasi dianggap belum terpasang penuh. Objek yang tidak ada bukan bukti (mungkin tidak pernah ada).
- **Sidik jari isi fungsi**: untuk fungsi yang ada, badan di DB (`pg_proc.prosrc`, spasi dinormalkan) dibandingkan dengan badan di tiap migrasi yang mendefinisikannya. Identik hanya dengan migrasi ini => penanda dinaikkan menjadi kuat; identik hanya dengan migrasi LEBIH LAMA => versi migrasi ini belum diterapkan (dianggap hilang); identik dengan migrasi lebih baru / tidak identik dengan mana pun => tidak ada informasi.
- Keterbatasan: yang diperiksa hanya keberadaan objek, tipe kolom, dan isi fungsi; BUKAN ekspresi policy, definisi view/trigger, atau perubahan data (UPDATE/INSERT). Migrasi yang hanya mengubah data, policy, atau view yang didefinisikan ulang berkali-kali tidak dapat dibuktikan lewat katalog.

## Dampak untuk `supabase db push`

- Selama ledger belum diisi, `supabase db push --include-all` menganggap 5 migrasi di atas PENDING dan akan mencoba menerapkannya SEMUA berurutan; banyak yang tidak idempoten (mis. CREATE POLICY tanpa DROP) sehingga gagal atau mengubah objek yang sudah ada. Jangan jalankan sebelum ledger diisi.
- Setelah hanya migrasi berstatus `terpasang` dicatat (scripts/fill-migration-ledger.mjs), sisanya (5 migrasi: sebagian / tidak_ditemukan / tidak_dapat_ditentukan) tetap PENDING dan akan diterapkan oleh `db push`. Tiap-tiap migrasi itu harus diputuskan manual (periksa bagian "BUKAN terpasang" di bawah) SEBELUM `db push`.

## Migrasi yang tidak tercatat di ledger

| Versi | Nama | Status | Penanda ada/total | Penanda kuat ada/total | Cek DROP | Digantikan | Alasan |
|---|---|---|---|---|---|---|---|
| 202608040001 | catat_pulang_rpc | tidak_dapat_ditentukan | 1/1 | 0/0 | 0 | 0 | semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini) |
| 202608080001 | chat_realtime_publication | tidak_dapat_ditentukan | 2/2 | 0/0 | 0 | 0 | semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini) |
| 202608310001 | finalize_pelayanan_rpc | tidak_dapat_ditentukan | 1/1 | 0/0 | 0 | 0 | semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini) |
| 202608310003 | absensi_foto_fo | tidak_dapat_ditentukan | 0/0 | 0/0 | 0 | 0 | berkas no-op (hanya komentar, tanpa pernyataan SQL) |
| 202609020001 | estimasi_hari_libur | tidak_ditemukan | 2/3 | 0/1 | 0 | 1 | objek hasil migrasi tidak ada, dan tidak ada penanda kuat yang ditemukan |

## Migrasi tidak tercatat yang BUKAN `terpasang`

### 202608040001 catat_pulang_rpc — tidak_dapat_ditentukan

Alasan: semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini)

### 202608080001 chat_realtime_publication — tidak_dapat_ditentukan

Alasan: semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini)

### 202608310001 finalize_pelayanan_rpc — tidak_dapat_ditentukan

Alasan: semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini)

### 202608310003 absensi_foto_fo — tidak_dapat_ditentukan

Alasan: berkas no-op (hanya komentar, tanpa pernyataan SQL)

### 202609020001 estimasi_hari_libur — tidak_ditemukan

Alasan: objek hasil migrasi tidak ada, dan tidak ada penanda kuat yang ditemukan

Objek yang HILANG:
- indeks public.idx_hari_libur_tanggal (kuat)

Penanda digantikan (1): policy "hari_libur_staff_write" ON public.hari_libur

**PERINGATAN regresi**: bila migrasi ini diterapkan sekarang (mis. oleh `db push`), ia akan MEMBUAT ULANG objek yang sengaja sudah di-DROP migrasi lain yang sudah terpasang:
- policy "hari_libur_staff_write" ON public.hari_libur (di-DROP oleh 202610080002)

## Kontrol: migrasi yang SUDAH tercatat di ledger

Pemeriksaan yang sama dijalankan pada migrasi yang pasti sudah diterapkan (tercatat), untuk melihat apakah metode ini wajar. Hasil selain `terpasang`/`tidak_dapat_ditentukan` di sini menunjukkan perubahan di luar migrasi atau keterbatasan metode.

| Versi | Nama | Status | Penanda ada/total | Penanda kuat ada/total | Cek DROP | Digantikan | Alasan |
|---|---|---|---|---|---|---|---|
| 202607140001 | extensions_and_preflight | terpasang | 3/3 | 2/2 | 0 | 0 | 2 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202607140002 | core_schema | terpasang | 16/16 | 16/16 | 0 | 0 | 16 penanda kuat ada |
| 202607140003 | feature_schema | terpasang | 49/49 | 49/49 | 0 | 1 | 49 penanda kuat ada |
| 202607140004 | security_and_automation | terpasang | 98/98 | 81/81 | 0 | 2 | 81 penanda kuat ada, 17 lainnya objek bersama (ada) |
| 202607140005 | views_and_jobs | terpasang | 9/9 | 8/8 | 0 | 0 | 8 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202607200001 | p0_security_governance | terpasang | 18/18 | 12/12 | 0 | 1 | 12 penanda kuat ada, 6 lainnya objek bersama (ada) |
| 202607210001 | walkin_kontak_dan_layanan_perizinan | terpasang | 1/1 | 1/1 | 0 | 0 | 1 penanda kuat ada |
| 202607240001 | pengunjung_no_hp | terpasang | 1/1 | 1/1 | 0 | 0 | 1 penanda kuat ada |
| 202607280001 | layanan_jadwal | terpasang | 10/10 | 8/8 | 0 | 2 | 8 penanda kuat ada, 2 lainnya objek bersama (ada) |
| 202607280002 | chat_pesan_owner_strict | tidak_dapat_ditentukan | 1/1 | 0/0 | 0 | 0 | semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini) |
| 202607280003 | faq_petugas_scope | terpasang | 2/2 | 1/1 | 0 | 1 | 1 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202607280004 | chat_pesan_client_uuid | terpasang | 1/1 | 1/1 | 0 | 1 | 1 penanda kuat ada |
| 202607280005 | antrian_hari_ini | tidak_dapat_ditentukan | 1/1 | 0/0 | 0 | 0 | semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini) |
| 202607290001 | observability_error_log | terpasang | 7/7 | 7/7 | 0 | 0 | 7 penanda kuat ada |
| 202607290002 | faq_reembed | terpasang | 6/6 | 6/6 | 0 | 0 | 6 penanda kuat ada |
| 202607290003 | antrean_counter | terpasang | 6/6 | 6/6 | 0 | 0 | 6 penanda kuat ada |
| 202607290004 | petugas_aktif | terpasang | 7/7 | 5/5 | 0 | 0 | 5 penanda kuat ada, 2 lainnya objek bersama (ada) |
| 202607290005 | jadwal_harian_beku | terpasang | 8/8 | 8/8 | 0 | 0 | 8 penanda kuat ada |
| 202607290006 | skm_response_rate | terpasang | 7/7 | 7/7 | 0 | 0 | 7 penanda kuat ada |
| 202607290007 | pengaduan | terpasang | 22/22 | 16/16 | 0 | 0 | 16 penanda kuat ada, 6 lainnya objek bersama (ada) |
| 202607290008 | standar_pelayanan | terpasang | 3/3 | 3/3 | 0 | 0 | 3 penanda kuat ada |
| 202607290009 | role_front_office | terpasang | 3/3 | 2/2 | 0 | 2 | 2 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202607290010 | jadwal_standby | terpasang | 7/7 | 6/6 | 0 | 2 | 6 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202607290011 | absensi_gerbang | terpasang | 9/9 | 7/7 | 0 | 2 | 7 penanda kuat ada, 2 lainnya objek bersama (ada) |
| 202607290012 | layanan_kontak_notifikasi | terpasang | 11/11 | 11/11 | 0 | 0 | 11 penanda kuat ada |
| 202607290013 | kunjungan_tiket | terpasang | 22/22 | 20/20 | 0 | 2 | 20 penanda kuat ada, 2 lainnya objek bersama (ada) |
| 202607300014 | buku_tamu | terpasang | 3/3 | 3/3 | 0 | 1 | 3 penanda kuat ada |
| 202607300015 | backfill_kunjungan_dual_write | terpasang | 9/9 | 7/7 | 0 | 0 | 7 penanda kuat ada, 2 lainnya objek bersama (ada) |
| 202607300016 | wp22_views_tiket_antrean | terpasang | 2/2 | 1/1 | 0 | 0 | 1 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202607300017 | wp23_akhir_hari_panggil | terpasang | 3/3 | 2/2 | 0 | 0 | 2 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202607300018 | chat_persisten | terpasang | 3/3 | 1/1 | 0 | 0 | 1 penanda kuat ada, 2 lainnya objek bersama (ada) |
| 202607300019 | wp26_cms_registry | terpasang | 5/5 | 5/5 | 0 | 0 | 5 penanda kuat ada |
| 202607300020 | wp30_rekap_harian | terpasang | 7/7 | 6/6 | 0 | 0 | 6 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202607300021 | wp32_jejak_investasi | terpasang | 5/5 | 5/5 | 0 | 0 | 5 penanda kuat ada |
| 202607300022 | wp29_layar_token | terpasang | 4/4 | 3/3 | 0 | 0 | 3 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202607300023 | wp27_dokumen_rag | terpasang | 10/10 | 9/9 | 0 | 0 | 9 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202607300024 | wp31_umkm_verifikasi | terpasang | 14/14 | 12/12 | 0 | 0 | 12 penanda kuat ada, 2 lainnya objek bersama (ada) |
| 202608080002 | faq_embedding_3072 | terpasang | 2/2 | 1/1 | 1 | 0 | 1 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202608290001 | pendataan_pelayanan | terpasang | 21/21 | 13/13 | 0 | 0 | 13 penanda kuat ada, 8 lainnya objek bersama (ada) |
| 202608310002 | reservasi_no_show | terpasang | 4/4 | 4/4 | 0 | 0 | 4 penanda kuat ada |
| 202609230001 | chat_realtime_hardening | terpasang | 6/6 | 1/1 | 1 | 0 | 1 penanda kuat ada, 5 lainnya objek bersama (ada) |
| 202609230002 | faq_fts | terpasang | 10/10 | 9/9 | 0 | 0 | 9 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202609230003 | antrean_realtime | terpasang | 7/7 | 7/7 | 0 | 0 | 7 penanda kuat ada |
| 202610010001 | non_oss_rename | terpasang | 5/5 | 2/2 | 0 | 1 | 2 penanda kuat ada, 3 lainnya objek bersama (ada) |
| 202610070001 | chat_fix_guard_ringkas | terpasang | 6/6 | 4/4 | 0 | 0 | 4 penanda kuat ada, 2 lainnya objek bersama (ada) |
| 202610080001 | rbac_tahap0_keamanan | terpasang | 16/16 | 13/13 | 4 | 2 | 13 penanda kuat ada, 3 lainnya objek bersama (ada) |
| 202610080002 | rbac_tahap0_layanan_admin_only | terpasang | 4/4 | 4/4 | 8 | 0 | 4 penanda kuat ada |
| 202610090001 | rbac_tahap1 | terpasang | 34/34 | 16/16 | 2 | 0 | 16 penanda kuat ada, 18 lainnya objek bersama (ada) |
| 202610090002 | akun_username | terpasang | 22/22 | 22/22 | 0 | 0 | 22 penanda kuat ada |
| 202610090003 | konsol_pengaturan | terpasang | 10/10 | 10/10 | 0 | 0 | 10 penanda kuat ada |
| 202610090004 | kelola_layanan_audit | terpasang | 21/21 | 20/20 | 3 | 0 | 20 penanda kuat ada, 1 lainnya objek bersama (ada) |
| 202610090005 | perbaikan_review | terpasang | 6/6 | 6/6 | 0 | 0 | 6 penanda kuat ada |
| 202610130001 | faq_umum | terpasang | 3/3 | 3/3 | 0 | 0 | 3 penanda kuat ada |
| 202610130002 | faq_petugas_hanya_petugas | tidak_dapat_ditentukan | 1/1 | 0/0 | 0 | 0 | semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini) |

## Lampiran: rincian penanda per migrasi (tidak tercatat)

#### 202608040001 catat_pulang_rpc — tidak_dapat_ditentukan

Alasan: semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini)

- fungsi public.catat_pulang(1 arg) => ADA, lemah [juga dibuat oleh: 202610080001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))

#### 202608080001 chat_realtime_publication — tidak_dapat_ditentukan

Alasan: semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini)

- publikasi supabase_realtime memuat public.chat_sesi => ADA, lemah [juga dibuat oleh: 202609230001]
- publikasi supabase_realtime memuat public.chat_pesan => ADA, lemah [juga dibuat oleh: 202609230001]

#### 202608310001 finalize_pelayanan_rpc — tidak_dapat_ditentukan

Alasan: semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini)

- fungsi public.finalize_pelayanan(3 arg) => ADA, lemah [juga dibuat oleh: 202610010001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))

#### 202608310003 absensi_foto_fo — tidak_dapat_ditentukan

Alasan: berkas no-op (hanya komentar, tanpa pernyataan SQL)

(tidak ada penanda)

#### 202609020001 estimasi_hari_libur — tidak_ditemukan

Alasan: objek hasil migrasi tidak ada, dan tidak ada penanda kuat yang ditemukan

- tabel public.hari_libur => ADA, lemah [juga dibuat oleh: 202607290007]
- indeks public.idx_hari_libur_tanggal => HILANG, kuat
- policy "hari_libur_public_read" ON public.hari_libur => ADA, lemah [juga dibuat oleh: 202607290007]
- policy "hari_libur_staff_write" ON public.hari_libur => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610080002)

## Lampiran: rincian penanda migrasi tercatat (kontrol)

#### 202607140001 extensions_and_preflight — terpasang

Alasan: 2 penanda kuat ada, 1 lainnya objek bersama (ada)

- ekstensi pgcrypto => ADA, kuat
- ekstensi vector => ADA, lemah [juga dibuat oleh: 202607300023]
- ekstensi pg_cron => ADA, kuat

#### 202607140002 core_schema — terpasang

Alasan: 16 penanda kuat ada

- tabel public.layanan => ADA, kuat
- tabel public.petugas => ADA, kuat
- indeks public.idx_petugas_layanan => ADA, kuat
- tabel public.pengunjung => ADA, kuat
- indeks public.idx_pengunjung_auth_user => ADA, kuat
- indeks public.idx_pengunjung_updated_at => ADA, kuat
- tabel public.site_settings => ADA, kuat
- tabel public.landing_content => ADA, kuat
- tabel public.absensi_petugas => ADA, kuat
- indeks public.idx_absensi_tanggal => ADA, kuat
- tabel public.visit => ADA, kuat
- indeks public.idx_visit_layanan_status => ADA, kuat
- indeks public.idx_visit_tanggal => ADA, kuat
- indeks public.idx_visit_qr => ADA, kuat
- indeks public.idx_visit_pengunjung => ADA, kuat
- indeks public.idx_visit_asal => ADA, kuat

#### 202607140003 feature_schema — terpasang

Alasan: 49 penanda kuat ada

- tabel public.faq_knowledge_base => ADA, kuat
- indeks public.idx_faq_layanan => ADA, kuat
- indeks public.idx_faq_embedding => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202608080002)
- tabel public.chat_sesi => ADA, kuat
- indeks public.idx_chat_sesi_layanan => ADA, kuat
- indeks public.idx_chat_sesi_status => ADA, kuat
- indeks public.idx_chat_sesi_pengunjung => ADA, kuat
- tabel public.chat_pesan => ADA, kuat
- indeks public.idx_chat_pesan_sesi => ADA, kuat
- tabel public.chat_ai_log => ADA, kuat
- indeks public.idx_chat_ai_log_created => ADA, kuat
- indeks public.idx_chat_ai_log_eskalasi => ADA, kuat
- tabel public.listing_umkm => ADA, kuat
- indeks public.idx_listing_status => ADA, kuat
- indeks public.idx_listing_kategori => ADA, kuat
- indeks public.idx_listing_sisi => ADA, kuat
- tabel public.umkm_listing_owner => ADA, kuat
- indeks public.idx_umkm_owner_email => ADA, kuat
- tabel public.umkm_inquiry => ADA, kuat
- indeks public.idx_umkm_inquiry_listing => ADA, kuat
- indeks public.idx_umkm_inquiry_status => ADA, kuat
- indeks public.idx_umkm_inquiry_created_at => ADA, kuat
- tabel public.investment_documents => ADA, kuat
- indeks public.idx_investment_status => ADA, kuat
- indeks public.idx_investment_urutan => ADA, kuat
- tabel public.investasi_lead => ADA, kuat
- indeks public.idx_investasi_lead_status => ADA, kuat
- indeks public.idx_investasi_lead_doc => ADA, kuat
- indeks public.idx_investasi_lead_created_at => ADA, kuat
- tabel public.anon_rate_limit => ADA, kuat
- indeks public.idx_anon_rate_user_action_time => ADA, kuat
- tabel public.audit_log => ADA, kuat
- indeks public.idx_audit_log_entitas => ADA, kuat
- indeks public.idx_audit_log_actor => ADA, kuat
- indeks public.idx_audit_log_created => ADA, kuat
- tabel public.consent_log => ADA, kuat
- indeks public.idx_consent_subjek => ADA, kuat
- tabel public.skm_respons => ADA, kuat
- indeks public.idx_skm_layanan => ADA, kuat
- indeks public.idx_skm_visit => ADA, kuat
- indeks public.idx_skm_created => ADA, kuat
- indeks public.skm_respons_visit_id_uniq => ADA, kuat
- tabel public.notifikasi => ADA, kuat
- indeks public.idx_notifikasi_status => ADA, kuat
- indeks public.idx_notifikasi_tujuan => ADA, kuat
- indeks public.idx_notifikasi_claim => ADA, kuat
- indeks public.idx_notifikasi_idempotency_key => ADA, kuat
- tabel public.push_subscriptions => ADA, kuat
- indeks public.idx_push_sub_user => ADA, kuat
- indeks public.idx_push_sub_endpoint => ADA, kuat

#### 202607140004 security_and_automation — terpasang

Alasan: 81 penanda kuat ada, 17 lainnya objek bersama (ada)

- fungsi public.get_my_role(0 arg) => ADA, lemah [juga dibuat oleh: 202607290004] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))
- fungsi public.get_my_layanan_id(0 arg) => ADA, lemah [juga dibuat oleh: 202610080001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))
- fungsi public.set_user_role_claim(1 arg) => ADA, lemah [juga dibuat oleh: 202610080001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))
- fungsi public.update_updated_at_column(0 arg) => ADA, kuat
- fungsi public.check_anon_rate(3 arg) => ADA, kuat
- fungsi public.log_anon_action(0 arg) => ADA, kuat
- fungsi public.prune_anon_rate_limit(0 arg) => ADA, kuat
- fungsi public.audit_change(0 arg) => ADA, kuat
- fungsi public.anonymize_inactive_pengunjung(0 arg) => ADA, kuat
- fungsi public.match_faq(3 arg) => ADA, lemah [juga dibuat oleh: 202608080002, 202610130001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))
- fungsi public.hitung_ikm(3 arg) => ADA, kuat
- fungsi public.get_skm_context(1 arg) => ADA, kuat
- fungsi public.submit_skm_response(11 arg) => ADA, kuat
- fungsi public.get_public_umkm(0 arg) => ADA, kuat
- fungsi public.queue_notifikasi(6 arg) => ADA, kuat
- fungsi public.claim_notifikasi(2 arg) => ADA, lemah [juga dibuat oleh: 202607200001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))
- fungsi public.complete_notifikasi(4 arg) => ADA, kuat
- fungsi public.notify_visit_selesai(0 arg) => ADA, kuat
- fungsi public.notify_umkm_approved(0 arg) => ADA, kuat
- policy "layanan_public_read" ON public.layanan => ADA, kuat
- policy "petugas_admin_full" ON public.petugas => ADA, kuat
- policy "petugas_self_read" ON public.petugas => ADA, kuat
- policy "pengunjung_self_select" ON public.pengunjung => ADA, kuat
- policy "pengunjung_self_insert" ON public.pengunjung => ADA, kuat
- policy "pengunjung_self_update" ON public.pengunjung => ADA, kuat
- policy "settings_public_read" ON public.site_settings => ADA, kuat
- policy "settings_admin_all" ON public.site_settings => ADA, kuat
- policy "landing_public_read" ON public.landing_content => ADA, kuat
- policy "landing_admin_all" ON public.landing_content => ADA, kuat
- policy "absensi_select_own" ON public.absensi_petugas => ADA, lemah [juga dibuat oleh: 202610080001, 202610090001]
- policy "absensi_insert_own" ON public.absensi_petugas => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610080001)
- policy "absensi_update_own" ON public.absensi_petugas => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610080001)
- policy "visit_insert_walk_in" ON public.visit => ADA, lemah [juga dibuat oleh: 202607200001, 202610080001]
- policy "visit_insert_reservasi" ON public.visit => ADA, lemah [juga dibuat oleh: 202610080001]
- policy "visit_select_own" ON public.visit => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "visit_update_staff" ON public.visit => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "faq_public_read" ON public.faq_knowledge_base => ADA, kuat
- policy "faq_admin_all" ON public.faq_knowledge_base => ADA, kuat
- policy "chat_sesi_owner_select" ON public.chat_sesi => ADA, lemah [juga dibuat oleh: 202609230001]
- policy "chat_sesi_owner_insert" ON public.chat_sesi => ADA, kuat
- policy "chat_sesi_petugas_update" ON public.chat_sesi => ADA, lemah [juga dibuat oleh: 202609230001]
- policy "chat_pesan_owner_select" ON public.chat_pesan => ADA, lemah [juga dibuat oleh: 202609230001]
- policy "chat_pesan_owner_insert" ON public.chat_pesan => ADA, lemah [juga dibuat oleh: 202607280002]
- policy "chat_ai_log_admin_select" ON public.chat_ai_log => ADA, kuat
- policy "listing_admin_all" ON public.listing_umkm => ADA, kuat
- policy "listing_staff_insert" ON public.listing_umkm => ADA, lemah [juga dibuat oleh: 202607200001]
- policy "listing_umkm_select_own" ON public.listing_umkm => ADA, kuat
- policy "listing_umkm_update_own" ON public.listing_umkm => ADA, kuat
- policy "umkm_owner_select_own" ON public.umkm_listing_owner => ADA, kuat
- policy "umkm_owner_admin_all" ON public.umkm_listing_owner => ADA, kuat
- policy "umkm_inquiry_insert" ON public.umkm_inquiry => ADA, kuat
- policy "umkm_inquiry_select_owner" ON public.umkm_inquiry => ADA, kuat
- policy "umkm_inquiry_update_owner" ON public.umkm_inquiry => ADA, kuat
- policy "investment_public_read" ON public.investment_documents => ADA, kuat
- policy "investment_admin_all" ON public.investment_documents => ADA, kuat
- policy "investasi_lead_insert" ON public.investasi_lead => ADA, kuat
- policy "investasi_lead_select_staff" ON public.investasi_lead => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "investasi_lead_update_admin" ON public.investasi_lead => ADA, kuat
- policy "audit_log_admin_select" ON public.audit_log => ADA, kuat
- policy "consent_log_insert_own" ON public.consent_log => ADA, kuat
- policy "consent_log_admin_select" ON public.consent_log => ADA, kuat
- policy "skm_select_staff" ON public.skm_respons => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "notifikasi_select_own" ON public.notifikasi => ADA, kuat
- policy "notifikasi_admin_all" ON public.notifikasi => ADA, kuat
- policy "push_sub_self_select" ON public.push_subscriptions => ADA, kuat
- policy "push_sub_self_insert" ON public.push_subscriptions => ADA, kuat
- policy "push_sub_self_delete" ON public.push_subscriptions => ADA, kuat
- storage bucket investment-docs => ADA, kuat
- policy "investment_docs_admin_select" ON storage.objects => ADA, kuat
- policy "investment_docs_admin_insert" ON storage.objects => ADA, kuat
- policy "investment_docs_admin_update" ON storage.objects => ADA, kuat
- policy "investment_docs_admin_delete" ON storage.objects => ADA, kuat
- policy "umkm_photos_public_select" ON storage.objects => ADA, kuat
- policy "umkm_photos_staff_insert" ON storage.objects => ADA, kuat
- policy "umkm_photos_staff_update" ON storage.objects => ADA, kuat
- policy "umkm_photos_staff_delete" ON storage.objects => ADA, kuat
- trigger update_site_settings_updated_at ON public.site_settings => ADA, kuat
- trigger update_landing_content_updated_at ON public.landing_content => ADA, kuat
- trigger trigger_pengunjung_updated_at ON public.pengunjung => ADA, kuat
- trigger trg_visit_updated ON public.visit => ADA, kuat
- trigger trigger_chat_sesi_updated_at ON public.chat_sesi => ADA, kuat
- trigger trigger_faq_knowledge_base_updated_at ON public.faq_knowledge_base => ADA, kuat
- trigger trigger_listing_umkm_updated_at ON public.listing_umkm => ADA, kuat
- trigger trigger_investment_documents_updated_at ON public.investment_documents => ADA, kuat
- trigger trg_investasi_lead_updated ON public.investasi_lead => ADA, kuat
- trigger trg_umkm_inquiry_updated ON public.umkm_inquiry => ADA, kuat
- trigger trg_log_visit_insert ON public.visit => ADA, kuat
- trigger trg_log_chat_sesi_insert ON public.chat_sesi => ADA, kuat
- trigger trg_log_chat_pesan_insert ON public.chat_pesan => ADA, kuat
- trigger trg_log_investasi_lead_insert ON public.investasi_lead => ADA, kuat
- trigger trg_log_umkm_inquiry_insert ON public.umkm_inquiry => ADA, kuat
- trigger trg_audit_visit_status ON public.visit => ADA, kuat
- trigger trg_audit_umkm_status ON public.listing_umkm => ADA, kuat
- trigger trg_audit_petugas_insert ON public.petugas => ADA, kuat
- trigger trg_audit_petugas_delete ON public.petugas => ADA, kuat
- trigger trg_audit_investment_insert ON public.investment_documents => ADA, kuat
- trigger trg_audit_investment_delete ON public.investment_documents => ADA, kuat
- trigger trg_audit_investasi_lead_status ON public.investasi_lead => ADA, kuat
- trigger trg_notify_visit_selesai ON public.visit => ADA, kuat
- trigger trg_notify_umkm_approved ON public.listing_umkm => ADA, kuat

#### 202607140005 views_and_jobs — terpasang

Alasan: 8 penanda kuat ada, 1 lainnya objek bersama (ada)

- view public.v_umkm_public => ADA, kuat
- view public.v_umkm_match => ADA, kuat
- view public.mv_estimasi_layanan => ADA, kuat
- indeks public.idx_mv_estimasi_layanan_key => ADA, kuat
- view public.v_antrian_loket => ADA, lemah [juga dibuat oleh: 202607280005, 202607300016]
- fungsi public.refresh_estimasi_layanan(0 arg) => ADA, kuat
- cron job anonymize_inactive_pengunjung => ADA, kuat
- cron job refresh_estimasi => ADA, kuat
- cron job prune_anon_rate_limit => ADA, kuat

#### 202607200001 p0_security_governance — terpasang

Alasan: 12 penanda kuat ada, 6 lainnya objek bersama (ada)

- policy "visit_insert_walk_in" ON public.visit => ADA, lemah [juga dibuat oleh: 202607140004, 202610080001]
- fungsi public.guard_chat_sesi_staff_columns(0 arg) => ADA, lemah [juga dibuat oleh: 202610070001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))
- trigger trg_guard_chat_sesi_staff ON public.chat_sesi => ADA, kuat
- policy "listing_staff_insert" ON public.listing_umkm => ADA, lemah [juga dibuat oleh: 202607140004]
- policy "consent_log_admin_insert" ON public.consent_log => ADA, kuat
- trigger trg_audit_petugas_role ON public.petugas => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610090004)
- constraint absensi_petugas_status_check ON public.absensi_petugas => ADA, lemah [juga dibuat oleh: 202607290011] (nama constraint pernah di-DROP sebelum dibuat (kemungkinan nama otomatis yang sudah ada))
- fungsi public.guard_absensi_tanggal_today(0 arg) => ADA, lemah [juga dibuat oleh: 202610080001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))
- trigger trg_guard_absensi_tanggal ON public.absensi_petugas => ADA, kuat
- fungsi public.claim_notifikasi(2 arg) => ADA, kuat [juga dibuat oleh: 202607140004] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- fungsi public.prune_chat_ai_log(0 arg) => ADA, kuat
- fungsi public.get_queue_position(1 arg) => ADA, lemah [juga dibuat oleh: 202607300016] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))
- fungsi public.notify_chat_petugas_reply(0 arg) => ADA, kuat
- trigger trg_notify_chat_petugas_reply ON public.chat_pesan => ADA, kuat
- fungsi public.notify_umkm_inquiry_status(0 arg) => ADA, kuat
- trigger trg_notify_umkm_inquiry_status ON public.umkm_inquiry => ADA, kuat
- fungsi public.notify_reservasi_confirmed(0 arg) => ADA, kuat
- trigger trg_notify_reservasi_confirmed ON public.visit => ADA, kuat
- cron job prune_chat_ai_log => ADA, kuat

#### 202607210001 walkin_kontak_dan_layanan_perizinan — terpasang

Alasan: 1 penanda kuat ada

- kolom public.visit.kontak_hp => ADA, kuat

#### 202607240001 pengunjung_no_hp — terpasang

Alasan: 1 penanda kuat ada

- kolom public.pengunjung.no_hp => ADA, kuat

#### 202607280001 layanan_jadwal — terpasang

Alasan: 8 penanda kuat ada, 2 lainnya objek bersama (ada)

- kolom public.layanan.is_ptsp => ADA, kuat
- tabel public.layanan_jadwal => ADA, kuat
- tabel public.layanan_libur => ADA, kuat
- indeks public.idx_layanan_libur_tanggal => ADA, kuat
- fungsi public.is_layanan_buka(3 arg) => ADA, kuat
- fungsi public.is_ptsp_staff(0 arg) => ADA, lemah [juga dibuat oleh: 202610080001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))
- policy "jadwal_public_read" ON public.layanan_jadwal => ADA, kuat
- policy "jadwal_ptsp_write" ON public.layanan_jadwal => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610080002)
- policy "libur_public_read" ON public.layanan_libur => ADA, kuat
- policy "libur_ptsp_write" ON public.layanan_libur => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610080002)
- fungsi public.guard_visit_layanan_buka(0 arg) => ADA, lemah [juga dibuat oleh: 202607290010, 202610090001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))
- trigger trg_guard_visit_layanan_buka ON public.visit => ADA, kuat

#### 202607280002 chat_pesan_owner_strict — tidak_dapat_ditentukan

Alasan: semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini)

- policy "chat_pesan_owner_insert" ON public.chat_pesan => ADA, lemah [juga dibuat oleh: 202607140004]

#### 202607280003 faq_petugas_scope — terpasang

Alasan: 1 penanda kuat ada, 1 lainnya objek bersama (ada)

- policy "faq_petugas_all" ON public.faq_knowledge_base => ADA, lemah [juga dibuat oleh: 202610130002]
- policy "layanan_admin_all" ON public.layanan => ADA, kuat
- policy "layanan_petugas_chatbot_toggle" ON public.layanan => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610080002)

#### 202607280004 chat_pesan_client_uuid — terpasang

Alasan: 1 penanda kuat ada

- kolom public.chat_pesan.client_uuid => ADA, kuat
- indeks public.idx_chat_pesan_client_uuid => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202609230001)

#### 202607280005 antrian_hari_ini — tidak_dapat_ditentukan

Alasan: semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini)

- view public.v_antrian_loket => ADA, lemah [juga dibuat oleh: 202607140005, 202607300016]

#### 202607290001 observability_error_log — terpasang

Alasan: 7 penanda kuat ada

- tabel public.error_log => ADA, kuat
- indeks public.idx_error_log_created => ADA, kuat
- indeks public.idx_error_log_route => ADA, kuat
- fungsi public.log_error_event(10 arg) => ADA, kuat
- fungsi public.check_error_alert(3 arg) => ADA, kuat
- policy "error_log_admin_read" ON public.error_log => ADA, kuat
- cron job observability_error_alert => ADA, kuat

#### 202607290002 faq_reembed — terpasang

Alasan: 6 penanda kuat ada

- kolom public.faq_knowledge_base.perlu_embed_ulang => ADA, kuat
- kolom public.faq_knowledge_base.embedding_updated_at => ADA, kuat
- kolom public.faq_knowledge_base.diubah_oleh => ADA, kuat
- fungsi public.faq_mark_reembed(0 arg) => ADA, kuat
- trigger trg_faq_reembed ON public.faq_knowledge_base => ADA, kuat
- fungsi public.faq_embedding_selesai(1 arg) => ADA, kuat

#### 202607290003 antrean_counter — terpasang

Alasan: 6 penanda kuat ada

- kolom public.layanan.nomor_loket => ADA, kuat
- kolom public.layanan.prefiks_antrean => ADA, kuat
- indeks public.uq_layanan_prefiks => ADA, kuat
- tabel public.antrean_counter => ADA, kuat
- policy "antrean_counter_deny_all" ON public.antrean_counter => ADA, kuat
- fungsi public.terbit_nomor_antrean(2 arg) => ADA, kuat

#### 202607290004 petugas_aktif — terpasang

Alasan: 5 penanda kuat ada, 2 lainnya objek bersama (ada)

- kolom public.petugas.aktif => ADA, kuat
- kolom public.petugas.nonaktif_sejak => ADA, kuat
- kolom public.petugas.nonaktif_oleh => ADA, kuat
- kolom public.petugas.nonaktif_alasan => ADA, kuat
- fungsi public.get_my_role(0 arg) => ADA, kuat [juga dibuat oleh: 202607140004] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- fungsi public.petugas_set_nonaktif(3 arg) => ADA, lemah [juga dibuat oleh: 202610080001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))
- fungsi public.petugas_set_aktif(1 arg) => ADA, lemah [juga dibuat oleh: 202610080001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))

#### 202607290005 jadwal_harian_beku — terpasang

Alasan: 8 penanda kuat ada

- tabel public.jadwal_harian_beku => ADA, kuat
- indeks public.idx_jhb_tanggal => ADA, kuat
- fungsi public.bekukan_jadwal(1 arg) => ADA, kuat
- fungsi public.jhb_tolak_ubah(0 arg) => ADA, kuat
- trigger trg_jhb_no_update ON public.jadwal_harian_beku => ADA, kuat
- policy "jhb_staff_read" ON public.jadwal_harian_beku => ADA, kuat
- policy "jhb_deny_write" ON public.jadwal_harian_beku => ADA, kuat
- cron job bekukan_jadwal_harian => ADA, kuat

#### 202607290006 skm_response_rate — terpasang

Alasan: 7 penanda kuat ada

- tabel public.skm_response_rate => ADA, kuat
- policy "skm_rr_staff_read" ON public.skm_response_rate => ADA, kuat
- fungsi public.skm_rr_tambah(2 arg) => ADA, kuat
- fungsi public.trg_visit_selesai_rr(0 arg) => ADA, kuat
- trigger trg_visit_selesai_rr ON public.visit => ADA, kuat
- fungsi public.trg_skm_insert_rr(0 arg) => ADA, kuat
- trigger trg_skm_insert_rr ON public.skm_respons => ADA, kuat

#### 202607290007 pengaduan — terpasang

Alasan: 16 penanda kuat ada, 6 lainnya objek bersama (ada)

- tabel public.hari_libur => ADA, lemah [juga dibuat oleh: 202609020001]
- policy "hari_libur_public_read" ON public.hari_libur => ADA, lemah [juga dibuat oleh: 202609020001]
- policy "hari_libur_admin_write" ON public.hari_libur => ADA, kuat
- fungsi public.tambah_hari_kerja(2 arg) => ADA, kuat
- fungsi public.generate_nomor_tiket(0 arg) => ADA, kuat
- tabel public.pengaduan => ADA, kuat
- indeks public.idx_pengaduan_tiket => ADA, kuat
- indeks public.idx_pengaduan_status => ADA, kuat
- indeks public.idx_pengaduan_jalur => ADA, kuat
- tabel public.pengaduan_riwayat => ADA, kuat
- indeks public.idx_pengaduan_riwayat => ADA, kuat
- fungsi public.buat_pengaduan(6 arg) => ADA, kuat
- fungsi public.lacak_pengaduan(2 arg) => ADA, kuat
- fungsi public.eskalasi_pengaduan_lewat_batas(0 arg) => ADA, kuat
- cron job pengaduan_eskalasi => ADA, kuat
- policy "pengaduan_deny_insert" ON public.pengaduan => ADA, kuat
- policy "pengaduan_layanan_read" ON public.pengaduan => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "pengaduan_integritas_admin_only" ON public.pengaduan => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "pengaduan_update" ON public.pengaduan => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "pengaduan_riwayat_read" ON public.pengaduan_riwayat => ADA, kuat
- policy "pengaduan_riwayat_write" ON public.pengaduan_riwayat => ADA, lemah [juga dibuat oleh: 202610090001]
- storage bucket pengaduan-bukti => ADA, kuat

#### 202607290008 standar_pelayanan — terpasang

Alasan: 3 penanda kuat ada

- tabel public.standar_pelayanan => ADA, kuat
- policy "standar_public_read" ON public.standar_pelayanan => ADA, kuat
- policy "standar_admin_write" ON public.standar_pelayanan => ADA, kuat

#### 202607290009 role_front_office — terpasang

Alasan: 2 penanda kuat ada, 1 lainnya objek bersama (ada)

- constraint petugas_role_check ON public.petugas => ADA, lemah (nama constraint pernah di-DROP sebelum dibuat (kemungkinan nama otomatis yang sudah ada))
- fungsi public.is_cross_service_staff(0 arg) => ADA, kuat
- policy "absensi_cross_service_read" ON public.absensi_petugas => ADA, kuat
- policy "layanan_jadwal_cross_service_write" ON public.layanan_jadwal => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610080002)
- policy "layanan_libur_cross_service_write" ON public.layanan_libur => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610080002)

#### 202607290010 jadwal_standby — terpasang

Alasan: 6 penanda kuat ada, 1 lainnya objek bersama (ada)

- tabel public.jadwal_standby => ADA, kuat
- tabel public.jadwal_pengecualian => ADA, kuat
- fungsi public.is_layanan_buka_jadwal(3 arg) => ADA, kuat
- fungsi public.jadwal_berikutnya(2 arg) => ADA, kuat
- policy "jadwal_standby_public_read" ON public.jadwal_standby => ADA, kuat
- policy "jadwal_standby_staff_write" ON public.jadwal_standby => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610080002)
- policy "jadwal_pengecualian_public_read" ON public.jadwal_pengecualian => ADA, kuat
- policy "jadwal_pengecualian_staff_write" ON public.jadwal_pengecualian => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610080002)
- fungsi public.guard_visit_layanan_buka(0 arg) => ADA, lemah [juga dibuat oleh: 202607280001, 202610090001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))

#### 202607290011 absensi_gerbang — terpasang

Alasan: 7 penanda kuat ada, 2 lainnya objek bersama (ada)

- kolom public.absensi_petugas.sumber => ADA, kuat
- kolom public.absensi_petugas.dicatat_oleh => ADA, kuat
- constraint absensi_petugas_status_check ON public.absensi_petugas => ADA, lemah [juga dibuat oleh: 202607200001] (nama constraint pernah di-DROP sebelum dibuat (kemungkinan nama otomatis yang sudah ada))
- tabel public.layanan_hari => ADA, kuat
- policy "layanan_hari_public_read" ON public.layanan_hari => ADA, kuat
- policy "layanan_hari_staff_write" ON public.layanan_hari => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610090001)
- fungsi public.catat_absensi(3 arg) => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610090001)
- fungsi public.antrean_dibuka(2 arg) => ADA, kuat
- fungsi public.tandai_alpa_otomatis(0 arg) => ADA, kuat
- cron job absensi_alpa_otomatis => ADA, kuat
- constraint visit_status_check ON public.visit => ADA, lemah (nama constraint pernah di-DROP sebelum dibuat (kemungkinan nama otomatis yang sudah ada))

#### 202607290012 layanan_kontak_notifikasi — terpasang

Alasan: 11 penanda kuat ada

- tabel public.layanan_kontak => ADA, kuat
- indeks public.idx_layanan_kontak_layanan => ADA, kuat
- policy "layanan_kontak_public_read" ON public.layanan_kontak => ADA, kuat
- policy "layanan_kontak_admin_write" ON public.layanan_kontak => ADA, kuat
- fungsi public.email_layanan(2 arg) => ADA, kuat
- fungsi public.jumlah_terdaftar(2 arg) => ADA, kuat
- fungsi public.kirim_pengingat_petugas(2 arg) => ADA, kuat
- cron job notif_h1_sore => ADA, kuat
- cron job notif_h0_pagi => ADA, kuat
- cron job notif_eskalasi => ADA, kuat
- fungsi public.metrik_kepatuhan(3 arg) => ADA, kuat

#### 202607290013 kunjungan_tiket — terpasang

Alasan: 20 penanda kuat ada, 2 lainnya objek bersama (ada)

- kolom public.layanan.penyerta => ADA, kuat
- kolom public.layanan.status_tampilan => ADA, kuat
- kolom public.layanan.punya_antrean => ADA, kuat
- kolom public.layanan.punya_chat => ADA, kuat
- kolom public.layanan.punya_jadwal_standby => ADA, kuat
- kolom public.layanan.punya_dokumen_peraturan => ADA, kuat
- kolom public.layanan.batas_ambil_nomor_menit => ADA, kuat
- kolom public.layanan.kuota_harian => ADA, kuat
- tabel public.kunjungan => ADA, kuat
- indeks public.idx_kunjungan_tanggal => ADA, kuat
- indeks public.idx_kunjungan_pengunjung => ADA, kuat
- indeks public.idx_kunjungan_qr => ADA, kuat
- tabel public.tiket_antrean => ADA, kuat
- indeks public.idx_tiket_layanan_tanggal => ADA, kuat
- indeks public.idx_tiket_kunjungan => ADA, kuat
- fungsi public.terbit_tiket(2 arg) => ADA, kuat
- policy "kunjungan_insert_public" ON public.kunjungan => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610080001)
- policy "kunjungan_select_own" ON public.kunjungan => ADA, kuat
- policy "kunjungan_staff_select" ON public.kunjungan => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "kunjungan_staff_update" ON public.kunjungan => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "tiket_insert_public" ON public.tiket_antrean => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610080001)
- policy "tiket_select_own" ON public.tiket_antrean => ADA, kuat
- policy "tiket_staff_select" ON public.tiket_antrean => ADA, kuat
- policy "tiket_staff_update" ON public.tiket_antrean => ADA, kuat

#### 202607300014 buku_tamu — terpasang

Alasan: 3 penanda kuat ada

- tabel public.buku_tamu => ADA, kuat
- indeks public.idx_buku_tamu_waktu => ADA, kuat
- indeks public.idx_buku_tamu_legacy_visit_id => ADA, kuat
- policy "buku_tamu_fo_admin_all" ON public.buku_tamu => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610090004)

#### 202607300015 backfill_kunjungan_dual_write — terpasang

Alasan: 7 penanda kuat ada, 2 lainnya objek bersama (ada)

- kolom public.kunjungan.legacy_visit_id => ADA, kuat
- constraint kunjungan_legacy_visit_id_key ON public.kunjungan => ADA, lemah (nama constraint pernah di-DROP sebelum dibuat (kemungkinan nama otomatis yang sudah ada))
- indeks public.idx_kunjungan_legacy_visit_id => ADA, kuat
- kolom public.tiket_antrean.legacy_visit_id => ADA, kuat
- constraint tiket_antrean_legacy_visit_id_key ON public.tiket_antrean => ADA, lemah (nama constraint pernah di-DROP sebelum dibuat (kemungkinan nama otomatis yang sudah ada))
- tabel public.wp21_backfill_ledger => ADA, kuat
- policy "wp21_backfill_ledger_admin_read" ON public.wp21_backfill_ledger => ADA, kuat
- fungsi public.sync_visit_dual_write(0 arg) => ADA, kuat
- trigger trg_visit_dual_write ON public.visit => ADA, kuat

#### 202607300016 wp22_views_tiket_antrean — terpasang

Alasan: 1 penanda kuat ada, 1 lainnya objek bersama (ada)

- view public.v_antrian_loket => ADA, lemah [juga dibuat oleh: 202607140005, 202607280005]
- fungsi public.get_queue_position(1 arg) => ADA, kuat [juga dibuat oleh: 202607200001] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))

#### 202607300017 wp23_akhir_hari_panggil — terpasang

Alasan: 2 penanda kuat ada, 1 lainnya objek bersama (ada)

- fungsi public.tandai_tidak_terlayani_akhir_hari(0 arg) => ADA, kuat
- cron job antrean_tidak_terlayani_akhir_hari => ADA, kuat
- fungsi public.panggil_tiket(1 arg) => ADA, lemah [juga dibuat oleh: 202610080001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))

#### 202607300018 chat_persisten — terpasang

Alasan: 1 penanda kuat ada, 2 lainnya objek bersama (ada)

- kolom public.chat_pesan.jenis_jawaban => ADA, kuat
- indeks public.idx_chat_sesi_status_updated => ADA, lemah [juga dibuat oleh: 202610070001]
- indeks public.idx_chat_pesan_sesi_created => ADA, lemah [juga dibuat oleh: 202610070001]

#### 202607300019 wp26_cms_registry — terpasang

Alasan: 5 penanda kuat ada

- kolom public.site_settings.keterangan => ADA, kuat
- kolom public.site_settings.boleh_diubah_dashboard => ADA, kuat
- tabel public.konten_versi => ADA, kuat
- indeks public.idx_konten_versi_ref => ADA, kuat
- policy "konten_versi_admin_all" ON public.konten_versi => ADA, kuat

#### 202607300020 wp30_rekap_harian — terpasang

Alasan: 6 penanda kuat ada, 1 lainnya objek bersama (ada)

- tabel public.rekap_harian_layanan => ADA, kuat
- tabel public.laporan_snapshot => ADA, kuat
- policy "rekap_harian_staff_read" ON public.rekap_harian_layanan => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "laporan_snapshot_admin_read" ON public.laporan_snapshot => ADA, kuat
- policy "laporan_snapshot_admin_insert" ON public.laporan_snapshot => ADA, kuat
- fungsi public.rollup_rekap_harian(1 arg) => ADA, kuat
- cron job rollup_rekap_harian_nightly => ADA, kuat

#### 202607300021 wp32_jejak_investasi — terpasang

Alasan: 5 penanda kuat ada

- tabel public.jejak_minat_investasi => ADA, kuat
- indeks public.idx_jejak_investasi_pengunjung => ADA, kuat
- indeks public.idx_jejak_investasi_jenis => ADA, kuat
- policy "jejak_investasi_pengunjung_insert" ON public.jejak_minat_investasi => ADA, kuat
- policy "jejak_investasi_admin_read" ON public.jejak_minat_investasi => ADA, kuat

#### 202607300022 wp29_layar_token — terpasang

Alasan: 3 penanda kuat ada, 1 lainnya objek bersama (ada)

- tabel public.layar_token => ADA, kuat
- policy "layar_token_admin_all" ON public.layar_token => ADA, kuat
- view public.v_layar_antrian => ADA, lemah [juga dibuat oleh: 202610090004]
- fungsi public.validate_layar_token(1 arg) => ADA, kuat

#### 202607300023 wp27_dokumen_rag — terpasang

Alasan: 9 penanda kuat ada, 1 lainnya objek bersama (ada)

- ekstensi vector => ADA, lemah [juga dibuat oleh: 202607140001]
- tabel public.dokumen_peraturan => ADA, kuat
- indeks public.idx_dokumen_peraturan_layanan => ADA, kuat
- tabel public.dokumen_potongan => ADA, kuat
- indeks public.idx_dokumen_potongan_dokumen => ADA, kuat
- indeks public.idx_dokumen_potongan_embedding => ADA, kuat
- policy "dokumen_peraturan_staff_read" ON public.dokumen_peraturan => ADA, kuat
- policy "dokumen_peraturan_admin_write" ON public.dokumen_peraturan => ADA, kuat
- policy "dokumen_potongan_staff_read" ON public.dokumen_potongan => ADA, kuat
- fungsi public.match_dokumen(4 arg) => ADA, kuat

#### 202607300024 wp31_umkm_verifikasi — terpasang

Alasan: 12 penanda kuat ada, 2 lainnya objek bersama (ada)

- kolom public.listing_umkm.nib => ADA, kuat
- kolom public.listing_umkm.npwp => ADA, kuat
- kolom public.listing_umkm.nama_badan_usaha => ADA, kuat
- kolom public.listing_umkm.berkas_legalitas_path => ADA, kuat
- kolom public.listing_umkm.kontak_terverifikasi => ADA, kuat
- kolom public.listing_umkm.berlaku_sampai => ADA, kuat
- kolom public.listing_umkm.catatan_review => ADA, kuat
- kolom public.listing_umkm.snapshot_approved => ADA, lemah [juga dibuat oleh: 202607140003]
- constraint listing_umkm_status_check ON public.listing_umkm => ADA, lemah (nama constraint pernah di-DROP sebelum dibuat (kemungkinan nama otomatis yang sudah ada))
- tabel public.umkm_verifikasi_jejak => ADA, kuat
- indeks public.idx_umkm_jejak_listing => ADA, kuat
- policy "umkm_jejak_admin_all" ON public.umkm_verifikasi_jejak => ADA, kuat
- fungsi public.tandai_listing_umkm_expired(0 arg) => ADA, kuat
- cron job listing_umkm_expired => ADA, kuat

#### 202608080002 faq_embedding_3072 — terpasang

Alasan: 1 penanda kuat ada, 1 lainnya objek bersama (ada)

- DROP indeks public.idx_faq_embedding => tidak ada (sesuai DROP; bukan bukti)
- tipe kolom public.faq_knowledge_base.embedding = vector(3072) => ADA, kuat
- fungsi public.match_faq(3 arg) => ADA, lemah [juga dibuat oleh: 202607140004, 202610130001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))

#### 202608290001 pendataan_pelayanan — terpasang

Alasan: 13 penanda kuat ada, 8 lainnya objek bersama (ada)

- tabel public.pelayanan_oss => ADA, kuat
- indeks public.idx_pelayanan_oss_tiket => ADA, kuat
- indeks public.idx_pelayanan_oss_kunjungan => ADA, kuat
- indeks public.idx_pelayanan_oss_petugas => ADA, kuat
- indeks public.idx_pelayanan_oss_created => ADA, kuat
- tabel public.pelayanan_perizinan => ADA, kuat
- indeks public.idx_pelayanan_perizinan_tiket => ADA, kuat
- indeks public.idx_pelayanan_perizinan_kunjungan => ADA, kuat
- indeks public.idx_pelayanan_perizinan_petugas => ADA, kuat
- indeks public.idx_pelayanan_perizinan_created => ADA, kuat
- fungsi public.trg_enforce_pelayanan_lock(0 arg) => ADA, lemah [juga dibuat oleh: 202610090001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))
- trigger trg_oss_lock ON public.pelayanan_oss => ADA, kuat
- trigger trg_perizinan_lock ON public.pelayanan_perizinan => ADA, kuat
- view public.v_rekap_pelayanan_oss => ADA, kuat
- view public.v_rekap_pelayanan_perizinan => ADA, lemah [juga dibuat oleh: 202610010001]
- policy "oss_read_staff" ON public.pelayanan_oss => ADA, lemah [juga dibuat oleh: 202610010001, 202610090001]
- policy "oss_insert_staff" ON public.pelayanan_oss => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "oss_update_staff" ON public.pelayanan_oss => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "perizinan_read_staff" ON public.pelayanan_perizinan => ADA, lemah [juga dibuat oleh: 202610010001, 202610090001]
- policy "perizinan_insert_staff" ON public.pelayanan_perizinan => ADA, lemah [juga dibuat oleh: 202610090001]
- policy "perizinan_update_staff" ON public.pelayanan_perizinan => ADA, lemah [juga dibuat oleh: 202610090001]

#### 202608310002 reservasi_no_show — terpasang

Alasan: 4 penanda kuat ada

- fungsi public.tandai_reservasi_no_show(0 arg) => ADA, kuat
- cron job reservasi_no_show_harian => ADA, kuat
- fungsi public.cegah_checkin_reservasi_kedaluwarsa(0 arg) => ADA, kuat
- trigger trg_visit_qr_hangus ON public.visit => ADA, kuat

#### 202609230001 chat_realtime_hardening — terpasang

Alasan: 1 penanda kuat ada, 5 lainnya objek bersama (ada)

- publikasi supabase_realtime memuat public.chat_sesi => ADA, lemah [juga dibuat oleh: 202608080001]
- publikasi supabase_realtime memuat public.chat_pesan => ADA, lemah [juga dibuat oleh: 202608080001]
- DROP indeks public.idx_chat_pesan_client_uuid => tidak ada (sesuai DROP; bukan bukti)
- indeks public.uq_chat_pesan_sesi_client_uuid => ADA, kuat
- policy "chat_sesi_owner_select" ON public.chat_sesi => ADA, lemah [juga dibuat oleh: 202607140004]
- policy "chat_sesi_petugas_update" ON public.chat_sesi => ADA, lemah [juga dibuat oleh: 202607140004]
- policy "chat_pesan_owner_select" ON public.chat_pesan => ADA, lemah [juga dibuat oleh: 202607140004]

#### 202609230002 faq_fts — terpasang

Alasan: 9 penanda kuat ada, 1 lainnya objek bersama (ada)

- ekstensi pg_trgm => ADA, kuat
- ekstensi unaccent => ADA, kuat
- fungsi public.unaccent_imm(1 arg) => ADA, kuat
- kolom public.faq_knowledge_base.fts => ADA, kuat
- indeks public.idx_faq_fts => ADA, kuat
- indeks public.idx_faq_trgm => ADA, kuat
- tabel public.faq_sinonim => ADA, kuat
- policy "faq_sinonim_read" ON public.faq_sinonim => ADA, kuat
- policy "faq_sinonim_admin_all" ON public.faq_sinonim => ADA, kuat
- fungsi public.match_faq_teks(3 arg) => ADA, lemah [juga dibuat oleh: 202610130001] (isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini))

#### 202609230003 antrean_realtime — terpasang

Alasan: 7 penanda kuat ada

- publikasi supabase_realtime memuat public.tiket_antrean => ADA, kuat
- publikasi supabase_realtime memuat public.visit => ADA, kuat
- fungsi public.antrean_broadcast(0 arg) => ADA, kuat
- trigger trg_antrean_broadcast ON public.tiket_antrean => ADA, kuat
- policy "antrean_publik_receive" ON realtime.messages => ADA, kuat
- kolom public.visit.client_request_id => ADA, kuat
- indeks public.uq_visit_client_request_id => ADA, kuat

#### 202610010001 non_oss_rename — terpasang

Alasan: 2 penanda kuat ada, 3 lainnya objek bersama (ada)

- kolom public.pelayanan_perizinan.lokasi_usaha => ADA, kuat
- view public.v_rekap_pelayanan_perizinan => ADA, lemah [juga dibuat oleh: 202608290001]
- policy "oss_read_staff" ON public.pelayanan_oss => ADA, lemah [juga dibuat oleh: 202608290001, 202610090001]
- policy "perizinan_read_staff" ON public.pelayanan_perizinan => ADA, lemah [juga dibuat oleh: 202608290001, 202610090001]
- policy "audit_log_insert_own" ON public.audit_log => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610090004)
- fungsi public.finalize_pelayanan(3 arg) => ADA, kuat [juga dibuat oleh: 202608310001] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))

#### 202610070001 chat_fix_guard_ringkas — terpasang

Alasan: 4 penanda kuat ada, 2 lainnya objek bersama (ada)

- fungsi public.guard_chat_sesi_staff_columns(0 arg) => ADA, kuat [juga dibuat oleh: 202607200001] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- fungsi public.bump_chat_sesi_updated_at(0 arg) => ADA, kuat
- trigger trg_bump_chat_sesi_on_pesan ON public.chat_pesan => ADA, kuat
- indeks public.idx_chat_pesan_sesi_created => ADA, lemah [juga dibuat oleh: 202607300018]
- indeks public.idx_chat_sesi_status_updated => ADA, lemah [juga dibuat oleh: 202607300018]
- fungsi public.chat_sesi_ringkas(2 arg) => ADA, kuat

#### 202610080001 rbac_tahap0_keamanan — terpasang

Alasan: 13 penanda kuat ada, 3 lainnya objek bersama (ada)

- DROP fungsi public.catat_absensi(4 arg) => DIGANTIKAN (dibuat ulang oleh migrasi lebih baru, oleh 202610090001)
- fungsi public.staf_saya(0 arg) => ADA, kuat
- fungsi public.boleh_layanan(1 arg) => ADA, kuat
- fungsi public.get_my_layanan_id(0 arg) => ADA, kuat [juga dibuat oleh: 202607140004] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- fungsi public.is_ptsp_staff(0 arg) => ADA, kuat [juga dibuat oleh: 202607280001] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- fungsi public.set_user_role_claim(1 arg) => ADA, kuat [juga dibuat oleh: 202607140004] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- fungsi public.petugas_set_nonaktif(3 arg) => ADA, kuat [juga dibuat oleh: 202607290004] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- fungsi public.petugas_set_aktif(1 arg) => ADA, kuat [juga dibuat oleh: 202607290004] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- fungsi public.guard_absensi_tanggal_today(0 arg) => ADA, kuat [juga dibuat oleh: 202607200001] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- fungsi public.catat_absensi(3 arg) => DIGANTIKAN (di-DROP oleh migrasi lebih baru, oleh 202610090001)
- fungsi public.catat_pulang(1 arg) => ADA, kuat [juga dibuat oleh: 202608040001] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- fungsi public.setujui_absensi(2 arg) => ADA, kuat
- policy "absensi_select_own" ON public.absensi_petugas => ADA, lemah [juga dibuat oleh: 202607140004, 202610090001]
- DROP policy "absensi_insert_own" ON public.absensi_petugas => tidak ada (sesuai DROP; bukan bukti)
- DROP policy "absensi_update_own" ON public.absensi_petugas => tidak ada (sesuai DROP; bukan bukti)
- policy "absensi_insert_admin" ON public.absensi_petugas => ADA, kuat
- policy "absensi_update_admin" ON public.absensi_petugas => ADA, kuat
- fungsi public.panggil_tiket(1 arg) => ADA, kuat [juga dibuat oleh: 202607300017] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- DROP policy "kunjungan_insert_public" ON public.kunjungan => tidak ada (sesuai DROP; bukan bukti)
- DROP policy "tiket_insert_public" ON public.tiket_antrean => tidak ada (sesuai DROP; bukan bukti)
- policy "visit_insert_walk_in" ON public.visit => ADA, lemah [juga dibuat oleh: 202607140004, 202607200001]
- policy "visit_insert_reservasi" ON public.visit => ADA, lemah [juga dibuat oleh: 202607140004]

#### 202610080002 rbac_tahap0_layanan_admin_only — terpasang

Alasan: 4 penanda kuat ada

- DROP policy "layanan_petugas_chatbot_toggle" ON public.layanan => tidak ada (sesuai DROP; bukan bukti)
- DROP policy "jadwal_ptsp_write" ON public.layanan_jadwal => tidak ada (sesuai DROP; bukan bukti)
- DROP policy "libur_ptsp_write" ON public.layanan_libur => tidak ada (sesuai DROP; bukan bukti)
- DROP policy "hari_libur_staff_write" ON public.hari_libur => tidak ada (sesuai DROP; bukan bukti)
- DROP policy "layanan_jadwal_cross_service_write" ON public.layanan_jadwal => tidak ada (sesuai DROP; bukan bukti)
- policy "layanan_jadwal_admin_write" ON public.layanan_jadwal => ADA, kuat
- DROP policy "layanan_libur_cross_service_write" ON public.layanan_libur => tidak ada (sesuai DROP; bukan bukti)
- policy "layanan_libur_admin_write" ON public.layanan_libur => ADA, kuat
- DROP policy "jadwal_standby_staff_write" ON public.jadwal_standby => tidak ada (sesuai DROP; bukan bukti)
- policy "jadwal_standby_admin_write" ON public.jadwal_standby => ADA, kuat
- DROP policy "jadwal_pengecualian_staff_write" ON public.jadwal_pengecualian => tidak ada (sesuai DROP; bukan bukti)
- policy "jadwal_pengecualian_admin_write" ON public.jadwal_pengecualian => ADA, kuat

#### 202610090001 rbac_tahap1 — terpasang

Alasan: 16 penanda kuat ada, 18 lainnya objek bersama (ada)

- fungsi public.peran_saya(0 arg) => ADA, kuat
- fungsi public.boleh_tiket(1 arg) => ADA, kuat
- fungsi public.boleh_kunjungan(1 arg) => ADA, kuat
- fungsi public.trg_enforce_pelayanan_lock(0 arg) => ADA, kuat [juga dibuat oleh: 202608290001] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- policy "oss_read_staff" ON public.pelayanan_oss => ADA, lemah [juga dibuat oleh: 202608290001, 202610010001]
- policy "oss_insert_staff" ON public.pelayanan_oss => ADA, lemah [juga dibuat oleh: 202608290001]
- policy "oss_update_staff" ON public.pelayanan_oss => ADA, lemah [juga dibuat oleh: 202608290001]
- policy "perizinan_read_staff" ON public.pelayanan_perizinan => ADA, lemah [juga dibuat oleh: 202608290001, 202610010001]
- policy "perizinan_insert_staff" ON public.pelayanan_perizinan => ADA, lemah [juga dibuat oleh: 202608290001]
- policy "perizinan_update_staff" ON public.pelayanan_perizinan => ADA, lemah [juga dibuat oleh: 202608290001]
- fungsi public.koreksi_pelayanan(4 arg) => ADA, kuat
- policy "kunjungan_staff_select" ON public.kunjungan => ADA, lemah [juga dibuat oleh: 202607290013]
- policy "kunjungan_staff_update" ON public.kunjungan => ADA, lemah [juga dibuat oleh: 202607290013]
- policy "visit_select_own" ON public.visit => ADA, lemah [juga dibuat oleh: 202607140004]
- policy "visit_update_staff" ON public.visit => ADA, lemah [juga dibuat oleh: 202607140004]
- policy "rekap_harian_staff_read" ON public.rekap_harian_layanan => ADA, lemah [juga dibuat oleh: 202607300020]
- policy "investasi_lead_select_staff" ON public.investasi_lead => ADA, lemah [juga dibuat oleh: 202607140004]
- policy "skm_select_staff" ON public.skm_respons => ADA, lemah [juga dibuat oleh: 202607140004]
- view public.v_skm_petugas => ADA, kuat
- policy "pengaduan_layanan_read" ON public.pengaduan => ADA, lemah [juga dibuat oleh: 202607290007]
- policy "pengaduan_integritas_admin_only" ON public.pengaduan => ADA, lemah [juga dibuat oleh: 202607290007]
- policy "pengaduan_update" ON public.pengaduan => ADA, lemah [juga dibuat oleh: 202607290007]
- policy "pengaduan_riwayat_write" ON public.pengaduan_riwayat => ADA, lemah [juga dibuat oleh: 202607290007]
- view public.v_pengaduan_petugas => ADA, kuat
- kolom public.absensi_petugas.foto_url => ADA, kuat
- storage bucket absensi-foto => ADA, kuat
- policy "absensi_foto_insert" ON storage.objects => ADA, kuat
- policy "absensi_foto_select" ON storage.objects => ADA, kuat
- policy "absensi_select_own" ON public.absensi_petugas => ADA, lemah [juga dibuat oleh: 202607140004, 202610080001]
- DROP fungsi public.catat_absensi(3 arg) => tidak ada (sesuai DROP; bukan bukti)
- fungsi public.catat_absensi(4 arg) => ADA, kuat
- fungsi public.jam_tutup_layanan(0 arg) => ADA, kuat
- fungsi public.layanan_sudah_tutup(1 arg) => ADA, kuat
- DROP policy "layanan_hari_staff_write" ON public.layanan_hari => tidak ada (sesuai DROP; bukan bukti)
- policy "layanan_hari_admin_write" ON public.layanan_hari => ADA, kuat
- fungsi public.guard_visit_layanan_buka(0 arg) => ADA, kuat [juga dibuat oleh: 202607280001, 202607290010] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))

#### 202610090002 akun_username — terpasang

Alasan: 22 penanda kuat ada

- kolom public.petugas.username => ADA, kuat
- kolom public.petugas.no_hp => ADA, kuat
- kolom public.petugas.email_notifikasi => ADA, kuat
- kolom public.petugas.email_notifikasi_verified_at => ADA, kuat
- kolom public.petugas.operator_default => ADA, kuat
- kolom public.petugas.wajib_ganti_sandi => ADA, kuat
- constraint petugas_username_format ON public.petugas => ADA, kuat
- constraint petugas_username_key ON public.petugas => ADA, kuat
- constraint petugas_no_hp_format ON public.petugas => ADA, kuat
- constraint petugas_email_notifikasi_format ON public.petugas => ADA, kuat
- constraint petugas_operator_default_len ON public.petugas => ADA, kuat
- fungsi public.petugas_ubah_profil(1 arg) => ADA, kuat
- tabel public.petugas_verif_email => ADA, kuat
- fungsi public.petugas_verifikasi_email(1 arg) => ADA, kuat
- fungsi public.tersamarkan_email(1 arg) => ADA, kuat
- fungsi public.akun_daftar(0 arg) => ADA, kuat
- fungsi public.akun_akhiri_sesi(1 arg) => ADA, kuat
- fungsi public.guard_admin_terakhir(0 arg) => ADA, kuat
- trigger trg_guard_admin_terakhir ON public.petugas => ADA, kuat
- kolom public.absensi_petugas.operator_nama => ADA, kuat
- fungsi public.absensi_isi_operator(0 arg) => ADA, kuat
- trigger trg_absensi_isi_operator ON public.absensi_petugas => ADA, kuat

#### 202610090003 konsol_pengaturan — terpasang

Alasan: 10 penanda kuat ada

- tabel public.rahasia_pengaturan => ADA, kuat
- tabel public.pengaturan_sistem => ADA, kuat
- indeks public.uq_pengaturan_aktif => ADA, kuat
- indeks public.uq_pengaturan_draf => ADA, kuat
- tabel public.pengaturan_riwayat => ADA, kuat
- indeks public.idx_pengaturan_riwayat_kunci => ADA, kuat
- fungsi public.simpan_draf_pengaturan(5 arg) => ADA, kuat
- fungsi public.aktifkan_pengaturan(5 arg) => ADA, kuat
- fungsi public.rollback_pengaturan(4 arg) => ADA, kuat
- fungsi public.match_dokumen_layanan(4 arg) => ADA, kuat

#### 202610090004 kelola_layanan_audit — terpasang

Alasan: 20 penanda kuat ada, 1 lainnya objek bersama (ada)

- kolom public.layanan.tampil_di_layar => ADA, kuat
- view public.v_layar_antrian => ADA, lemah [juga dibuat oleh: 202607300022]
- view public.v_layanan_publik => ADA, kuat
- DROP policy "buku_tamu_fo_admin_all" ON public.buku_tamu => tidak ada (sesuai DROP; bukan bukti)
- policy "buku_tamu_staff_select" ON public.buku_tamu => ADA, kuat
- policy "buku_tamu_staff_insert" ON public.buku_tamu => ADA, kuat
- policy "buku_tamu_admin_update" ON public.buku_tamu => ADA, kuat
- policy "buku_tamu_admin_delete" ON public.buku_tamu => ADA, kuat
- kolom public.audit_log.nilai_lama => ADA, kuat
- kolom public.audit_log.nilai_baru => ADA, kuat
- indeks public.idx_audit_log_entitas_waktu => ADA, kuat
- indeks public.idx_audit_log_aksi => ADA, kuat
- DROP policy "audit_log_insert_own" ON public.audit_log => tidak ada (sesuai DROP; bukan bukti)
- fungsi public.audit_saring(2 arg) => ADA, kuat
- fungsi public.audit_perubahan(0 arg) => ADA, kuat
- trigger trg_audit_layanan ON public.layanan => ADA, kuat
- trigger trg_audit_layanan_jadwal ON public.layanan_jadwal => ADA, kuat
- trigger trg_audit_layanan_libur ON public.layanan_libur => ADA, kuat
- trigger trg_audit_site_settings ON public.site_settings => ADA, kuat
- trigger trg_audit_landing_content ON public.landing_content => ADA, kuat
- trigger trg_audit_faq ON public.faq_knowledge_base => ADA, kuat
- trigger trg_audit_layar_token ON public.layar_token => ADA, kuat
- DROP trigger trg_audit_petugas_role ON public.petugas => tidak ada (sesuai DROP; bukan bukti)
- trigger trg_audit_petugas_ubah ON public.petugas => ADA, kuat

#### 202610090005 perbaikan_review — terpasang

Alasan: 6 penanda kuat ada

- policy "petugas_fo_read" ON public.petugas => ADA, kuat
- kolom public.rahasia_pengaturan.host => ADA, kuat
- fungsi public.guard_admin_terakhir_hapus(0 arg) => ADA, kuat
- trigger trg_guard_admin_terakhir_hapus ON public.petugas => ADA, kuat
- fungsi public.guard_jam_tutup_layanan(0 arg) => ADA, kuat
- trigger trg_guard_jam_tutup_layanan ON public.site_settings => ADA, kuat

#### 202610130001 faq_umum — terpasang

Alasan: 3 penanda kuat ada

- policy "faq_fo_umum" ON public.faq_knowledge_base => ADA, kuat
- fungsi public.match_faq_teks(3 arg) => ADA, kuat [juga dibuat oleh: 202609230002] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))
- fungsi public.match_faq(3 arg) => ADA, kuat [juga dibuat oleh: 202607140004, 202608080002] (isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat))

#### 202610130002 faq_petugas_hanya_petugas — tidak_dapat_ditentukan

Alasan: semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini)

- policy "faq_petugas_all" ON public.faq_knowledge_base => ADA, lemah [juga dibuat oleh: 202607280003]

