# Kebijakan Pelindungan Data Pribadi (PDP)

> Fase 1 / I8 — Tata kelola PDP

## Dasar Hukum

Kebijakan ini disusun berdasarkan **Undang-Undang Republik Indonesia Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi**. Aplikasi Lampung Maju Hub (LMH) dikelola oleh Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu (DPMPTSP) Provinsi Lampung.

## Data yang Dikumpulkan

LMH mengumpulkan data pribadi berikut:

| Sumber | Data | Tujuan |
|--------|------|--------|
| Google OAuth (login chat) | Nama, email, foto profil | Identitas pengunjung sesi chat |
| Pendaftaran walk-in oleh Front Office (`/admin/fo/daftar`, RPC `fo_mulai_kunjungan`; menggantikan form check-in mandiri `/checkin` dan `POST /api/checkin` yang sudah dihapus) | Nama, asal instansi, HP, kategori, email, keperluan, layanan saran; catatan penanganan (topik + catatan staf) | Pelayanan loket, antrian, rekap penanganan |
| Reservasi online | Nama, instansi, tanggal kunjungan, QR token | Penjadwalan kunjungan |
| Profil pengunjung | Asal instansi, kategori (UMKM/Umum/Instansi/Investor) | Statistik layanan |
| Investment Gallery | Dokumen PDF (metadata: judul, kategori) | Informasi publik |
| Matchmaking UMKM | Nama UMKM, kontak (nama/hp/email), kebutuhan | Marketplace publik |

## Tujuan Pengolahan

Data pribadi yang dikumpulkan digunakan secara terbatas untuk:

1. **Pelayanan publik DPMPTSP** — antrian kunjungan, eskalasi chat ke petugas, reservasi.
2. **Statistik layanan** — agregasi jumlah kunjungan per layanan, waktu tunggu rata-rata.
3. **Marketplace UMKM** — publikasi kebutuhan UMKM (dengan consent kontak).
4. **Investment Gallery** — publikasi dokumen informasi investasi.

Data **tidak** digunakan untuk pemasaran komersial, profiling otomatis, atau dibagikan ke pihak ketiga di luar keperluan layanan publik DPMPTSP.

## Retensi & Anonimisasi

- **Periode retensi:** 730 hari (2 tahun) sejak aktivitas terakhir pengunjung.
- **Retensi `chat_ai_log`:** 90 hari. Fungsi `prune_chat_ai_log()` dijadwalkan
  harian via pg_cron (migration `202607200001`).
- **Mekanisme:** Fungsi `anonymize_inactive_pengunjung()` dipanggil otomatis setiap hari pukul 02:00 via `pg_cron` (jika extension terpasang).
- **Aksi anonimisasi:**
  - `nama` → `'[anonim]'`
  - `email` → `NULL`
  - `foto_url` → `NULL`
- **Cakupan baru (migrasi `202610140008`, DITERAPKAN ke produksi 2026-10-14 malam):** anonimisasi 730 hari juga mengosongkan PII `kunjungan` (nama → `[anonim]`; HP, email, instansi, nama yang ditemui, keperluan → NULL), `penanganan.catatan` → `[anonim]`, dan arsip `visit` (tabel `visit` menjadi arsip baca saja setelah migrasi `202610140007`). Belum mencakup `pelayanan_oss`/`pelayanan_perizinan`, `buku_tamu`, dan isi chat (pertanyaan terbuka).
- **Pencarian pengunjung lama FO (Fase 6, migrasi `202611010001`):** hanya akun FO/Admin aktif; saran memuat HP tersamar; identitas penuh hanya diambil untuk satu pengunjung terpilih, dicatat di `audit_log` (tanpa PII) dan dibatasi 60/10 menit; data teranonimkan dan kunjungan > 730 hari tidak pernah dikembalikan.
- **Pengecualian:** dokumen Investment Gallery dan listing UMKM bersifat publik (bukan data pribadi per individu) sehingga tidak dianonimisasi otomatis.
- **Manual trigger:** jika pg_cron belum di-enable, admin dapat menjalankan:
  ```sql
  SELECT anonymize_inactive_pengunjung();
  ```

## Consent (Persetujuan)

Persetujuan eksplisit diperlukan sebelum pengolahan data pribadi. Implementasi:

| Titik consent | Tabel | `tujuan` |
|---------------|-------|----------|
| ~~Form check-in `/checkin`~~ (dihapus: `/checkin` kini halaman informasi tanpa isian; `/api/checkin` dan test kepemilikan consent-nya sudah dihapus) | `consent_log` | `checkin_data` (hanya baris historis; tidak ada penulis baru). Dasar pencatatan walk-in oleh Front Office dan cara mencatat persetujuannya BELUM ditetapkan (pertanyaan terbuka, `docs/analysis/DB-CHANGES.md` entri 202610140007 butir 1) |
| Mulai sesi chat `/chat` | `consent_log` | `chat_followup` |
| Simpan profil pengunjung (kotak centang pernyataan kebenaran data; K12) | `consent_log` | `pernyataan_kebenaran` — versi teks di `src/lib/pernyataan-kebenaran.ts` (`versi_kebijakan`); `subjek_ref` = `auth.uid()`; gagal mencatat = profil tidak disimpan. Setelah profil lengkap, Nama Lengkap terkunci di database; perubahan hanya oleh Front Office/admin lewat `ubah_nama_pengunjung` dengan `audit_log` |
| Kontak UMKM (checkbox consent saat admin submit listing) | `consent_log` | `umkm_contact_public` — **Diimplementasikan 2026-07-20** (checkbox consent saat admin submit listing + baris `consent_log` tujuan `umkm_contact_public`) |

- Consent dicatat di tabel `consent_log` dengan kolom `disetujui` (boolean), `versi_kebijakan` (saat ini `1.0`), dan `created_at`.
- Pada form yang masih memakai kotak centang (chat, profil pengunjung) checkbox consent bersifat **required** — tombol submit dinonaktifkan sampai checkbox dicentang.
- Pengunjung dapat membaca kebijakan ini via link "Baca kebijakan" di samping checkbox.

## Hak Subjek Data

Sesuai UU 27/2022, subjek data berhak:

1. **Akses** — meminta salinan data pribadi yang disimpan. Hubungi DPO (kontak di bawah).
2. **Koreksi** — memperbaiki data yang tidak akurat. Pengunjung dapat mengedit profil sendiri di halaman profil (Fase 3), atau menghubungi DPO.
3. **Penghapusan** — meminta penghapusan data pribadi. Hubungi DPO; penghapusan akan dilakukan dengan tetap mempertahankan audit log (entri audit tidak berisi data pribadi mentah, hanya referensi entitas + before/after JSONB yang dapat di-redact).
4. **Pencabutan consent** — pengunjung dapat mencabut persetujuan dengan menghubungi DPO; pengolahan selanjutnya dihentikan (kecuali kewajiban hukum/retensi).

## Pencatatan Audit

Setiap aksi sensitif oleh admin/petugas dicatat di tabel `audit_log`:

| Aksi | Entitas | Trigger |
|------|---------|
| `update_status` | `visit` | Update kolom `status` |
| `update_status` | `listing_umkm` | Update kolom `status` (termasuk approve → `published`) |
| `insert_petugas` | `petugas` | Insert baris baru |
| `delete_petugas` | `petugas` | Delete baris |
| `update_role` | `petugas` | Update kolom `role` (anti eskalasi; trigger `trg_audit_petugas_role`) |
| `upload_dok` | `investment_documents` | Insert dokumen baru |
| `delete_dok` | `investment_documents` | Delete dokumen |
| `update_status` | `investasi_lead` | Update kolom `status` |

- Fungsi trigger `audit_change()` bersifat `SECURITY DEFINER` (bypass RLS) agar dapat menulis ke `audit_log` dari konteks admin/petugas.
- Hanya `admin` yang dapat SELECT dari `audit_log` (policy `audit_log_admin_select`).
- Tidak ada INSERT/UPDATE/DELETE langsung dari client — hanya via trigger.
- Kolom `detail` (JSONB) menyimpan snapshot before/after untuk audit lengkap.

**Catatan:** Tabel `kunjungan`/`reservasi` telah di-retire; trigger audit
kini menempel pada `visit` (lihat baseline `202607140004_security_and_automation.sql`).

### Akses data pengunjung antar Front Office (keputusan CEO 2026-10-14, migrasi `202610140013`)

- **Siapa**: semua akun Front Office (`petugas.role = 'front_office'`, `aktif = true`, sesi staf sah) membaca data kunjungan, antrean, dan seluruh tahap penanganan (termasuk topik/catatan tahap FO lain dan tahap petugas layanan) serta isi Pendataan Pelayanan. **Baca saja**; perubahan tetap hanya oleh pemilik tahap lewat RPC.
- **Alasan (dasar keperluan)**: semua FO adalah satu unit layanan yang bergantian melayani pengunjung yang sama (serah terima, pengunjung yang dikembalikan petugas layanan, rekap harian unit). Membatasi per FO menghambat pelayanan tanpa menambah perlindungan berarti karena data yang sama sudah dikelola unit tersebut.
- **Akuntabilitas**: setiap baris pengunjung/penanganan/rekap menampilkan nama FO yang melayani; setiap ekspor Excel rekap tercatat di `audit_log` (aktor, peran, filter, jumlah baris).
- **Tidak termasuk**: profil akun pengunjung (`pengunjung`), pengaduan jalur integritas, log AI. Petugas layanan tetap terbatas pada layanannya.
- **Audit akses per-baca**: TIDAK dicatat (pertimbangan; bukan fitur). Bila DPO/CEO menilainya perlu, opsi ringan: catat pembukaan rekap/riwayat lintas-FO di `audit_log`.

## DPO (Data Protection Officer)

**[Placeholder — diisi oleh DPMPTSP]**

- Nama DPO: ____________________
- Email: ____________________
- Telepon: ____________________
- Jam pelayanan: ____________________

## Versi Kebijakan

| Versi | Tanggal | Perubahan |
|-------|---------|-----------|
| 1.0 | Fase 1 / I8 | Kebijakan awal — audit log, consent checkin/chat, retensi 730 hari, DPO dashboard |

## Referensi

- UU No. 27/2022 tentang Pelindungan Data Pribadi
- Baseline migration `202607140003_feature_schema.sql` (skema audit_log, consent_log)
  dan `202607140004_security_and_automation.sql` (triggers, anonymization);
  perbaruan governance di `202607200001_p0_security_governance.sql` (trigger
  `update_role` petugas, retensi `chat_ai_log`)
- Dashboard DPO: `/admin/data-governance`
- Kebijakan terkait: `docs/KEBIJAKAN_AKUN_MITRA.md` (accountability akun mitra)

## Retensi lampiran live chat

Foto yang dilampirkan di live chat disimpan di Cloudflare R2 (bucket privat, area `chat-lampiran`) dan dihapus otomatis **90 hari** setelah pesan dikirim (`POST /api/chat/lampiran/bersihkan`, dipanggil cron dengan `CRON_SECRET`); teks pesan tetap. Hanya pemilik sesi dan staf dalam lingkup yang dapat membaca (404 seragam bagi pihak lain). Foto absensi petugas disimpan di area `absensi-foto` (hanya admin/front office).
