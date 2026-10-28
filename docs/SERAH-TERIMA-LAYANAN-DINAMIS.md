# Serah terima: Layanan Dinamis (Fase 1–6)

Ditulis 2026-10-27 untuk melanjutkan pekerjaan di sesi, akun, atau mesin lain. Baca bagian 1–3 dulu; sisanya rujukan.

## 1. Ringkasan

Audit sistem (2026-10-26) menemukan pengunjung online kurang terlayani, beranda kurang data, dan layanan (Balmon, Helpdesk OSS, dll.) masih hard-coded. Setelah sesi tanya-jawab dengan pemilik (Q1–Q48) dirancang dan dibangun enam fase: layanan dinamis dengan Instansi dan website resmi, beranda etalase dengan popup, Koordinator dan akses data per orang, Pendataan Khusus, live chat per layanan, dan saran pengunjung lama di Front Office.

Semuanya **sudah ditulis, lolos test, dan di-push sebagai branch ke GitHub (2026-10-27; `main` tidak disentuh, belum ada PR), tetapi belum di-merge dan belum ada migrasi yang diterapkan ke database mana pun.** Aturan akses di SQL baru diuji lewat test statis (membaca teks SQL), belum pernah dijalankan di Postgres.

Peran LMH: **fasilitator**. Proses perizinan tetap di sistem resmi tiap instansi; LMH tidak menerima permohonan atau berkas.

## 2. Posisi branch

| Branch | HEAD | Isi | Status |
|---|---|---|---|
| `feat/fase-1-fondasi-layanan` | `4092231` (+ perbaikan tampilan dialog/popup, lihat "Pembaruan 2026-10-28") | Fase 1–6 + dokumen ini + commit dependensi + harness rantai penuh PGlite + `202611010002` (celah `tiket_antrean`) + `202611010003`/`0004` (identitas satu kesatuan, backfill) + email di rekap OSS/Non OSS + penanda pencatat Buku Tamu | Di-push ke `origin` (2026-10-27). **Branch utama untuk dilanjutkan.** |
| `feat/survei-terpadu-a` | `c9e4528` | Survei terpadu "Pesan Perilaku" (SPAK + SKM), Task 1–13 selesai, gate penuh lolos (3242 test, build) | Di-push ke `origin` (HEAD `c9e4528`). 4 migrasi **sudah dinomori ulang** ke `202611020001–0004` (tidak lagi bentrok dengan Fase 1; gate penuh lolos). Sisa: satu review menyeluruh, lalu gabung. Rincian: `docs/SERAH-TERIMA-SURVEI.md` pada branch itu |
| `claude/busy-poitras-cb912c` | `2333f03` | 6 perbaikan kecil: `?next=` setelah login, menu mobile FO, teks SKM, koreksi `CLAUDE.md`, RLS `standar_pelayanan` (migrasi `202610260001`), `/peta-potensi` tanpa login; + commit dependensi | Di-push ke `origin`, selesai |
| `claude/amazing-borg-b06657` | `f7f0f8e` | Dependensi rentan dinaikkan (next 16.4.1, zod 4.6.6, undici 7.30.1, vite 8.3.5). Menutup kegagalan `audit:check` | Di-push ke `origin`, selesai |
| `docs/rancangan-layanan-dinamis` | `f2a4061` | Spesifikasi, ADR, glosarium, rencana Fase 1 | Sudah termuat di `feat/fase-1-fondasi-layanan` |
| `backup/*` (7 branch lokal) | — | Salinan sebelum commit sementara digabung per fase | Boleh dihapus; jangan di-push |

Commit per fase di `feat/fase-1-fondasi-layanan` (di atas `565cb6f` = akhir Fase 1):
`6d2b494` Fase 2 · `51d24c8` Fase 3 · `64c4277` Fase 4 · `4f3e432` Fase 5 · `9937fdd` Fase 6.

### Pembaruan 2026-10-28

- Push 2026-10-27 kedua branch (Fase 1 `4092231`, survei `c9e4528`) berhasil, tetapi **hook `.githooks/pre-push` TIDAK jalan** di mesin yang dipakai (berkas tidak executable, hanya muncul `hint: ... ignored`). Gate dijalankan manual sebelum push: lint, typecheck, test, `npm run build`, `audit:check`, `deps:check` (semua lolos). Perbaiki dengan `chmod +x .githooks/pre-push` atau `git config core.hooksPath .githooks` bila hook diinginkan di mesin lain. **DIPERBAIKI 2026-10-28:** mode berkas dicatat git sebagai executable (100755), jadi clone baru ikut mendapat hook yang bisa jalan; satu-satunya langkah per clone tinggal `git config core.hooksPath .githooks` (sudah diset di mesin ini). Push berikutnya menjalankan `npm run verify:baseline` penuh (beberapa menit) dan dibatalkan bila gagal.
- Cek browser pertama (Chromium + mock Supabase, sesi admin palsu): beranda, popup layanan (klik, tautan langsung, slug tak ada), Buku Tamu (kolom Dicatat oleh), Rekap > Data Pelayanan (`EMAIL` + `[OSS] EMAIL` berdampingan, perlu memilih satu Layanan), dialog Selesaikan (isian email + pesan galat), riwayat FO (email). **Dua bug tampilan ditemukan dan diperbaiki:** popup layanan beranda dan `FormDialog`/`AmbilAlihTiketModal` memakai `--surface-elevated` (kaca putih 62% tanpa blur) sebagai latar dialog, sehingga isi halaman di belakangnya tembus dan sulit dibaca; latar kini opak. Belum diuji: layar sentuh, `AmbilAlihTiketModal` di browser, dan seluruh layar admin lain.
- Prasyarat cek browser di mesin ini: paket Debian `libnspr4 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libasound2t64 libcairo2 libpango-1.0-0 libxdamage1 libatspi2.0-0t64` (sudah dipasang) dan CSP proyek hanya mengizinkan origin Supabase `https:` (mock harus berhost https).

### Catatan push (2026-10-27)

- Hook `.githooks` menjalankan `npm run verify:baseline` (lint, typecheck, test, build, `audit:check`) pada **setiap push** dan membatalkannya bila gagal; jangan dilewati.
- Advisory dependensi lama membuat `audit:check` gagal di semua branch kecuali `claude/amazing-borg-b06657`. Karena itu commit `chore(deps)` `f7f0f8e` di-cherry-pick ke `feat/fase-1-fondasi-layanan` (`a089830`), `feat/survei-terpadu-a`, dan `claude/busy-poitras-cb912c`. Saat menggabung ke `main`, commit yang sama muncul lagi: abaikan duplikatnya (isinya identik).
- Zod 4.6.6 menolak kunci `__proto__` pada objek strict dengan 400 (sebelumnya diabaikan); test survei disesuaikan (`7739b50`).
- Dua test kadang gagal pada run penuh bila mesin sedang sibuk: `WalkinPanel.test.tsx` (fokus) dan `src/test/visit-arsip.test.ts` (batas waktu 5 detik karena memindai seluruh `src`). Keduanya lolos bila dijalankan sendiri atau diulang; push yang gagal karenanya cukup diulang, tanpa proses berat lain yang berjalan.
- Setelah `npm ci` di worktree survei, pasang ulang harness DB lokal: `npm i --no-save @electric-sql/pglite`.

## 3. Peta dokumen

- Rancangan: [`docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md`](superpowers/specs/2026-10-26-layanan-dinamis-design.md) (batasan B1–B5 mengikat semua fase; keputusan Q1–Q48).
- Keputusan arsitektur: `docs/adr/0001` (Instansi terpisah dari Layanan), `0002` (formulir OSS/Non OSS tetap), `0003` (Koordinator = penanda, bukan role).
- Istilah: `GLOSSARY.md`.
- Rencana per fase, memuat **inventaris jalur baca data** dan **"Keputusan pelaksana" beserta biayanya bila keliru**: `docs/superpowers/plans/2026-10-26-fase-1-…`, `2026-10-28-fase-2-…`, `2026-10-29-fase-3-…`, `2026-10-30-fase-4-…`, `2026-10-31-fase-5-…`, `2026-11-01-fase-6-…`.
- Penerapan: `docs/MIGRATIONS.md` (urutan terap, daftar periksa pemilik, rollback), `docs/STATUS.md`, `docs/analysis/04-RBAC-MATRIX.md` §7–§10, `CLAUDE.md` (peta kode terbaru).
- Skrip rollback: `docs/rollback-koordinator-akses-data-202610290001.sql`, `docs/rollback-rekap-terpadu-202610290002.sql`, `docs/rollback-fo-cari-pengunjung-202611010001.sql`.

## 4. Yang sudah dibangun per fase

| Fase | Migrasi (belum diterapkan) | Inti |
|---|---|---|
| 1 Fondasi layanan | `202610270001`, `202610270002` | Tabel `instansi`; layanan punya slug, deskripsi, urutan, website terkait; admin tambah/ubah/arsip/hapus di `/admin/layanan`; satu jadwal per layanan (`jadwal_standby` + `hari_libur`, fungsi `is_layanan_buka_jadwal`); jadwal default Senin–Jumat 08:00–15:30; bot memakai profil layanan |
| 2 Beranda | `202610280001` | 7 blok tetap yang diatur admin (`homepage_blok`); kartu layanan otomatis; popup `/?layanan=<slug>`; status buka/tutup dan antrean |
| 3 Koordinator dan rekap | `202610290001`, `202610290002` | Penanda `petugas.koordinator`; akses data per orang (membalik `202610140013`); ambil alih pendataan; Rekap terpadu (Harian, Data Pelayanan + Excel, Kinerja) dengan satu definisi "dilayani" |
| 4 Pendataan | `202610300001`, `202610300002` | Pendataan Khusus dinamis per layanan non-OSS; topik di langkah selesai OSS/Non OSS; pendataan saat menutup live chat; kolom `[Khusus]` di rekap dan Excel |
| 5 Live chat | `202610310001`, `0002`, `0003` | Satu percakapan per layanan dengan riwayat lintas sesi; bot di luar jam; email ke petugas bila pengunjung meminta; lingkup baca chat menutup celah FO membaca semua chat |
| 6b Identitas satu kesatuan | `202611010003`, `202611010004` (backfill) | Pengunjung yang dieskalasi wajib punya email nyata saat layanan selesai; identitas dari petugas layanan kembali ke `kunjungan`; FO pencatat membaca hasil lengkap (read-only); rencana `docs/superpowers/plans/2026-11-01-identitas-satu-kesatuan.md` |
| 6 Saran pengunjung | `202611010001` | Autocomplete di kolom Nama dan Nomor HP walk-in FO; RPC pencarian bertopeng + pengambilan identitas (diaudit, dibatasi 60/10 menit) |

## 5. Urutan terap migrasi (hanya pemilik; menyentuh produksi)

Aturan: `node scripts/apply-migration.mjs --atomic --dry-run supabase/migrations/<file>.sql` dulu, baru terapkan. Agen **tidak boleh** menerapkan; jangan jalankan `npm run test:rls` (menyambung ke produksi).

```
202610270001 → 202610270002 → 202610280001 → 202610290001 → 202610290002
→ 202610300001 → 202610300002 → 202610310001 → 202610310002 → 202610310003 → 202611010001 → 202611010002 → 202611010003 → 202611010004
```

- Terapkan **dalam satu jendela dengan deploy**. Tanpa migrasi: halaman Rekap kosong (409), Kelola Layanan dan API Instansi error. Beranda, chat, dan form FO mundur ke perilaku lama tanpa crash.
- Branch lain membawa migrasi sendiri: `202610260001` (`claude/busy-poitras-cb912c`, terapkan lebih dulu atau kapan saja) dan 4 migrasi survei (`feat/survei-terpadu-a`).
- **Bentrok nomor:** migrasi survei bernomor `202610270001–0004`, sama dengan Fase 1 (`202610270001`, `0002`). Ledger produksi memakai nomor depan sebagai `version`, jadi **migrasi survei wajib dinomori ulang** (mis. `202611020001–0004`, beserta nama berkas test, `MANIFEST.json`, `FORWARD_MIGRATION_FILES`) sebelum digabung. Perbarui juga rujukan di test survei.
- `MANIFEST.json` dan `migration-test-utils.ts` akan bentrok saat menggabung branch mana pun; selesaikan dengan menyatukan entri lalu `node scripts/gen-migration-manifest.mjs --check`.

## 6. Yang belum dikerjakan atau perlu tindakan

### A. Saat penerapan (pemilik)
1. Sebelum migrasi, hitung baca-saja: jumlah `layanan.aktif = false` (akan tampil "Diarsipkan") dan baris `jadwal_pengecualian` bertanggal mendatang (masih menutup hari tertentu tanpa terlihat di admin).
2. Setelah terap: isi **Deskripsi** tiap layanan, Instansi, website terkait, jadwal 7 hari, dan hari libur di `/admin/layanan` dan `/admin/settings/jadwal`. Deskripsi di beranda lama tidak disalin otomatis (data lama tidak boleh diubah); `docs/MIGRATIONS.md` memuat SQL baca-saja untuk melihat teks lamanya.
3. Tandai akun **Koordinator** di `/admin/petugas`.
4. Pastikan petugas punya `email_notifikasi` terverifikasi (email chat di luar jam hanya ke alamat terverifikasi); uji sekali di luar jam.
5. Beri tahu petugas FO: eskalasi berhenti pada jam tutup layanan (umumnya 15:30), walk-in tetap sampai 16:00; FO dan petugas biasa tidak lagi melihat data rekan; halaman Rekap berubah.
6. Skrip uji DB `scripts/test-fo-eskalasi.mjs` dan `scripts/test-perbaikan-review.mjs` rusak oleh jadwal default; sesuaikan sebelum dipakai (rincian di `docs/MIGRATIONS.md`).
7. **Verifikasi perilaku di database.** Sebagian sudah dibuktikan di PGlite pada skema asli (`node scripts/lokal-rantai/skenario-akses-data.mjs`, 115 cek: kunjungan, penanganan, tiket, chat, rekap, pencarian pengunjung, ambil alih, email chat luar jam, Pendataan Khusus; tanpa pgvector/pg_cron). Tetap perlu di DB nyata: FO/petugas biasa tidak melihat kunjungan, tahap, pendataan, atau chat tutup milik rekan; Koordinator dan admin melihat sesuai lingkup; pencarian pengunjung hanya untuk FO/admin; email chat tidak terkirim dua kali. Periksa juga `EXPLAIN` untuk `rekap_data_pelayanan` pada data besar dan lama kunci saat membuat indeks trigram (`kunjungan` terkunci tulis beberapa detik).
8. Cek di browser: seluruh UI baru hanya diuji lewat jsdom.

### B. Keputusan pemilik yang masih terbuka
- **Koreksi Pendataan Khusus** setelah tersimpan: saat ini tidak ada. Perlu jalur koreksi Admin dengan `audit_log`?
- **PDP:** jawaban teks bebas Pendataan Khusus dan nilai identitas lama/baru di `audit_log` belum masuk job anonimisasi.
- **Pencarian pengunjung:** pencarian bertopeng tidak diaudit atau dibatasi; hanya pengambilan identitas penuh yang dibatasi. Jendela data 730 hari.
- **Ambil alih tahap FO:** petugas FO semula tidak bisa menyunting lagi (tahap FO tidak punya draf).
- **Hitungan rekap:** satu kunjungan yang dilayani FO lalu layanan terhitung di dua unit, sehingga total tidak sama dengan jumlah kunjungan. Tahap layanan berhasil *dikembalikan* tidak dihitung.
- **Chat:** penanda "belum dibaca" per perangkat; persetujuan PDP hanya dicatat pada percakapan pertama per layanan; pengunjung yang dianonimkan atau berganti akun Google memulai percakapan baru.

### C. Celah keamanan yang diketahui dan belum ditutup
- ~~`tiket_antrean` `tiket_staff_select` (tanpa `TO`): tiket rekan terbaca.~~ **Ditutup** oleh migrasi `202611010002` (belum diterapkan; terbukti di PGlite pada skema asli, `scripts/lokal-rantai`). Dampak: tiket hari-hari lampau milik rekan tidak terbaca FO/petugas biasa; hari ini utuh.
- ~~`buku_tamu`: semua FO membaca semua tanggal.~~ **Diputuskan pemilik (2026-10-27): tidak dibatasi** (meja FO bersama); halaman Buku Tamu kini menampilkan kolom "Dicatat oleh" (nama pencatat) sebagai tanda saja.
- Lihat juga B (pencarian pengunjung, PII di teks bebas).

### D. Fitur yang sengaja ditunda
Koordinator mengambil alih **chat**; lampiran foto/dokumen di chat; papan kinerja publik; gerbang layanan berdasarkan absensi petugas (Q29); draf dan koreksi Pendataan Khusus, serta Khusus untuk tiket lama tanpa tahap; survei dan pengaduan terhubung (sedang di `feat/survei-terpadu-a`).

### E. Catatan kecil hasil review (tidak menghalangi)
- Fase 1: hapus-layanan dan simpan-tautan dibuat atomik lewat satu RPC dan tambah test yang gagal bila tabel baru merujuk `layanan`; konfirmasi arsip memperingatkan tiket menunggu; dialog form layanan perlu focus trap dan label terlihat; `seed.sql` mengisi jenis formulir pendataan eksplisit untuk database baru; sanitasi penanda bersarang di teks bot; eskalasi akhir pekan terblokir bila layanan tak punya baris jadwal; baris `jadwal_pengecualian` lama masih menutup hari tanpa terlihat.
- Fase 2: tautan layanan di jawaban bot berupa teks relatif (tidak otomatis bisa diklik; aplikasi belum punya env URL publik); antrean di popup diambil sekali saat dibuka; ikon kartu dipilih otomatis dari slug; mematikan blok footer menyembunyikan teks footer (tautan Kebijakan Privasi tetap tampil).
- Fase 4: opsi pilihan disimpan sebagai teks (mengganti nama opsi tidak memetakan ulang jawaban lama); urutan isian lewat tombol naik/turun, tanpa seret-lepas; tanpa draf.
- Fase 5: daftar chat staf dipoll tiap 60 detik karena Realtime tidak mengirim baris yang keluar dari lingkup.
- Pengujian: `WalkinPanel.test.tsx:473` kadang gagal hanya pada run penuh (lolos bila dijalankan sendiri). `.playwright-mcp/` belum ada di `.gitignore`; jangan di-commit.

## 7. Melanjutkan di mesin lain

```bash
git fetch origin
git switch feat/fase-1-fondasi-layanan     # setelah di-push
npm ci
npm run lint && npm run typecheck && npm test && npm run build
node scripts/gen-migration-manifest.mjs --check
```

Terakhir diverifikasi (2026-10-27, `a089830`, lewat hook pre-push): lint, typecheck, 265 file / 3308 test, build, `audit:check`, dan manifest (84 berkas) semuanya lolos.

Aturan kerja (dari `AGENTS.md`): push dan operasi remote hanya atas perintah eksplisit pemilik; semua operasi GitHub lewat `gh` sebagai `dpmptsplampung`; jangan memakai kunci produksi; jangan menjalankan perintah yang mengubah atau menghapus database selain lokal; migrasi hanya diterapkan pemilik; baca `node_modules/next/dist/docs/` sebelum menulis kode Next.js (Next 16 berbeda dari pengetahuan umum).

Pola kerja yang dipakai: satu fase = rencana (`writing-plans`) → implementasi TDD → review independen (reviewer keamanan untuk fase yang menyentuh akses data) → perbaikan → satu commit per fase.

## 8. Batasan global yang harus dijaga (B1–B5)

- **B1** Data yang sudah ada di database tidak diubah atau dihapus: boleh tabel/kolom/baris baru; tidak boleh `DELETE`, `DROP TABLE/COLUMN`, `UPDATE` nilai lama. Objek lama yang tak terpakai dibiarkan.
- **B2** Migrasi = berkas forward baru `YYYYMMDDNNNN_nama.sql` + test kontrak statis + entri `MANIFEST.json` + `FORWARD_MIGRATION_FILES`. Kebijakan tulis admin wajib `TO authenticated`; jangan `FOR ALL` tanpa `TO` yang memanggil `get_my_role()`.
- **B3** Role tetap tiga: `admin`, `front_office`, `petugas`. Koordinator hanya penanda.
- **B4** Semua batas hari memakai WIB (`src/lib/time.ts`).
- **B5** Live chat wajib login Google; tanpa magic-link untuk pengunjung.
