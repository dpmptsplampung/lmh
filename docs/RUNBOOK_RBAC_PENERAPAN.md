# Runbook penerapan RBAC 20261009 0001 -> 0005

Semua perintah menyentuh DB PRODUKSI: butuh persetujuan CEO per migrasi. Tahap 0 (20261008 0001/0002) sudah di produksi.

## Urutan penerapan (berurutan, satu per satu, ATOMIK)
Syarat tiap langkah: langkah sebelumnya lolos; UI/route yang bergantung sudah terdeploy (lihat kontrak). Jangan melompati.
```
node scripts/apply-migration.mjs supabase/migrations/202610090001_rbac_tahap1.sql --atomic --yes
node scripts/apply-migration.mjs supabase/migrations/202610090002_akun_username.sql --atomic --yes
   (lalu scripts/migrate-akun-username.mjs atas izin CEO bila akun lama dimigrasi ke username)
node scripts/apply-migration.mjs supabase/migrations/202610090003_konsol_pengaturan.sql --atomic --yes
node scripts/apply-migration.mjs supabase/migrations/202610090004_kelola_layanan_audit.sql --atomic --yes
node scripts/apply-migration.mjs supabase/migrations/202610090005_perbaikan_review.sql --atomic --yes
```
Sebelum tiap langkah, dry-run (BEGIN ... ROLLBACK, hitung baris sebelum/sesudah), mis. untuk 0004+0005:
```
node scripts/test-rbac-akhir.mjs --pre ...0001 --pre ...0002 --pre ...0003 --apply ...0004 --apply ...0005
```
Skrip lain: `test-rbac-tahap1.mjs`, `test-rbac-akun.mjs`, `test-konsol-pengaturan.mjs`.
Catatan: setelah 0005, `site_settings.jam_tutup_layanan` hanya boleh `16:00` (job akhir-hari 09:00 UTC); skrip uji lama yang menyetel 23:59 harus memakai `set_config('lmh.izinkan_jam_tutup','on',true)` (atau dijalankan sebelum 0005).

## Urutan rollback (kebalikan): 0005 -> 0004 -> 0003 -> 0002 -> 0001
```
node scripts/apply-migration.mjs docs/rollback-rbac-akhir-202610090005.sql --atomic --yes
node scripts/apply-migration.mjs docs/rollback-rbac-akhir-202610090004.sql --atomic --yes
node scripts/apply-migration.mjs docs/rollback-rbac-konsol-202610090003.sql --atomic --yes
node scripts/apply-migration.mjs docs/rollback-rbac-tahap2-202610090002.sql --atomic --yes
node scripts/apply-migration.mjs docs/rollback-rbac-tahap1-202610090001.sql --atomic --yes
```
Peringatan data tiap rollback ada di header file masing-masing (kolom/tabel dihapus beserta isinya). Rollback 0004 mengembalikan hak tulis audit_log langsung (S14 terbuka lagi).

## Residual yang diterima (belum diperbaiki)
- Review butir 7 (diabaikan atas keputusan koordinator).
- FO yang boleh membaca `petugas` (0005) ikut melihat kolom lain pada baris itu (mis. `email_notifikasi`, `no_hp`); RLS tidak membatasi kolom. Bila tak diinginkan: pindahkan ke view terbatas + ubah query UI.
- Penjaga "Admin aktif terakhir" (UPDATE dan DELETE) dilewati TRUNCATE dan `session_replication_role=replica` (hanya pemilik DB).
- `jam_tutup_layanan` dikunci 16:00; mengubahnya = migrasi yang menggeser job pg_cron bersamaan.
- Audit akun lewat service role dicatat oleh route (`audit()`), bukan trigger; `invite` mencatat `entitas_id` = auth user id.
