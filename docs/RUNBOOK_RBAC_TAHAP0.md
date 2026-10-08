# Runbook RBAC Tahap 0 (keamanan darurat)

Berlaku untuk migrasi `202610080001_rbac_tahap0_keamanan.sql` dan `202610080002_rbac_tahap0_layanan_admin_only.sql`.
Setiap langkah yang MENGUBAH produksi (**[DB]**) butuh izin CEO terpisah. Keputusan teknis: `docs/DECISION_LOG.md`.

## 0. Ringkasan urutan

| # | Langkah | Mengubah produksi? |
|---|---|---|
| 1 | Dry-run (transaksi, rollback) | Tidak |
| 2 | Terapkan **0001** (atomik) | **[DB]** |
| 3 | Verifikasi pasca-apply | Tidak |
| 4 | Frontend: absensi (RPC `setujui_absensi`), toggle bot & jadwal admin-only (lihat handoff UI) | Kode saja |
| 5 | Terapkan **0002** (atomik) setelah langkah 4 tayang | **[DB]** |
| 6 | Verifikasi pasca-0002 | Tidak |
| 7 | (Nanti, keputusan sadar) nyalakan cron alpa 10:00 WIB | **[DB]** |

0002 TIDAK boleh mendahului langkah 4: tombol toggle chatbot dan editor jadwal petugas akan gagal diam-diam
(0 baris berubah).

## 1. Dry-run (aman, tidak mengubah apa pun)

```bash
# a) Eksekusi seluruh file lalu ROLLBACK (menguji sintaks + dependensi di produksi sungguhan)
node scripts/apply-migration.mjs supabase/migrations/202610080001_rbac_tahap0_keamanan.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610080002_rbac_tahap0_layanan_admin_only.sql --atomic --dry-run

# b) Tes perilaku semua pelaku (anon, pengunjung anon-signin, petugas aktif/nonaktif, FO, admin, service_role)
#    + uji rollback migrasi + perbandingan jumlah baris sebelum/sesudah. SELALU ROLLBACK, lock_timeout 3s.
npm run test:rls:tahap0 -- --apply supabase/migrations/202610080001_rbac_tahap0_keamanan.sql --apply supabase/migrations/202610080002_rbac_tahap0_layanan_admin_only.sql
```

Harus berakhir `RINGKASAN: N lolos, 0 gagal` dan `Baris SEBELUM == SESUDAH`.

## 2. Terapkan 0001 [DB]

Prasyarat: izin CEO; `gh`/branch sudah di-merge; backup otomatis Supabase aktif (cek tanggal backup terakhir di Dashboard);
waktu sepi (disarankan setelah 16:00 WIB atau akhir pekan: perubahan policy mengambil kunci tabel sangat singkat).

```bash
node scripts/apply-migration.mjs supabase/migrations/202610080001_rbac_tahap0_keamanan.sql --atomic
# ketik TERAPKAN pada prompt (atau tambahkan --yes untuk otomasi yang disengaja)
```

Mode `--atomic`: satu transaksi `BEGIN ... COMMIT`; bila ada galat apa pun -> `ROLLBACK` otomatis dan exit non-zero
(tidak ada setengah-terapan). `lock_timeout` 5 detik: bila gagal karena kunci, ulangi saat sepi.
JANGAN memakai mode lama (tanpa `--atomic`): per-statement, tidak atomik.

> `202608310003_absensi_foto_fo.sql` sudah dinetralkan menjadi stub no-op. Jangan dikembalikan isinya:
> versi lama akan menimpa cek akses `catat_absensi`. Foto absensi + bucket dikerjakan di Tahap 1.

## 3. Verifikasi pasca-0001 (baca-saja)

```bash
npm run test:rls:tahap0          # tanpa --apply: menguji state produksi apa adanya (seksi 10 menyesuaikan 0002 belum ada)
```

Pemeriksaan manual cepat (SQL baca-saja):

```sql
-- cron alpa dijeda
SELECT jobname, active FROM cron.job WHERE jobname = 'absensi_alpa_otomatis';          -- active = false
-- policy INSERT "selalu boleh" hilang
SELECT policyname FROM pg_policies WHERE tablename IN ('kunjungan','tiket_antrean') AND cmd = 'INSERT'; -- 0 baris
-- fungsi internal tidak terbuka untuk authenticated
SELECT has_function_privilege('authenticated','public.terbit_tiket(uuid,uuid)','EXECUTE');             -- false
```

Uji manual satu kali (di perangkat): check-in walk-in dari `/checkin` sebagai pengunjung -> tiket muncul di `/admin/antrian`
dan layar antrean. Bila check-in gagal: jalankan rollback bagian 6 SEGERA, lalu selidiki.

Efek yang diharapkan di UI sesudah 0001 (sebelum UI diperbarui):
* `Absensi`: tombol Setujui/Tolak oleh FO belum berfungsi (FO tidak punya UPDATE langsung) sampai UI memakai RPC `setujui_absensi`;
  Admin tetap bisa menyetujui. Petugas yang menekan "Saya hadir" sekarang BERHASIL (sebelumnya gagal karena bug guard) dan
  berstatus `pending` sampai Admin/FO menyetujui.
* Petugas yang sudah ditandai `alpa` lalu mengajukan hadir menjadi `pending` (bukan langsung `approved`).
* FO tidak bisa lagi menonaktifkan akun lewat API (Admin saja).

## 4. Frontend sebelum 0002

Lihat daftar handoff di laporan S0 (file:baris). Ringkas: `admin/chat/faq/page.tsx` (toggle bot), `admin/settings/jadwal/page.tsx`
(`canEdit` admin saja), `admin/absensi/page.tsx` (RPC `setujui_absensi`).

## 5. Terapkan 0002 [DB]

```bash
node scripts/apply-migration.mjs supabase/migrations/202610080002_rbac_tahap0_layanan_admin_only.sql --atomic
```

Verifikasi: `npm run test:rls:tahap0` (seksi 10 kini menjalankan pengujian 0002: FO/petugas ditolak menulis
jadwal/libur/standby/pengecualian; Admin diizinkan; FO tetap menulis `layanan_hari`).

## 6. Rollback

```bash
# Urutan terbalik; bila 0002 sudah diterapkan, jalankan rollback 0002 DULU.
node scripts/apply-migration.mjs docs/rollback-rbac-tahap0-202610080002.sql --atomic
node scripts/apply-migration.mjs docs/rollback-rbac-tahap0-202610080001.sql --atomic
```

Rollback 0001 sengaja TIDAK mengembalikan `guard_absensi_tanggal_today()` yang rusak (versi benar dipertahankan) dan TIDAK menyalakan
cron alpa. Rollback mengembalikan celah keamanan; pakai hanya bila alur produksi terputus. Uji rollback otomatis ada di
`npm run test:rls:tahap0 -- --apply ...` (seksi 11: snapshot fungsi/policy/ACL/cron identik kecuali dua selisih yang diharapkan).

> **Rollback 0001 vs UI.** Jika 0001 di-rollback sementara UI absensi baru (yang memanggil RPC `setujui_absensi`) sudah tayang,
> persetujuan absensi oleh FO/Admin akan GAGAL (RPC dibuang rollback). Revert UI-nya juga, atau jangan rollback 0001 sendirian.

## 7. Catatan penting untuk operator

* **Admin diaktifkan kembali harus login ulang.** Auth Hook (N7) kini memberi role hanya pada akun `aktif`. Token yang
  diterbitkan SAAT akun nonaktif membawa role `pengunjung`; setelah `Aktifkan kembali`, pengguna harus keluar lalu masuk lagi
  (atau menunggu token diperbarui, umumnya <= 1 jam) agar gerbang `/admin` membuka kembali. Sampai itu DB sudah memakai
  status aktif langsung (RLS/RPC), jadi data tetap benar.
* **Token lama tetap berlaku sampai refresh/kedaluwarsa.** Akun yang baru dinonaktifkan masih membawa klaim role di JWT yang
  sudah terbit (default sekitar 1 jam); `proxy.ts` mempercayai klaim itu untuk membuka halaman `/admin`. DB sudah menolak
  data (RLS/RPC memeriksa `aktif` langsung), tetapi halaman masih terbuka. Pemeriksaan aktif di `proxy.ts` (S13) = Tahap 1.
  Untuk memutus segera: `Ganti PIC` memanggil `auth.admin.signOut(global)`.
* **Cron `absensi_alpa_otomatis` dijeda** oleh 0001 (perilaku produksi tetap seperti sekarang: cron itu gagal terus sejak 2026-08-31
  karena bug guard). Menyalakannya = tiap hari kerja pukul 10:00 WIB semua petugas layanan yang belum disetujui ditandai `alpa`.
  Nyalakan hanya setelah UI absensi (FO/Admin menyetujui) dipakai dan petugas diberi tahu:
  `SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='absensi_alpa_otomatis'), active := true);` [DB]
* Drift: `hari_libur_staff_write` ada di repo (202609020001) tetapi tidak ada di produksi; 0002 memakai `DROP POLICY IF EXISTS`.
* **Menerapkan ulang 0001 menjeda cron lagi.** Blok 4b selalu mematikan `absensi_alpa_otomatis`. Bila cron sengaja sudah dinyalakan
  (langkah 7 tabel urutan), menjalankan ulang 0001 akan menjedanya kembali: nyalakan lagi sesudahnya. Bila job tidak ditemukan,
  migrasi mencetak `WARNING` (tidak menggagalkan transaksi); tes perilaku seksi 9 gagal keras bila job ada tetapi masih aktif.
* **`catat_absensi` 4-argumen lama.** 0001 diawali `DROP FUNCTION IF EXISTS public.catat_absensi(uuid, text, uuid, text)`: no-op di
  produksi (bentuk itu tidak pernah ada); membersihkan lingkungan lain yang pernah menerapkan versi lama 202608310003 supaya tidak
  ada dua overload ambigu. Bentuk 3-argumen sendiri tidak pernah di-DROP (CREATE OR REPLACE, atomik). Kolom `foto_url` dibiarkan.
* **Jadwal standby/pengecualian tanpa UI.** `jadwal_standby` dan `jadwal_pengecualian` ditegakkan guard check-in
  (`guard_visit_layanan_buka` -> `is_layanan_buka_jadwal`), tetapi tidak punya UI. Setelah 0002 hanya Admin yang boleh menulisnya
  (lewat SQL sampai Kelola Layanan/CMS Tahap 3). Halaman Jadwal Layanan mengedit tabel lama `layanan_jadwal`, bukan yang ditegakkan guard.
* **Mode lama `apply-migration.mjs` tanpa `--atomic` ditolak** untuk berkas yang memuat CREATE/DROP POLICY atau CREATE/DROP FUNCTION,
  kecuali operator menulis `--non-atomic` secara sadar (dicetak peringatan). Alasan: pilihan paling kecil dan aman; galat di tengah mode
  lama meninggalkan DB setengah-terapan.
* **Verifikasi baca-saja cron (2026-10-08).** Job `absensi_alpa_otomatis`: jobid 8, `username=postgres`, `database=postgres`, `*/5 * * * *`,
  pg_cron 1.6.4 (PostgreSQL 17.6). `cron.job_run_details`: 15.603 sukses, 4.640 gagal; gagal pertama 2026-08-31 08:20 UTC (15:20 WIB),
  gagal terakhir 2026-10-07 16:55 UTC; run paling awal 2026-07-29 17:00 UTC. Semua fungsi terkait (`catat_absensi`, `catat_pulang`,
  `panggil_tiket`, `petugas_set_*`, `tandai_alpa_otomatis`, `guard_absensi_tanggal_today`, `terbit_*`, `skm_rr_tambah`, `match_dokumen`,
  `sync_visit_dual_write`, `set_user_role_claim`) `proowner=postgres`, SECURITY DEFINER, `search_path` terkunci; tabel kunci
  (`absensi_petugas`, `kunjungan`, `tiket_antrean`, `visit`, `petugas`, `layanan_hari`) milik postgres dan RLS tidak FORCE (dasar
  trigger dual-write tetap menulis setelah policy INSERT dicabut). `postgres` boleh memanggil `cron.alter_job`.
