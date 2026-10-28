# Migrasi berkas Supabase Storage -> Cloudflare R2

Urutan cutover (tanpa saklar fitur):
1. Pasang env `R2_*` di Doppler/Vercel; CORS bucket privat R2 (AllowedOrigins = domain LMH, AllowedMethods = PUT, AllowedHeaders = content-type, MaxAge 3600); domain publik bucket publik.
2. Dry-run: `doppler run --project lmh --config prd -- node scripts/migrasi-r2/salin-dari-supabase.mjs`
3. Salin: tambahkan `--jalankan`. **Lakukan SEBELUM merge/deploy** (aplikasi baru membaca dari R2).
4. Terapkan migrasi `202611030004` (CHECK https) dan `202611030005` (kolom lampiran chat), deploy aplikasi.
5. Ulangi langkah 3 (menangkap berkas yang masuk di antara), lalu `tulis-ulang-url-umkm.mjs --jalankan`.
6. Setelah beberapa hari stabil: bucket Supabase boleh dikosongkan pemilik (tidak ada skrip penghapus).
