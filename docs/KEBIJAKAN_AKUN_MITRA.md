# Kebijakan Akun Mitra

> Fase 1 / B5 — Audit temuan B5

## Keputusan

Model akun mitra: **individual account** (satu akun per individu), **bukan** akun bersama per instansi.

Setiap petugas/pegawai mitra (mis. Bank Lampung, BALMON) login dengan akun pribadinya sendiri yang terhubung ke email pribadinya. Tidak ada akun `mitra@banklampung.go.id` yang dipakai bersama oleh beberapa staf.

## Rasional

1. **Accountability & audit trail** — setiap aksi (update dokumen investasi, balas chat, ubah data UMKM) terikat ke satu identitas. Dengan akun bersama, tidak mungkin menelusuri siapa yang melakukan perubahan.
2. **Magic-link edit flow (K5)** — alur edit UMKM via magic link mengharuskan setiap mitra punya email pribadi tempat link dikirim. Akun bersama tidak punya mailbox per individu.
3. **Keamanan** — password sharing / session sharing pada akun bersama adalah anti-pola keamanan. Akun individual memungkinkan revoke per individu tanpa mengganggu tim.
4. **RBAC yang akurat** — role (`petugas`/`admin`) melekat pada individu, bukan instansi. Seseorang bisa berpindah instansi tanpa mengubah seluruh tim.

## Implementasi

- Akun mitra dibuat via **invite flow** (K4): `POST /api/admin/petugas/invite`. Admin DPMPTSP mengundang individu dengan email pribadinya; sistem mengirim magic link untuk menyelesaikan pendaftaran.
- Field `petugas.layanan_id` menunjukkan layanan/instansi mitra yang ditangani individu tersebut. Satu individu → satu layanan (model saat ini).
- Tidak ada akun `@lmh.go.id` generik untuk instansi mitra. Email yang dipakai adalah email pribadi/instansi pegawai.

## Migrasi akun bersama (jika ditemukan di lapangan)

Jika ditemukan akun bersama yang dipakai oleh beberapa staf pada instance existing:

1. **Audit** — catat akun bersama tersebut (email, layanan_id, daftar staf yang memakai).
2. **Undang tiap staf** via invite flow K4 dengan email pribadinya.
3. **Tetapkan `layanan_id`** yang sama untuk tiap staf baru.
4. **Nonaktifkan akun bersama** — revoke session & ubah password ke random; jangan hapus row `petugas` (audit history). Tandai sebagai deprecated via komentar/internal flag jika perlu.
5. **Komunikasi** ke staf bahwa mereka harus pakai akun pribadinya.

## Pengecualian

Tidak ada pengecualian untuk akun bersama. Semua akun mitra harus individual. Jika suatu instansi tidak punya email individu, koordinasikan dengan DPMPTSP untuk membuat email instansi per pegawai.

## Referensi

- Audit temuan B5: akun mitra harus individual, bukan shared instansi.
- K4 (invite flow): `src/app/api/admin/petugas/invite/`
- K5 (magic-link edit UMKM): `src/app/api/umkm/request-edit-link/`
- Tabel `petugas`: migration 011/013
