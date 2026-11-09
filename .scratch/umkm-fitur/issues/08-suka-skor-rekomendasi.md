# 08 suka skor rekomendasi

Status: ready-for-agent
Wave: G3
Blocked by: 04

## What

Likes for logged-in accounts, daily score at 02.00 WIB with pg_cron, new-UMKM slots at positions 5 and 15, Baru label, umkm_serupa.

## Requirements

K-SA-02, K-SA-03, K-SA-04, K-SA-06, K-SA-07

## Tests

U-08 (Likes part), U-09, U-10 in `docs/umkm/MIGRASI-RILIS-UJI.md`.

## Detail (PM, 2026-11-09)

Dasar: `docs/umkm/SISTEM-STATISTIK.md` bagian 1 sampai 5. Yang tidak tertulis di sini mengikuti dokumen itu. Bila dokumen menawarkan jalan rumit dan jalan sederhana, pilih yang sederhana (P-36).

Migrasi: `202611090005_*` dan sesudahnya. `0001` sampai `0004` sudah di-commit dan tidak boleh diedit, jadi fungsi G2 diganti lewat `CREATE OR REPLACE` di migrasi baru.

**Suka**
- Hanya akun login bukan anonim. Sesi anonim formulir dianggap belum login. Tombol di halaman detail saja; yang belum login diarahkan ke `/login` lalu kembali ke profil.
- Satu per akun per profil, RPC idempoten `true`/`false`, bukan toggle. Staf tidak dihitung. Tahap A belum punya pemilik profil, jadi aturan profil sendiri belum berlaku.
- Tanggal suka pertama tidak berubah saat batal lalu suka lagi. Akun terhapus ikut menghapus sukanya. Total publik dijaga trigger satu tempat.
- Penjaga laju memakai pola `check_anon_rate`, hanya untuk memberi suka; membatalkan selalu boleh.

**Skor dan urutan**
- `Skor = 5*L90 + V90`; sakelar mati `Skor = L90`. Tanpa peluruhan, persentil, atau poin lain.
- pg_cron 02.00 WIB (`0 19 * * *`). Satu statement dalam satu transaksi, hanya snapshot aktif yang disimpan. Dibuat bertahap hanya bila tiket 10 membuktikan perlu.
- Satu-satunya urutan `paling_sesuai`, menggantikan `terbaru`. Kecocokan kata kunci dulu (spesifik, kategori, lalu nama atau deskripsi), lalu skor, lalu hash harian WIB, lalu id. Filter tetap filter keras. Profil tanpa baris skor bernilai 0.
- Slot profil baru di posisi 5 dan 15 halaman pertama: terbit kurang dari 30 hari, cocok filter, bergilir harian. Bila tidak ada, urutan biasa. Id slot disimpan di cursor supaya halaman berikutnya tidak mengulang.
- Cursor mengikat filter, snapshot skor, dan hari. Snapshot berganti: kode khusus, layar memulai ulang pencarian dengan pesan tenang.

**Tampilan**
- Kartu dan detail menampilkan Suka, juga Dilihat saat sakelar aktif, termasuk nol. Tepat di bawah 1.000, ringkas di atasnya dengan teks aksesibel yang tepat. Sakelar mati: Dilihat tidak tampil.
- Label "Baru" untuk terbit kurang dari 30 hari. Status suka akun tidak masuk cache bersama.
- `umkm_serupa(profil)`: paling banyak 10, kategori sama, kabupaten/kota sama lebih dulu, tanpa profil itu sendiri. Tanpa riwayat perilaku.

Di luar tiket: rekomendasi Need (tahap B), opsi urutan lain, ambang angka minimal.

## Comments

2026-11-09: kode suka, skor, urutan, slot baru, dan UMKM serupa selesai, ditinjau, gate lulus. Belum di-commit; migrasi belum diterapkan. Lihat `.scratch/umkm-fitur/PROGRES.md`.
