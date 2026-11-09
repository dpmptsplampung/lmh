# 11 db permintaan nomor

Status: ready-for-human
Wave: G4
Blocked by: 01, 05, 06, 08, 09

## What

Phase B database and API: short company data, Needs, contact requests with five states, one "Setujui" that checks consent and opens the number in the requester's account, account-only number reads, assisted requests with a one-use link code, emergency hold, outcome record, Need recommendations, and Phase B additions to the report and FO supervision.

## Requirements

K-B-02, K-B-03, K-B-04, K-B-05, K-B-08, K-B-12, K-B-13, K-B-17, K-B-20, K-B-23, K-SA-04 (Need panel), K-SA-05 (Phase B part), K-NF-04, K-NF-05, K-NF-10

## Tests

U-03, U-04, U-05, U-06, U-07, U-10 (outcome part) in `docs/umkm/MIGRASI-RILIS-UJI.md`. Static contract tests next to each migration; behavior in ticket 15.

## Detail (PM, 2026-11-09)

Dasar: `docs/umkm/SISTEM.md` bagian 3 sampai 7, `docs/umkm/ALUR-DAN-PERAN.md` bagian 3 sampai 8. Prinsip P-36: jalan paling sederhana. Celah lain cukup satu kalimat di kontrak.

**Migrasi.** `202611090008_umkm_permintaan.sql` dan bila perlu `0009`. Test kontrak, rollback `docs/rollback-umkm-*`, manifest, nama baru di `FORWARD_MIGRATION_FILES` (`supabase/migrations/migration-test-utils.ts`). Migrasi `0001` sampai `0007` sudah di-commit dan tidak diedit; perubahan fungsi lama lewat `CREATE OR REPLACE` di migrasi baru.

**Tabel (RLS aktif, tanpa grant langsung ke anon, authenticated, service_role).**
- `umkm_perusahaan`: satu baris per akun pemohon (UID Auth). Nama perusahaan, jabatan, rujukan `consent_log`, `diperiksa_oleh` dan `diperiksa_pada` (diisi saat permintaan pertama akun itu disetujui). Rekan sekantor adalah baris lain dan tidak mewarisi apa pun.
- `umkm_kebutuhan`: pemilik (baris perusahaan), teks singkat paling banyak 200 karakter, satu Kategori dari daftar katalog, kabupaten/kota opsional, status `aktif`/`ditutup`. Menutup Kebutuhan membatalkan permintaan yang belum `nomor_dibuka`.
- `umkm_permintaan_kontak`: Kebutuhan, profil, `pemohon_uid` (kosong untuk permintaan bantuan yang belum tertaut), kode permintaan pendek yang bisa dibaca (bukan rahasia), lima status `diajukan/menunggu_izin/nomor_dibuka/ditolak/dibatalkan`, versi, petugas penangan, `tahan_darurat boolean`, alasan tolak paling banyak 240 karakter, sumber `pemohon`/`petugas` (diam-diam), hash kode tautan sekali pakai, waktu. Untuk bantuan: nama dan kontak pemohon yang dicatat petugas.
- `umkm_pembukaan_nomor`: satu baris per pembukaan. Permintaan, `pemohon_uid`, `kontak_versi_id`, `izin_id` yang dipakai, petugas yang menekan Setujui, waktu, `hasil` bawaan `belum_diketahui` (pilihan `kerja_sama`/`tidak_berlanjut`). Tidak ada tabel keputusan atau rekonsiliasi terpisah; keputusan masuk `umkm_riwayat`.
- Hapus akun Auth tidak menghapus catatan: `pemohon_uid` menjadi NULL dan baca nomor otomatis gagal.

**Perusahaan (akun login bukan anonim; sesi anonim ditolak di database).**
- `umkm_simpan_perusahaan(nama, jabatan, setuju)`: sekali isi, boleh diubah sebelum permintaan pertama disetujui. Persetujuan dicatat ke `consent_log`. Nama, email, HP diambil dari profil pengunjung, tidak disalin.
- `umkm_simpan_kebutuhan`, `umkm_tutup_kebutuhan`, `umkm_ajukan_kontak(kebutuhan_id, profil_ids[], operasi_id)`: hanya profil `terbit`. Pasangan Kebutuhan-profil yang masih `diajukan`, `menunggu_izin`, atau `nomor_dibuka` dengan izin masih berlaku mengembalikan permintaan yang ada. Selain itu (ditolak, dibatalkan, atau izin sudah dicabut) membuat permintaan baru. Tanpa batas bisnis jumlah UMKM; hanya penjaga laju bersama G2 (`jaga_laju`) dan potongan teknis yang dilanjutkan idempoten.
- `umkm_permintaan_saya(cursor)`: paling banyak 20, hanya milik UID itu. Status, tanggal, alasan tolak, kode permintaan, nama UMKM, nama petugas penangan dan empat angka terakhir HP petugas (`petugas.no_hp`). Nomor UMKM tidak pernah ada di sini.
- `umkm_batalkan_permintaan`: hanya sebelum `nomor_dibuka`.
- `umkm_baca_nomor(permintaan_id)`: satu-satunya jalan nomor ke perusahaan. Lolos hanya bila UID sama dengan `pemohon_uid`, status `nomor_dibuka`, profil `terbit`, `tahan_darurat` false, `kontak_versi_id` pembukaan masih kontak terkini profil, dan baris izin terbaru untuk kontak itu masih `izin_id` milik pembukaan. Akibatnya pencabutan langsung berlaku, izin baru tidak menghidupkan pembukaan lama, dan nomor pengganti tidak pernah terbuka lewat pembukaan lama. Selain itu 409 tanpa nomor.
- `umkm_tautkan_akun(kode)`: akun login memasukkan kode bantuan; kode cocok, belum dipakai, permintaan belum tertaut, maka `pemohon_uid` dan perusahaan terisi dalam satu transaksi. Kode salah memakai penjaga laju bersama. Tanpa masa berlaku (P-36).
- `umkm_cari_rekomendasi(kebutuhan_id)`: hanya pemilik Kebutuhan. Paling banyak 10 profil `terbit` dengan Kategori sama, kabupaten/kota sama lebih dulu, lalu skor G3, tanpa profil yang sudah diminta di Kebutuhan itu. Tidak ada riwayat lihat atau suka.

**Petugas UMKM (pemeriksa aktif, sama seperti G1 sampai G3).**
- `umkm_daftar_tugas` menambah `jenis = 'permintaan'` untuk status `diajukan` dan `menunggu_izin`. Mendesak lebih dulu (`tahan_darurat`), lalu yang tertua. Ambil alih dengan `umkm_ambil_pekerjaan` yang sudah ada.
- `umkm_detail_permintaan(id)`: Kebutuhan, profil, data perusahaan dan pemohon (nama, HP, email dari profil pengunjung, atau kontak bantuan), tanda "perusahaan sudah diperiksa", status izin profil (ada atau tidak, tanpa nomor), dan pembukaan bila ada.
- `umkm_setujui_dan_buka(id, versi, operasi_id)`: satu transaksi dengan kunci baris dan versi. Memeriksa petugas aktif dan memegang tugas, profil `terbit`, tidak `tahan_darurat`, pemohon sudah tertaut, kontak terkini ada, izin terbaru untuk kontak terkini `diberikan`. Lolos: `nomor_dibuka`, baris pembukaan, tanda perusahaan diperiksa, riwayat. Izin tidak ada: `menunggu_izin`, tidak pernah terbuka otomatis kemudian. Belum tertaut: 409 `BELUM_TERTAUT`. Respons hanya status dan rujukan, tanpa nomor. Ulang dengan kunci operasi sama mengembalikan hasil pertama.
- `umkm_tolak_permintaan(id, versi, operasi_id, alasan)`: satu alasan singkat.
- Izin di layar permintaan: "Lihat nomor" (`umkm_akses_kontak_petugas`) dan pencatatan izin (`umkm_ubah_izin`) juga berlaku bila petugas memegang permintaan aktif untuk profil itu. Boleh lewat `CREATE OR REPLACE` atau RPC tipis baru; jejak tetap otomatis.
- `umkm_bantu_permintaan(...)`: petugas mencatat perusahaan, Kebutuhan, dan permintaan atas nama pemohon tanpa akun. Mengembalikan kode tautan acak sekali pakai satu kali saja; database hanya menyimpan hash.
- `umkm_catat_pemberitahuan(id)`: dipanggil oleh tombol WhatsApp, mencatat diam-diam ke riwayat. Tidak membuktikan pesan sampai.
- `umkm_catat_hasil(id, hasil)`: satu klik, `nomor_dibuka` tidak pernah dihitung sukses.
- `umkm_lepas_tahan(id, versi, operasi_id)`: satu klik dengan jejak.

**Templat WhatsApp pemohon (K-B-20).** Fungsi murni di `src/lib/umkm-katalog/` yang menerima nama pemohon, nama petugas, kode permintaan, nama UMKM, dan tautan masuk LMH kanonik, lalu menghasilkan teks `docs/umkm/ALUR-DAN-PERAN.md` bagian 8. Tidak ada parameter nomor UMKM. Test membuktikannya.

**FO dan admin (P-31, P-32).**
- Ringkasan pengawasan menambah hitungan permintaan per status dan lama proses. Jejak pengawasan menambah aksi permintaan tanpa nomor, tanpa nama perusahaan, tanpa data pemohon.
- `umkm_tahan_permintaan(id, alasan, versi, operasi_id)`: FO dan admin tanpa penanda, juga petugas. Menyetel `tahan_darurat`, alasan singkat wajib, jejak, masuk daftar tugas sebagai mendesak.
- Tidak ada jalur FO ke nomor, isi Kebutuhan, data pemohon, atau kode tautan, termasuk lewat penanda pemeriksa palsu.

**Laporan (K-SA-05).** `umkm_laporan_statistik` dan unduhan menambah: permintaan per status, jumlah permintaan per UMKM (minat perusahaan, hanya di laporan internal), lama tunggu sampai keputusan, dan hasil. Tanpa nomor dan kontak pemohon.

**Masa simpan.** Tambahkan ke `umkm_private.bersihkan_retensi`: 730 hari sesudah permintaan ditutup (ditolak, dibatalkan) atau sesudah izin dicabut, kosongkan teks Kebutuhan dan kontak bantuan, dan hapus hash kode tautan. Hitungan dan status tetap.

**Route.** Perusahaan: `src/app/api/umkm-katalog/{perusahaan,kebutuhan,permintaan,tautkan}/**`. Petugas: `src/app/api/admin/umkm-tugas/permintaan/**`. FO: `src/app/api/admin/umkm-pengawasan/permintaan/**`. Respons nomor `Cache-Control: private, no-store`, tanpa log isi. Sebelum migrasi diterapkan, route memberi 503 tenang; tidak ada fallback service-role.

## Comments

2026-11-09: kode, tinjauan, dan perbaikan G4 selesai, gate lulus, di-commit lokal. Migrasi belum diterapkan; pemeriksaan staging tercatat di `.scratch/umkm-fitur/PROGRES.md`.
