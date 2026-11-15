# Fase 3: Koordinator, akses data per orang, dan Rekap terpadu

Catatan Fase 3 (penanda Koordinator, lingkup data per orang di RLS, Rekap terpadu `/admin/rekap`) dan harness PGlite yang membuktikannya, dipindah utuh dari `CLAUDE.md` pada 2026-11-13. Rujukan: [rencana + inventaris jalur baca](../superpowers/plans/2026-10-29-fase-3-koordinator-rekap.md), [ADR 0003](../adr/0003-koordinator-dan-akses-data-per-orang.md), [matriks RBAC](../analysis/04-RBAC-MATRIX.md), status migrasi di [docs/MIGRATIONS.md](../MIGRATIONS.md).

Dari daftar "Domain" lama (dua kalimat pertama butir Rekap; butir utuhnya ada di [peta-kode-rinci.md](peta-kode-rinci.md)):

- Rekap terpadu (Fase 3): `admin/rekap` (tab: Rekap Harian, Helpdesk OSS, Non OSS, Data Pelayanan + Excel, Kinerja Petugas; tab Helpdesk OSS/Non OSS terkunci ke Layanan berformulir `oss`/`perizinan` agar kolom formulir langsung tampil dan hanya muncul bila Layanan itu ada dalam lingkup pengguna; tab Data Pelayanan = Layanan lain (mengirim `tanpa_form=1` -> `rekap_data_pelayanan(..., p_tanpa_form)`, migrasi `202611010005`, belum diterapkan; Harian/Kinerja tetap semua Layanan); `admin/rekap-fo` redirect) -> `api/admin/rekap/terpadu[/export]` -> RPC berlingkup `rekap_data_pelayanan`/`rekap_harian_terpadu`/`rekap_kinerja_petugas` (migrasi `202610290002`); logika di `src/lib/rekap/{terpadu,terpaduServer,excelTerpadu}.ts`. `admin/performa` (Admin) tetap.

**Koordinator & akses data per orang (Fase 3, migrasi `202610290001`/`0002`, belum diterapkan; ADR 0003):** penanda `petugas.koordinator` (bukan role; diatur `/admin/petugas`). Lingkup data: admin & FO Koordinator semua; Petugas Koordinator Layanannya; selain itu hanya yang ia tangani. RLS `boleh_penanganan`/`boleh_kunjungan`/`boleh_baca_pendataan` = lingkup + jendela operasional (HANYA pekerjaan terbuka; yang sudah ditutup termasuk hari ini = lingkup saja); arsip `visit` hanya admin/Koordinator; Rekap memakai lingkup ketat lewat RPC (dasar internal `rekap_pelayanan_inti`). Rollback: `docs/rollback-{rekap-terpadu-202610290002,koordinator-akses-data-202610290001}.sql`. Ambil alih: `koordinator_ambil_alih_{tiket,fo}` (+ `ambil_alih_pendataan`, notifikasi). Membalik `202610140013`. Inventaris jalur baca + keputusan: `docs/superpowers/plans/2026-10-29-fase-3-koordinator-rekap.md`; matriks `docs/analysis/04-RBAC-MATRIX.md` §7.

**Harness rantai penuh PGlite:** `scripts/lokal-rantai/` (`npm i --no-save @electric-sql/pglite`) menerapkan seluruh migrasi ke Postgres dalam-proses dan menjalankan skenario RLS/RPC pada skema asli (`node scripts/lokal-rantai/skenario-akses-data.mjs`); batas (tanpa pgvector/pg_cron) di README-nya. Migrasi `202611010002` menutup celah RLS `tiket_antrean` (belum diterapkan).

## Catatan refaktor 2026-11-13

- Frasa "belum diterapkan" di atas (`202610290001`/`0002`, `202611010002`, `202611010005`) adalah keadaan saat teks ditulis; lihat `docs/MIGRATIONS.md` dan `CLAUDE.md` bagian "Database & migrasi" (sebagian judul di MIGRATIONS.md tertinggal).
- G0-G1: `api/admin/rekap/terpadu` mengukur langkahnya dengan header `Server-Timing` (`buatPengukur` di `src/lib/observability/durasi.ts`). Menurut handover, rekap kini paralel dan ber-`maxDuration`, exceljs keluar dari bundel klien, dan Recharts dimuat malas.
- Migrasi rekap `202611110001` yang direncanakan G2 tidak ada di repo; menurut handover SQL rekap sudah cepat (4-17 ms hangat) sehingga tidak diperlukan.
- Halaman `admin/rekap` belum dipecah dengan pola `_logika/` + `_hook/` + `_bagian/`; `src/lib/rekap/*` tetap di tempatnya.
