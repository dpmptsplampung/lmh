# RBAC Tahap 1 — kontrak DB/API untuk frontend

Migrasi: `supabase/migrations/202610090001_rbac_tahap1.sql` (BELUM diterapkan ke produksi). Rollback: `docs/rollback-rbac-tahap1-202610090001.sql`.

## 1. Koreksi data pelayanan terkunci (Admin + FO)
- API: `PUT /api/admin/pelayanan/[tiketId]` body `{ perubahan: { <kolom>: <teks|null> }, alasan: string(>=5 huruf) }` -> `{ ok, perubahan: { kolom: { lama, baru } } }`.
  Galat: 401, 403 (petugas / bukan staf aktif), 404 (tiket/data tidak ada), 409 (masih draf: pakai simpan draf), 422 (alasan kosong, kolom tidak boleh dikoreksi, kolom wajib dikosongkan, tidak ada perubahan; pesan ramah di `error`).
- RPC dasar: `koreksi_pelayanan(p_tiket_id uuid, p_form_type 'oss'|'perizinan', p_perubahan jsonb, p_alasan text)`. Kolom yang boleh: OSS = nama_pemohon, alamat_pemohon, no_hp, email, keperluan_awal, nama_usaha, tipe_pelaku_usaha, status_penanaman_modal, lokasi_usaha, skala_usaha, sektor_usaha_kbli, tindak_lanjut, uraian_solusi, catatan_internal; Non OSS = nama_pemohon, alamat_pemohon, no_hp, email, keperluan_awal, nama_perusahaan, lokasi_usaha, opd_teknis, uraian_permohonan, tindak_lanjut, catatan_petugas. Data tetap `is_locked=true`. Setiap koreksi menulis `audit_log` (`aksi='koreksi_pelayanan'`, `entitas='pelayanan_oss'|'pelayanan_perizinan'`, `entitas_id=tiket_id`, `detail={alasan, staf_id, perubahan:{kolom:{lama,baru}}}`; audit hanya terbaca Admin).
- `PATCH` (simpan draf) pada data terkunci kini DITOLAK 403 untuk semua role (termasuk Admin); gunakan `PUT`. UI: tombol "Koreksi" hanya Admin/FO pada data terkunci; petugas hanya baca.
- FO kini boleh membuat/menyimpan draf dan menyelesaikan pendataan lintas layanan (RLS sebelumnya menolak).

## 2. Jam tutup 16:00 WIB
- `site_settings.jam_tutup_layanan` (teks `HH:MM`, default `16:00`, dapat dibaca publik). RPC publik `layanan_sudah_tutup(p_waktu timestamptz default now()) -> boolean` dan `jam_tutup_layanan() -> time` untuk menampilkan banner "tutup" sebelum pengunjung mengisi form.
- INSERT `visit` asal `walk_in` (semua role, termasuk wizard FO) ditolak mulai jam tutup: galat SQL `P0001`, `message` = "Layanan hari ini sudah tutup pukul 16:00 WIB. ...", `details = 'LAYANAN_TUTUP'`. `POST /api/checkin` memetakannya ke HTTP 409 `{ error, code: 'LAYANAN_TUTUP' }`. Klien yang meng-insert `visit` langsung (WalkinWizard, checkin/page.tsx) cek `error.details === 'LAYANAN_TUTUP'` dan tampilkan `error.message`.
- Replay offline: 409 `LAYANAN_TUTUP` dibuang dari antrean (tidak diulang besok); `replayQueue()` mengembalikan `ditolak` (hanya bila > 0) agar UI bisa memberi pesan.
- Reservasi (INSERT jadwal hari lain) dan scan/check-in reservasi (UPDATE) tetap boleh setelah tutup.
- `layanan_hari` kini ditulis Admin saja (FO tidak punya tombol tutup/buka). `catat_absensi` tetap membuka layanan (fungsi definer). Job `antrean_tidak_terlayani_akhir_hari` digeser ke 09:00 UTC.
- Default yang dipakai (CEO belum menjawab): lihat laporan; hari libur nasional (`hari_libur`) TIDAK ikut dicek.

## 3. Foto absensi
- `catat_absensi(p_petugas_id, p_sumber, p_dicatat_oleh default null, p_foto_url default null)` — satu bentuk; panggilan lama 3 argumen tetap valid. `p_foto_url` hanya dipakai untuk `p_sumber='fo'` dengan format `<tanggal WIB>/<petugas_id>_<angka>.jpg|jpeg|png|webp` (persis yang dibuat `AbsensiWizardModal`), selain itu galat `22023 foto_url tidak valid`. Bucket privat `absensi-foto`: hanya Admin/FO yang unggah/baca (tanpa update/hapus). FO kini juga boleh membaca `absensi_petugas`.

## 4. Per layanan & pengaduan
- Petugas: `kunjungan` hanya yang punya tiket di layanannya (reservasi belum di-scan tidak tampil sampai tiketnya terbit; gunakan `visit`); `rekap_harian_layanan` layanannya saja; `investasi_lead` Admin saja; SKM rinci lewat view `v_skm_petugas` (kolom: layanan_id, u1..u9, saran, created_at) — tabel `skm_respons` hanya Admin/FO. FO kini boleh SELECT/UPDATE `visit` semua layanan.
- Pengaduan: tabel hanya Admin/FO (integritas Admin saja). Petugas membaca view `v_pengaduan_petugas` (id, nomor_tiket, jalur, layanan_id, isi, anonim, status, batas_*, created_at, updated_at; tanpa kontak/lampiran/sesi chat). `GET /api/admin/pengaduan` sudah memakai view untuk petugas. `PATCH` oleh petugas = 403 (bukan lagi "sukses palsu"); UPDATE yang tidak menyentuh baris juga 403.
