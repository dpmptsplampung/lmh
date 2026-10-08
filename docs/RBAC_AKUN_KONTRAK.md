# Kontrak API akun (RBAC Tahap 2): login username + manajemen akun

Semua respons JSON, `Cache-Control: no-store`. Galat: `{ "error": "pesan" }`. Autentikasi = cookie sesi Supabase (kecuali dicatat).
Kode umum: 401 belum login / akun nonaktif, 403 bukan Admin, 400 input salah (zod: `{error:"Invalid input", details:{field:[...]}}`), 429 terlalu banyak, 503 layanan email belum dikonfigurasi.

## Login USERNAME (tanpa route baru, klien-murni)
Browser memanggil `signInWithPassword({ email: resolveLoginEmail(input), password })` dengan
`import { resolveLoginEmail, PESAN_LOGIN_GAGAL } from '@/lib/akun/login'`.
- Input mengandung `@` dipakai apa adanya (akun lama/transisi); selain itu `username@<STAFF_EMAIL_DOMAIN>` (default `staf.lmh.internal`, env `NEXT_PUBLIC_STAFF_LOGIN_DOMAIN`).
- Pada SEMUA galat login tampilkan `PESAN_LOGIN_GAGAL` ("Nama pengguna atau kata sandi salah"), bukan pesan mentah Supabase.
- Setelah login baca baris sendiri (RLS `petugas_self_read`); bila `wajib_ganti_sandi=true` arahkan ke halaman ganti sandi.
- Login Google pengunjung & magic-link mitra TIDAK berubah. Jangan pernah memakai magic-link/OTP/recover Supabase untuk email sintetis.
- Helper lain: `isValidUsername`, `normalizeUsername`, `normalizeNoHp` (sama di `src/lib/akun/login.ts`).

## Admin (hanya Admin AKTIF)
### GET /api/admin/petugas
200 `{ akun: [{ id, auth_user_id, nama, username|null, role, layanan_id|null, layanan_nama|null, no_hp|null, aktif, nonaktif_sejak, nonaktif_alasan, email_login|null, email_notifikasi_tersamar|null, email_notifikasi_terverifikasi, operator_default|null, wajib_ganti_sandi, last_sign_in_at|null, belum_pernah_login, dibuat_at }] }`.
Tampilkan label "belum pernah login" bila `belum_pernah_login`.

### PATCH /api/admin/petugas/{id}
Body (semua opsional, minimal satu, kunci lain ditolak 400): `nama` (2-200), `no_hp` (string|null; dinormalisasi +62...), `layanan_id` (uuid|null; wajib non-null untuk role petugas), `username` (huruf kecil/angka/-, 3-32), `email_notifikasi` (email|null; mengubahnya menghapus status terverifikasi), `role` (`admin|front_office|petugas`), `email_login` (email nyata; ditolak bila domain sintetis atau bersama `username`).
- Ganti `username` otomatis mengganti email login sintetis + mengakhiri sesi akun itu (kecuali akun sendiri).
- Admin tidak boleh mengubah role-nya sendiri; Admin aktif terakhir tidak bisa diturunkan (trigger DB).
- 200 `{ ok:true }`. 404 akun tidak ada. 409 username dipakai / email login dipakai / aturan Admin terakhir. 502 sinkron Auth gagal (perubahan DB dibatalkan).

### POST /api/admin/petugas/{id}/reset-password
Body kosong. Server membuat sandi sementara, mengakhiri semua sesi akun, mengisi `wajib_ganti_sandi=true`.
200 `{ ok:true, sandi_sementara:"...", wajib_ganti_sandi:true }` (tampilkan SEKALI, tidak disimpan/diaudit). 403 bila target = diri sendiri.

### POST /api/admin/petugas/status (sudah ada, dilengkapi)
Body `{ aksi:"nonaktifkan", petugas_id, alasan }` atau `{ aksi:"aktifkan", petugas_id }`. Nonaktif juga memblokir login (ban Auth) + mengakhiri sesi; aktif membuka blokir. Error DB: tidak boleh menonaktifkan diri sendiri / Admin aktif terakhir (400). FO ditolak (403).

## Profil sendiri (staf aktif, semua role)
### GET /api/me/profil
200 `{ profil: { id, nama, username, role, layanan_id, layanan_nama, no_hp, email_notifikasi, email_notifikasi_terverifikasi, operator_default, wajib_ganti_sandi } }`.

### PATCH /api/me/profil
Body (opsional, kunci lain ditolak): `no_hp` (string|null), `email_notifikasi` (email|null), `operator_default` (2-100 | null = "operator bertugas", nama orang yang memakai akun bersama; disalin otomatis ke `absensi_petugas.operator_nama`).
Mengubah `email_notifikasi` mengirim tautan verifikasi (Resend, berlaku 30 menit, maks 3/jam).
200 `{ ok:true, verifikasi_dikirim:boolean }`.

### POST /api/me/email-verifikasi
Kirim ulang tautan verifikasi. 200 `{ ok:true }`; 400 bila belum ada email / sudah terverifikasi; 429 batas 3/jam; 503 email belum dikonfigurasi.

### GET /api/auth/verifikasi-email?token=...  (tanpa sesi; dari tautan email)
Redirect 303 ke `/admin/profil?email_verif=ok` atau `?email_verif=gagal` (halaman profil dibuat frontend; path boleh disesuaikan lewat konstanta `HALAMAN_PROFIL` di route).

### POST /api/me/sandi
Body `{ sandi_lama, sandi_baru (10-72 karakter, beda dari lama), keluarkan_perangkat_lain?: boolean }`.
200 `{ ok:true }` (juga membersihkan `wajib_ganti_sandi`). 400 sandi lama salah / sandi baru lemah. 429 maks 5 percobaan/15 menit.

## Lupa sandi mandiri
### POST /api/auth/lupa-sandi  (tanpa sesi)
Body `{ username }`. SELALU 200 `{ ok:true }` (tidak membocorkan keberadaan akun). Tautan pemulihan dikirim via Resend ke `email_notifikasi` yang SUDAH terverifikasi, mengarah ke `/auth/callback?next=/admin/profil?wajib=1` (frontend: pada sesi recovery cukup `supabase.auth.updateUser({password})` dari browser tanpa sandi lama; `/api/me/sandi` selalu menuntut sandi lama. Catatan: flag `wajib_ganti_sandi` tidak otomatis bersih lewat jalur recovery, hanya lewat `/api/me/sandi`). 429 bila terlalu sering (per username 3/15 menit, per IP 10/15 menit). Tanpa email terverifikasi: UI tampilkan "Hubungi Admin untuk atur ulang sandi".
