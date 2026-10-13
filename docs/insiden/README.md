# Arsip insiden produksi

Skrip perbaikan sekali pakai yang dijalankan langsung ke DB produksi di luar jalur migrasi. **Hanya arsip — jangan dijalankan ulang** dan jangan dijadikan pola; perbaikan insiden wajib lewat migrasi forward baru (aturan T11, lihat `docs/superpowers/specs/2026-10-13-fondasi-dependensi-migrasi-error-publik-design.md`).

| Berkas | Insiden | Keadaan sekarang |
|---|---|---|
| `2026-09-24-fix-antrean-broadcast.mjs` | `202609230003_antrean_realtime.sql` membuat SEMUA insert `visit`/`tiket_antrean` gagal di produksi (~16 jam, 23–24 Sep) karena `broadcast_changes` salah signature. Diganti ke `realtime.send`. | Fungsi `antrean_broadcast` di produksi memakai `realtime.send` (terverifikasi 2026-10-13); file migrasi di HEAD sudah benar. |
