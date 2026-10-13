# Aturan migrasi database

Berlaku untuk semua orang dan agent yang menyentuh `supabase/migrations/`. Keputusan CEO setelah insiden produksi 23–24 Sep 2026 (`202609230003_antrean_realtime.sql` membuat semua insert `visit`/`tiket_antrean` gagal ±16 jam, lalu diperbaiki dengan mengedit file migrasi di tempat dan skrip ad-hoc). Arsip insiden: `docs/insiden/`.

## Larangan

1. **Dilarang mengedit migrasi yang sudah ada** (isi, nama, atau menghapusnya) — walau hanya satu karakter, walau "baru sedikit yang memakai". `supabase/migrations/MANIFEST.json` mencatat SHA-256 tiap file; `manifest.test.ts` gagal bila ada yang berubah, hilang, atau belum terdaftar. Jangan "menyembuhkan" test dengan mengedit `MANIFEST.json` secara manual: perubahan pada baris lama di manifest = pelanggaran aturan dan harus ditolak saat review.
2. **Perbaikan insiden = migrasi forward baru** (`CREATE OR REPLACE`, `ALTER`, dst.) **+ test kontrak + rollback SQL.** Bukan edit migrasi lama.
3. **Dilarang skrip ad-hoc ke produksi** (mis. `.mjs` sekali pakai, `exec_sql` manual, paste SQL di Dashboard/SQL Editor). Satu-satunya jalur ke produksi: `scripts/apply-migration.mjs` dengan **konfirmasi CEO**.
4. **Setiap migrasi baru dicatat** di `docs/MIGRATIONS.md` dan `docs/analysis/DB-CHANGES.md` **pada commit yang sama** dengan file migrasinya.

## Menambah migrasi baru

1. Buat `supabase/migrations/YYYYMMDDNNNN_nama_snake_case.sql` (12 digit versi, harus unik dan lebih besar dari semua yang ada; pola `^\d{12}_[a-z0-9_]+\.sql$`). Jangan ada `BEGIN/COMMIT` sendiri (`--atomic` membungkus transaksi).
2. Buat test kontrak statis di sebelahnya (`supabase/migrations/<nama>.test.ts`), meniru test yang sudah ada.
3. Tambahkan nama file ke `FORWARD_MIGRATION_FILES` di `supabase/migrations/migration-test-utils.ts` (dipakai test inventori `migration-files.test.ts`).
4. Jalankan `node scripts/gen-migration-manifest.mjs`. Mode ini **tambah-saja**: file baru dimasukkan; bila file lama berubah/hilang, skrip menolak dan tidak menulis apa pun. `node scripts/gen-migration-manifest.mjs --check` memeriksa tanpa menulis.
5. Jalankan `npx vitest run --pool=vmForks supabase/migrations/manifest.test.ts` dan test kontrak baru sampai lulus; lalu `npm run verify:baseline` sebelum push.
6. Tulis rollback di `docs/rollback-<nama>.sql` (contoh: `docs/rollback-rbac-tahap1-202610090001.sql`).
7. Catat di `docs/MIGRATIONS.md` dan `docs/analysis/DB-CHANGES.md` (format entri ada di DB-CHANGES), lalu commit semuanya bersama.

## Menerapkan ke produksi

- Hanya `node scripts/apply-migration.mjs supabase/migrations/<file>.sql --atomic`, **selalu `--dry-run` dulu** (jalankan lalu ROLLBACK), baru terapkan sungguhan setelah **konfirmasi CEO**. Skrip ini menyentuh DB produksi via `.env.local`.
- **Jangan `supabase db push` sebelum ledger terisi.** Tabel `supabase_migrations.schema_migrations` di produksi baru mencatat sebagian migrasi (lihat `docs/analysis/LEDGER-VERIFIKASI-2026-10-13.md`); `db push --include-all` akan mencoba menjalankan ulang migrasi yang belum tercatat padahal sebagian sudah terpasang. Pengisian ledger (bila dilakukan) harus dicatat di `docs/analysis/DB-CHANGES.md`; sampai ada catatan itu, anggap ledger belum terisi dan jangan memakai `db push`.
