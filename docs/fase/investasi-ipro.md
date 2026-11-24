# Investment Gallery: IPRO PTSP, kartu FOILA, dan Kotak Masuk Investasi

Peta fitur ringkas untuk branch `investmentgallery` (kode `e21d2a2` sampai `930a4b2`, 2026-11-19/20). Sumber kebenaran rancangan: [spec IPRO PTSP](../superpowers/specs/2026-11-19-ipro-ptsp-design.md); catatan implementasi P1 di akhir spec itu menimpa bagian 2-nya. Bila ada selisih antara dokumen ini dan kode, kode yang benar.

## Status

- **Kode**: selesai di branch `investmentgallery`, belum digabung ke `main`.
- **Migrasi `202611190001` sampai `0005` DITERAPKAN ke produksi pada 2026-11-20** (tanpa staging; pemilik melewati aturan staging D-37 untuk ini). Prasyaratnya, `202611160001` sampai `0004`, sudah ada di produksi. Urutan dan prasyarat: [docs/MIGRATIONS.md](../MIGRATIONS.md).
- **Bukti perilaku DB** hanya lokal: harness PGlite `scripts/lokal-rantai/skenario-baru-ipro.mjs` dan test kontrak statis di `supabase/migrations/2026111900*.test.ts`.
- Sebelum migrasi diterapkan, halaman `/investasi` dan API-nya akan galat di lingkungan yang memakai DB produksi, karena tabel dan RPC belum ada.

## Keputusan pemilik (2026-11-19)

Rinciannya di [DECISION_LOG](../DECISION_LOG.md) (bagian "IPRO PTSP dan Kotak Masuk Investasi"). Ringkasnya:

- PTSP punya IPRO sendiri yang lebih lengkap daripada FOILA. FOILA dikelola PTSP tetapi lama tidak diperbarui, jadi kartu FOILA hanya cuplikan dengan tautan keluar ke `invest.lampungprov.go.id`, diisi manual oleh admin.
- Tombol "Hubungi petugas" per IPRO PTSP masuk ke Kotak Masuk Investasi. Formulirnya tanpa login (sesi anonim Supabase).
- Kontak publik hanya kontak lembaga. Pengelola = admin dan petugas modul `investasi`; Front Office tidak.
- `/peta-potensi` dialihkan ke `/investasi#peta-potensi`; peta v1 tanpa ubin. Sembilan sektor. Antarmuka Indonesia dulu, kolom `_en` sudah disiapkan.

## Model data

| Objek | Isi | Migrasi |
|---|---|---|
| `ipro_proyek` | Satu tabel dua jenis: `sumber='ptsp'` (halaman detail lengkap) dan `sumber='foila'` (kartu cuplikan). `status` draf/terbit/arsip, `slug` terkunci setelah pertama terbit, `versi` untuk kunci optimistik, kolom `_en`. Nilai investasi = angka + `mata_uang` (IDR/USD); kartu FOILA memakai `nilai_teks` (teks bebas). Sembilan sektor: pertanian, perikanan, pariwisata, industri, energi, infrastruktur, kawasan, jasa, lainnya. | `0001` |
| `ipro_gambar` | Gambar per proyek (kunci objek R2 WebP penuh dan 640 px, `alt` wajib, satu `utama` per proyek). Maksimum 12 gambar untuk PTSP dan 1 untuk kartu FOILA. | `0001`, aturan atomik di `0005` |
| `boleh_kelola_investasi()` | Helper RLS: admin (sesi valid) atau petugas yang layanannya bermodul `investasi`. Front Office tidak termasuk. | `0001` |
| `investasi_lead` (diperluas) | Dipakai bersama sebagai Kotak Masuk: kolom `kanal` (`dokumen`/`ipro`), `ipro_id`, `no_hp`, `aktor_uid`, `operasi_id`, `sidik`, `consent_id`, `petugas_id`, `versi`, `aktivitas_pada`. Sisip dan ubah status hanya lewat RPC. | `0002` |
| `investasi_kirim_minat`, `investasi_ubah_status_minat` | RPC kirim (idempoten per `operasi_id`, tiga lapis batas laju, mencatat `consent_log` dan notifikasi dalam satu transaksi) dan ubah status (kunci `versi`). | `0002` |
| `investasi_bersihkan_retensi` + cron `investasi_retensi_harian` | Hapus lead `selesai`/`ditolak` yang `aktivitas_pada`-nya lebih tua dari 365 hari, batch 500. Baris `consent_log` tidak dihapus. | `0002` |
| `investment_documents` (diperluas) | Status `diproses`/`gagal`, `halaman_selesai`, `galat`, `diproses_pada`, policy `investment_kelola_modul`; tabel `investment_pdf_claims` (penanda kunci unggahan yang sudah dipakai). | `0003` |
| `nav_lencana_saya` | Menambah kunci `pesanInvestasi` (jumlah lead berstatus `baru`) untuk pengelola investasi. | `0004` |
| RPC gambar dan status | `ipro_tambah_gambar`, `ipro_ubah_gambar`, `ipro_hapus_gambar`, `ipro_ubah_status`, trigger syarat terbit; semuanya mengunci baris proyek yang sama. | `0005` |

Hibah `SELECT` pada `ipro_proyek`/`ipro_gambar` bersifat per kolom dan tanpa `dibuat_oleh`/`diubah_oleh`, sehingga `select=*` sengaja gagal. Lapisan data memakai konstanta `KOLOM_*` di `src/lib/data/investasi.ts`.

## Alur pengelola (admin dan petugas modul investasi)

Navigasi: `src/lib/admin-nav.ts`, kelompok "Kemitraan & Investasi", tiga entri dengan `butuhModul: 'investasi'`.

| Menu | Rute admin | Rute petugas | Komponen |
|---|---|---|---|
| IPRO | `/admin/ipro` (+ `/baru`, `/[id]`) | `/petugas/investasi/ipro` | `src/components/admin/investasi/DaftarIpro`, `FormIpro` |
| Kotak Masuk Investasi | `/admin/investasi-leads` | `/petugas/investasi/kotak-masuk` | `KotakMasuk`, `KotakMasukPanel` |
| Investment Gallery (dokumen) | `/admin/gallery` | `/petugas/investasi/dokumen` | `src/app/admin/gallery/` |

1. **Buat IPRO PTSP atau kartu FOILA** (selalu draf). Form bertab: Informasi, Angka, Lokasi, Gambar, Dokumen & Kontak, Bahasa Inggris, Pratinjau. Form FOILA hanya memuat field kartu, URL FOILA, dan satu gambar.
2. **Gambar**: unggah mentah ke R2 lewat presigned PUT (area `ipro-mentah`), lalu server mengubahnya menjadi WebP (EXIF dibuang) di area `ipro-gambar`. Setiap gambar wajib `alt`.
3. **Terbit/arsip/kembali ke draf** lewat `POST /api/admin/ipro/[id]/status`. Syarat terbit: PTSP = deskripsi, gambar utama, sektor dan kab/kota sah; FOILA = URL FOILA sah dan tepat satu gambar. Dua editor yang bentrok mendapat 409 `KONFLIK_VERSI`.
4. **Kotak Masuk**: daftar dengan saringan jenis (Dokumen/IPRO) dan status, panel detail (nama, instansi, email, HP, pesan, waktu WIB), tombol balas lewat email, pemilih status berkunci `versi`. `?id=<lead>` membuka panel langsung (tautan dari email notifikasi). Lencana sidebar `pesanInvestasi`.
5. **Dokumen Investment Gallery (Paket B)**. PDF diunggah langsung ke R2 (presigned PUT, batas 50 MiB/50 halaman) dan didaftarkan lewat `POST /api/investment-docs`. Rute `POST /api/investment-docs/[id]/render` menulis PNG dan WebP privat dalam batch sampai delapan halaman. Sebelum dokumen aktif, rute menulis `links.json` dari anotasi PDF. Dokumen `diproses` bisa dilanjutkan dan dokumen `gagal` bisa dihapus.

Setiap mutasi data terbit memanggil `revalidateTag('publik-investasi', { expire: 0 })` langsung di route (bukan lewat `segarkanPublik`, karena route revalidasi bersama khusus admin).

### Penyiapan PDF melalui jalur offline

Jalur browser menerima PDF 1–50 halaman. Untuk PDF 51–200 halaman, PM dapat menyiapkan satu dokumen dengan `scripts/terbitkan-pdf-investasi.ts`. Skrip memproses halaman berurutan pada skala 1,5 dengan batas 40 juta piksel per halaman. PDF sumber berukuran maksimum 50 MiB.

- Gunakan `bun --no-env-file --no-install run scripts/terbitkan-pdf-investasi.ts` dengan `--berkas`, `--judul`, `--kategori 'Peta Potensi'`, `--deskripsi` dan `--urutan`. Pilih `--render-lokal <dir-kosong>` untuk menyimpan PNG, WebP, serta `links.json` dan mengukur waktu, memori serta byte. Mode ini berjalan sepenuhnya secara lokal.
- Gunakan `--terbitkan` untuk menghitung kunci objek, byte dan baris yang direncanakan. Proses membaca host dari `NEXT_PUBLIC_SUPABASE_URL`, `R2_ACCOUNT_ID` dan `R2_BUCKET_PRIVATE` yang sudah ada di lingkungan proses. Periksa host dan ketik `LANJUT` di terminal. `--yes` tersedia bila konfirmasi diberikan lewat opsi CLI.
- Tambahkan `--terapkan` dengan kredensial Supabase dan R2 yang disediakan ke lingkungan proses. Skrip memeriksa setiap PNG, WebP, JSON, dan PDF di bucket privat lewat tipe konten, panjang dan ETag dari PUT tunggal. PDF yang sama menghasilkan ID dokumen tetap. Ulangi dengan PDF, metadata dan versi renderer yang sama bila proses terputus. Bila objek di kunci yang sama berbeda, proses berhenti untuk pemeriksaan.
- Setelah semua objek terkonfirmasi, skrip mencatat satu baris berstatus `nonaktif` dengan daftar dan jumlah halaman lengkap. Simpan ID yang dilaporkan. Setelah kode penampil terpasang, PM mengaktifkan dokumen melalui pengelola Investment Gallery, yang juga menginvalifikasi cache publik. Periksa sampul dan halaman terakhir dari katalog publik.

### Melengkapi varian dokumen lama

```sh
bun --no-env-file --no-install run scripts/lengkapi-varian-web-investasi.ts --doc-id "$DOC_ID" --pdf "$PDF_LOKAL"
```

- Gunakan PDF sumber lokal dengan isi, urutan, dan rotasi yang sama seperti PNG yang sudah tersimpan. Backfill memeriksa jumlah halaman sebelum menulis tautan dan menerima PDF lokal di atas 50 MiB. R2 hanya dibaca untuk PNG halaman dan keberadaan varian.
- Dry-run bawaan membaca metadata dokumen dan memeriksa keberadaan varian. Skrip mencetak host Supabase dan R2 serta ringkasan jumlah aset. Pakai variabel lingkungan proses yang sama seperti jalur terbit offline.
- Tambahkan `--terapkan` untuk membuat hingga tiga varian sekaligus. Objek yang sudah ada dilewati. Tambahkan `--paksa` untuk menulis ulang varian dan tautan. Jika ada halaman gagal, ringkasan mencantumkan nomornya dan penulisan tautan baru ditunda sampai percobaan berikutnya.
- `halaman_gambar` terus menyimpan path PNG. WebP tersimpan sebagai `web-<n>.webp` di direktori PNG yang sama, dengan lebar maksimal 1920 piksel dan rasio asli. Tautan tersimpan di `investment-docs/pages/<id>/<id>/links.json` dalam bucket privat.

## Alur pengunjung

- **`/investasi`** (Server Component, `revalidate = 60`): IPRO PTSP, kartu FOILA, cuplikan Dokumen Investasi (maksimal 6), dan seksi Peta Potensi (`#peta-potensi`: kisi sektor dan kabupaten/kota, tanpa peta ubin). Data lewat `muatInvestasiPublik()` di `src/lib/data/publik-server.ts` (tag `publik-investasi`).
- **`/investasi/ipro/[slug]`**: halaman detail PTSP (angka kunci, deskripsi, tabel fakta, galeri, dokumen kajian, kontak lembaga, JSON-LD `BreadcrumbList`). Kartu FOILA tidak punya halaman sendiri; seluruh kartu menaut keluar ke FOILA di tab baru.
- **"Hubungi petugas"**: `FormulirHubungi`/`FormulirMinat` di `src/components/investasi/`. Nama, email, nomor HP (opsional), instansi (opsional), pesan 10 sampai 2000 karakter, honeypot `situs_web`, kotak centang persetujuan PDP. Sukses hanya menampilkan tanda terima, tanpa menggemakan isian.
- **`/gallery`** tetap sebagai daftar lengkap Dokumen Investasi; penampilnya diekstrak ke `components/investasi/PenampilDokumen.tsx`. Formulir minat dokumen memakai kontrak yang sama.
- **`/peta-potensi`** dialihkan (`permanent: false`, `next.config.ts`) ke `/investasi#peta-potensi`; halaman lamanya dihapus, sehingga pencatatan `jejak_minat_investasi` dari halaman itu berhenti (tabelnya tetap).

## API

| Route | Metode | Fungsi |
|---|---|---|
| `/api/investasi/pesan` | POST | Pesan "Hubungi petugas" untuk IPRO (kanal `ipro`). |
| `/api/investasi/lead` | POST | Minat dokumen (kanal `dokumen`), kontrak yang sama. |
| `/api/investasi/lead/[id]` | PATCH | Ubah status lead (`{ status, versi }`), staf saja. |
| `/api/admin/ipro` | POST | Buat IPRO/kartu FOILA (draf). |
| `/api/admin/ipro/[id]` | GET, PATCH, DELETE | Baca; ubah (kunci `versi`); hapus hanya draf. |
| `/api/admin/ipro/[id]/status` | POST | Terbit, arsip, kembali draf. |
| `/api/admin/ipro/[id]/gambar` | POST | Tambah gambar (`maxDuration = 30`, sharp). |
| `/api/admin/ipro/[id]/gambar/[gambarId]` | PATCH, DELETE | Ubah atau hapus gambar. |
| `/api/investment-docs` | POST | Daftarkan PDF yang sudah diunggah, status `diproses`. |
| `/api/investment-docs/[id]/render` | POST | Render PNG dan WebP per batch serta simpan tautan sebelum aktivasi (`maxDuration = 60`). |
| `/api/investment-docs/page-image` | GET | Halaman 1–200 dari dokumen aktif. Membaca basis WebP dengan fallback PNG dan mengirim WebP ber-watermark dengan `no-store`. Kuota 90/menit/IP untuk halaman dan 120/menit/IP untuk sampul. |
| `/api/investment-docs/links?doc_id=<uuid>` | GET | Tautan internal dan URL HTTP(S) dari dokumen aktif. Satu pembacaan baris dan satu pembacaan R2 pada cache miss. Kuota 60/menit/IP. |
| `/api/investment-docs/[id]` | DELETE | Hapus dokumen (menolak lease render yang masih aktif). |
| `/api/storage/presign`, `/api/storage/konfirmasi` | POST | Area baru `ipro-mentah`, `ipro-gambar`; `investment-docs` kini boleh untuk petugas modul `investasi`. |

Route multipart lama `POST /api/investment-docs/upload` sudah dihapus. Galat memakai bentuk `{ error: { code, message }, request_id }`; pemeta kode ke HTTP ada di `src/lib/investasi/http.ts`.

Endpoint tautan mengembalikan `{ versi: 1, tautan: [...] }` dengan posisi `x, y, w, h` berupa pecahan dari sudut kiri atas halaman `hal` dan tujuan `ke` (halaman 1-based) atau `url`. Berkas yang belum tersedia menghasilkan daftar kosong. Respons 200 dapat disimpan di cache publik selama lima menit, termasuk saat status dokumen berubah selama masa cache. Origin mengembalikan 404 untuk dokumen nonaktif atau hilang, 400 untuk UUID tidak valid, 429 saat melewati kuota, dan 500 untuk berkas rusak atau galat layanan.

## Keamanan dan privasi

- **Sesi dan spam**: sesi anonim wajib; honeypot membalas 201 palsu tanpa memanggil RPC; batas laju 5 per jam dan 20 per hari per UID plus batas global dengan advisory lock; `operasi_id` idempoten; badan JSON maksimal 16 KiB.
- **Hak akses**: RLS lewat `boleh_kelola_investasi()`; route pengelola memakai JWT pengguna, bukan service role. Draf tidak terbaca publik (policy `status = 'terbit'`).
- **PDP**: persetujuan dicatat di `consent_log` (tujuan `investasi_minat`, versi `1.1`) dalam transaksi yang sama dengan lead. Data pesan tidak diteruskan ke pihak lain. Retensi 365 hari setelah selesai atau ditolak. Notifikasi email ke petugas tidak memuat PII pengirim. Rinci: [KEBIJAKAN_PDP](../KEBIJAKAN_PDP.md).
- **FOILA**: host `invest.lampungprov.go.id` dikunci di zod, route, dan CHECK; tanpa fetch server ke FOILA (tidak ada SSRF); gambar diunggah manual, tanpa hotlink. Konten FOILA tidak boleh masuk RAG chatbot karena `robots` FOILA memuat `ai-train=no`; sumber RAG mana pun kelak wajib menyaring `sumber = 'ptsp'` (komentar penjaga di `src/lib/investasi/konstanta.ts`).
- **Berkas**: presign membatasi mime dan ukuran, konfirmasi memeriksa magic bytes, gambar didekode ulang ke WebP, PDF terenkripsi ditolak.

## Hal belum pasti dan backlog

1. `bersihkanRawLama` di `src/app/api/investment-docs/_logika/unggahan.ts` belum punya pemanggil dari aplikasi. Sapu manual objek mentah R2 yatim lebih dari 24 jam sekarang lewat skrip `scripts/bersihkan-raw-investasi/bersihkan-raw-investasi.mjs` (dry-run bawaan; `--hapus` menghapus; hanya awalan `raw/` berpola sah; `doppler run --project lmh --config prd -- node ...`). Pembersih terjadwal belum ada (keputusan pemilik 2026-11-21: skrip manual).
2. Aset halaman yatim mungkin tertinggal bila render ber-lease basi menulis sesudah DELETE selesai (risiko kecil).
3. `CopyObject`/ETag R2 yang nyata dan kinerja render PDF besar di Vercel belum diuji; baru tiruan dan lokal.
4. Kontensi PostgreSQL nyata belum diuji; PGlite hanya satu koneksi, jadi hanya membuktikan transaksi dan urutan, bukan kunci antarsesi.
5. Realtime Kotak Masuk tidak dipasang: `investasi_lead` belum ada di publikasi realtime, jadi daftar dimuat ulang manual.
6. Tampilan visual belum diperiksa manusia di browser.
7. Antarmuka bahasa Inggris belum ada; kolom `_en` sudah ada dan bisa diisi.
8. Peta interaktif (Leaflet/ubin) ditunda; `lat`/`lng` sudah disimpan.
9. Daftar `sektor`, `skema`, `status_lahan` belum dicocokkan dengan klasifikasi baku FOILA/BKPM. Mengubahnya = migrasi baru yang mengganti CHECK.
10. Naskah persetujuan PDP (`src/components/investasi/teks-pdp.ts`) perlu dibaca pemilik/DPO sebelum rilis.

## Rujukan

[Spec](../superpowers/specs/2026-11-19-ipro-ptsp-design.md), [MIGRATIONS](../MIGRATIONS.md), [KEBIJAKAN_PDP](../KEBIJAKAN_PDP.md), [DECISION_LOG](../DECISION_LOG.md), [matriks RBAC](../analysis/04-RBAC-MATRIX.md) bagian 13, [Storage R2](storage-r2.md), [ADR 0004](../adr/0004-lingkup-peran-petugas-layanan-fo-admin.md) (peran Petugas Layanan, FO, admin).

## Pengisian awal kartu FOILA (2026-11-21)

Tujuh kartu FOILA diisi dari API publik FOILA lewat `scripts/isi-kartu-foila/isi-kartu-foila.mjs` (dry-run bawaan, `--terapkan` menulis, idempoten per `sumber_url`). Semuanya berstatus **draf**, masing-masing dengan satu gambar utama (thumbnail resmi FOILA diolah seperti `olahGambarIpro` dan diunggah ke R2 publik kita, tanpa hotlink); admin meninjau di `/admin/ipro` lalu menerbitkan. Pemetaan sektor per proyek diputuskan pemilik dan tertulis di `scripts/isi-kartu-foila/lib.mjs`. Judul dan ringkasan memakai terjemahan Indonesia FOILA (ringkasan dipotong di batas kata sampai 600 karakter), versi Inggris disimpan di kolom `_en`. Nilai investasi dikosongkan karena FOILA mengisi 0 untuk semua proyek.

