# Harness rantai penuh (PGlite)

Menerapkan SELURUH `supabase/migrations/*.sql` (kecuali baseline ekstensi `202607140001`) ke Postgres dalam-proses
(PGlite/WASM) di atas stub infrastruktur Supabase, lalu menjalankan skenario perilaku (RLS, RPC) pada skema ASLI,
bukan stub tabel seperti `scripts/lokal` di branch survei. Tanpa jaringan, tanpa `.env`, tanpa DB produksi.

```bash
npm i --no-save @electric-sql/pglite      # tidak masuk package.json; ulangi setelah npm ci
node scripts/lokal-rantai/skenario-akses-data.mjs   # ~15 detik, exit 1 bila ada cek gagal
```

Skenario `skenario-akses-data.mjs`: kunjungan, penanganan, tiket_antrean, buku_tamu, chat_sesi/chat_pesan, rekap terpadu,
pencarian pengunjung (Fase 6), dan wewenang ambil alih, untuk admin, FO, FO Koordinator, petugas, Petugas Koordinator,
pengunjung, dan anon. Fungsi di `harness.mjs`: `bukaDbPenuh({ sampai })`, `sebagai(db, role, uid, sql, params?, jwt?)`,
`cek`, `ringkas`. `sampai: '202610290002'` menerapkan rantai hanya sampai nomor itu (mis. untuk uji sebelum/sesudah).

## Batas (baca sebelum percaya hasilnya)

- pgvector tidak ada di PGlite: tipe `vector(N)` disimulasikan domain `float8[]`, indeks hnsw/ivfflat dibuang. Fungsi RAG
  (`match_faq`, `match_dokumen`) TIDAK dapat diuji.
- `pg_cron` hanya stub (`cron.schedule` mencatat baris); job tidak berjalan. `realtime.send` = no-op.
- JWT disimulasikan lewat GUC `app.uid` / `app.jwt`; klaim `session_id` tidak ada, sehingga `sesi_valid()` memakai jalur
  `transisi` (sesi tunggal tidak aktif).
- `202609020001` membuat ulang policy `hari_libur_public_read` tanpa DROP; harness menambahkan DROP di depannya. Itu cerminan
  riwayat produksi, bukan bug harness.
- Data seed ditulis sebagai superuser; trigger penjaga `chat_sesi` dilewati dengan `session_replication_role = replica`.
- Bukan pengganti dry-run dan verifikasi pemilik pada DB nyata (statistik, `EXPLAIN`, lock indeks, data produksi).
