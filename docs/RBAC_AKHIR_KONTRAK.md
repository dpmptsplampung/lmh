# Kontrak API gelombang penutup: Kelola Layanan, Buku Tamu, Riwayat, Buat Akun

Migrasi `202610090004_kelola_layanan_audit.sql` (butuh Tahap 0 + `202610090002`). Respons JSON `Cache-Control: no-store`, galat `{ "error": "pesan" }`.
Kode umum: 401 belum login/nonaktif, 403 peran tidak berhak, 400 input salah (zod: `{error:"Invalid input", details:{field:[..]}}`, kunci asing ditolak), 404, 409 bentrok.

## 1. Kelola Layanan
Nilai `status_tampilan` TETAP nilai DB lama (bukan kata baru): `aktif` = tampil, `coming_soon` = segera hadir, `nonaktif` = sembunyi dari daftar publik. Tidak memengaruhi penerbitan tiket/check-in.

### GET /api/admin/layanan  (Admin atau Front Office; petugas 403)
200 `{ layanan: [{ id, nama, tipe, aktif, penyerta, status_tampilan, tampil_di_layar, punya_antrean, punya_chat, chatbot_aktif, nomor_loket, prefiks_antrean }], bisa_ubah: boolean }` (`bisa_ubah` = true hanya Admin; FO tampilkan mode baca).

### PATCH /api/admin/layanan/{id}  (Admin aktif)
Body (semua opsional, minimal satu): `nama` (2-100), `nomor_loket` (1-20 | null), `prefiks` (1-3 huruf, otomatis huruf besar | null; disimpan di kolom `prefiks_antrean`; unik antar layanan), `status_tampilan` (`aktif|coming_soon|nonaktif`), `tampil_di_layar` (bool), `punya_antrean` (bool), `punya_chat` (bool). Kunci lain (termasuk `aktif`, `chatbot_aktif`) = 400.
200 `{ ok:true }`. 404 layanan tidak ada. 409 nama/prefiks sudah dipakai. Dicatat otomatis di Riwayat (trigger DB, pelaku = Admin).
Peringatan UI: `nama` layanan juga dipakai beberapa fitur untuk pencocokan (lihat `lib/constants.ts`); beri konfirmasi saat Admin mengganti nama. Ganti `prefiks` hanya memengaruhi nomor BARU.

### PATCH /api/admin/layanan/{id}/bot  (Admin aktif)
Body `{ aktif: boolean }`. 200 `{ ok:true, chatbot_aktif }`. FO/petugas 403. Menggantikan toggle langsung `layanan.chatbot_aktif` dari klien (petugas sudah tidak boleh menulis `layanan`).

### Yang dibaca publik
- `v_layanan_publik` (anon + login): `id, nama, tipe, penyerta, status_tampilan, punya_antrean, punya_chat, chatbot_aktif, nomor_loket, prefiks_antrean`; sudah menyaring `aktif=false` dan `status_tampilan='nonaktif'`. Frontend: pakai view ini (bukan tabel `layanan`) untuk daftar di landing/check-in/chat/reservasi; tampilkan label "Segera hadir" dan nonaktifkan pilihan bila `coming_soon`; sembunyikan chat bila `punya_chat=false`, antrean/check-in bila `punya_antrean=false`. Halaman admin tetap membaca tabel `layanan`.
- `v_layar_antrian` (layar TV) kini hanya memuat layanan `aktif AND tampil_di_layar`. Struktur kolom tidak berubah.
- Check-in/reservasi/penerbitan tiket tidak membaca kolom tampilan: layanan yang disembunyikan tetap bisa menerima tiket (diuji).

## 2. Buku tamu  (Admin + Front Office; petugas 403; RLS di DB sama)
Pemetaan kolom: `instansi`=asal, `bertemu`=menemui_siapa, `tujuan`=keperluan, `waktu_masuk`=jam.
### GET /api/admin/buku-tamu?dari=YYYY-MM-DD&sampai=YYYY-MM-DD&q=&page=1&limit=50
Default `dari=sampai=hari ini (WIB)`; `q` mencari nama/instansi/bertemu; `limit` maks 100.
200 `{ items:[{ id, nama, instansi, no_hp, bertemu, tujuan, waktu_masuk, dicatat_oleh }], total, page, limit }`.
### POST /api/admin/buku-tamu
Body: `nama` (2-200), `bertemu` (2-200), opsional `instansi` (<=200), `no_hp` (dinormalisasi +62..., salah = 400), `tujuan` (<=500), `waktu_masuk` (ISO dengan zona; default sekarang; hanya 48 jam terakhir, tidak di masa depan). `dicatat_oleh` diisi server (kunci itu di body = 400).
201 `{ tamu: {...} }`. Ubah/hapus entri: hanya Admin dan hanya lewat klien Supabase langsung (belum ada API/halaman; tidak diminta).

## 3. Riwayat Perubahan  (Admin aktif saja)
### GET /api/admin/riwayat?jenis=&aksi=&orang=&dari=&sampai=&page=1&limit=50
`jenis` = `audit_log.entitas` (mis. `layanan`, `layanan_jadwal`, `layanan_libur`, `site_settings`, `landing_content`, `faq_knowledge_base`, `layar_token`, `petugas`, `rekap_pelayanan`, `chat_sesi`, `pelayanan_oss`, `pelayanan_perizinan`); `aksi` mis. `layanan_ubah`, `petugas_ubah`, `akun_ubah`, `site_settings_tambah`; `orang` = `petugas.id` pelaku (uuid); `dari/sampai` = tanggal WIB. `limit` maks 100.
200 `{ items:[{ id, actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru, created_at, pelaku:{nama,username}|null }], total, page, limit }` urut terbaru. `nilai_lama/nilai_baru` hanya berisi kolom yang berubah (insert: baru saja; delete: lama saja); `null` untuk entri lama. Nilai rahasia tidak pernah ada (token layar, embedding, kunci site_settings = `[disamarkan]`, teks > 500 karakter dipotong).
Penulisan audit_log: HANYA trigger/fungsi DB dan route server (service role); pengguna login (termasuk Admin) tidak bisa INSERT/UPDATE/DELETE langsung.

## 4. Buat akun layanan
### POST /api/admin/petugas  (Admin aktif)
Body: `username` (huruf kecil/angka/-, 3-32; bukan admin/root/...), `nama` (2-200), `role` (`admin|front_office|petugas`), `layanan_id` (uuid; WAJIB untuk `petugas`, diabaikan/NULL untuk role lain), opsional `no_hp`, `email_notifikasi` (null/email), `sandi_sementara` (10-72; bila kosong server membuat 14 karakter).
201 `{ ok:true, id, username, sandi_sementara, wajib_ganti_sandi:true }` — tampilkan sandi SEKALI (tidak disimpan, tidak diaudit). Email login = `username@<domain sintetis>` (`resolveLoginEmail`). 409 username dipakai. 400 layanan_id/format salah (akun auth dibatalkan otomatis). Login pertama wajib ganti sandi.

### POST /api/me/sandi-selesai  (staf aktif, tanpa body)
Dipanggil browser setelah `supabase.auth.updateUser({ password })` berhasil pada sesi PEMULIHAN (lupa sandi), supaya `wajib_ganti_sandi` bersih. 200 `{ ok:true }` (atau `{ok:true,sudah_bersih:true}`). 403 bila sesi dibuat lewat login-sandi (pakai `/api/me/sandi`). 409 bila sandi belum diganti dalam 10 menit terakhir. Bukan batas keamanan, hanya mencegah flag dibersihkan tanpa mengganti sandi.

## 5. Perbaikan review (migrasi 202610090005 + route)
- FO aktif boleh membaca tabel `petugas` (SELECT saja); query modal absensi dan embed nama di halaman absensi tidak perlu diubah.
- `PATCH /api/admin/layanan/{id}`: 422 `{kode:"RENAME_UBAH_JENIS_FORM"}` bila nama baru mengubah jenis form pendataan (`determineFormType`: OSS / Non OSS-Perizinan / lain). Pertahankan kata kuncinya; tetap tampilkan konfirmasi di UI.
- `POST /api/admin/petugas/status`: aksi `ganti_pic` dihapus (410). Nonaktif/aktif kini dicatat di Riwayat (`akun_nonaktifkan`, `akun_aktifkan`); undangan `akun_undang`.
- `POST /api/admin/settings/llm/rahasia`: `base_url` opsional (mengikat kunci ke host-nya). `PUT /api/admin/settings/llm`: 400 `details:[{id,error}]` bila kunci terikat ke host lain dari base_url entri; kunci lama terikat saat pertama dipakai. Uji penyedia: 409 `HOST_KUNCI_BEDA`.
- `site_settings.jam_tutup_layanan` hanya `16:00` (DB menolak 22023). `POST /api/chat/ai`: 404 bila `layanan_id` tidak ada.
- DB menolak menghapus Admin aktif terakhir (juga lewat cascade auth.users).
