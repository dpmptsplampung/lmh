# Tabel & edit inline; UI/UX ditunda (2026-10-30)

Status: DIKERJAKAN hanya tiga rekomendasi awal. Perombakan tampilan (palet, glass/gradasi, kerangka admin, homepage)
DITUNDA atas keputusan pemilik; dua percobaan visual sudah dibatalkan karena terlalu banyak berubah dan selera tidak cocok.

## Dikerjakan

1. **Kelas kolom tabel global** (`src/styles/globals.css`, bagian "Kelas kolom tabel"): `.kol-utama` + `.sub`, `.kol-teks`
   (satu baris + elipsis, isi lengkap di `title`), `.kol-angka`, `.kol-waktu`, `.kol-aksi`, `.kosong-sel`, `.sr-only`, `.saklar`.
   Tampilan dasar `.table` tidak diubah. Dipakai di Rekap, Buku Tamu (Tujuan), dan riwayat FO Penanganan (Topik, Catatan).
2. **Rekap > Data Pelayanan**: preset **Ringkas** (bawaan) / **Semua kolom**, sel dua baris (tanggal + jam·durasi,
   nama + HP·email), teks bebas satu baris, klik baris membuka detail lengkap, kolom pertama menempel saat digulir.
   Tab Helpdesk OSS / Non OSS langsung "Semua kolom". Excel tidak berubah. Komponen: `TabelDataPelayanan.tsx`.
3. **Edit langsung di tabel** (`src/components/admin/SuntingInline.tsx`: `SelTeksInline`, `BarisTambah`):
   - Topik Penanganan: ubah nama, tambah topik, urutan lewat panah, status lewat saklar, cakupan lewat daftar di kiri.
   - Instansi: bagian "Instansi" di halaman Kelola Layanan (menggantikan `InstansiDialog`).
   - Pendataan Khusus: label dan "Wajib" diedit di baris, rincian jenis/opsi membuka di bawah baris.
   Tetap dialog: arsip/hapus, selesai eskalasi, alihkan/ambil alih tiket, tolak reservasi.

## Ditunda (UI/UX), catatan untuk nanti

### Sisa rekomendasi audit 1

1. Kelas kolom tabel global di `globals.css`: `.kol-teks` (satu baris + elipsis, teks lengkap di `title`),
   `.kol-angka` (kanan, tabular), `.kol-waktu` (nowrap), `.kol-aksi` (lebar minimum, nowrap); judul kolom 12px
   sentence case tanpa pita, sticky; wadah putih polos bertepi 1px; `vertical-align: top` seragam; chip tidak terjepit.
2. Rekap > Data Pelayanan: preset kolom Ringkas (Tanggal, Unit, Pengunjung, Topik, Hasil, Petugas) + tombol
   "Semua kolom"; sel dua baris (nama / HP·email; mulai–selesai·durasi); teks bebas satu baris; klik baris
   membuka detail lengkap; kolom pertama sticky. Excel tetap lengkap.
3. Riwayat Perubahan: kolom Perubahan jadi ringkasan "N isian diubah: a, b, …" + buka/tutup detail.
4. Kelola Layanan: kolom Fitur berisi chip yang aktif saja; Loket·Prefiks satu sel; saklar inline untuk Homepage,
   Layar TV, Antrean, Chat, Bot; aksi = Ubah + menu ⋯ (Pendataan Khusus, Arsipkan).
5. FO Penanganan riwayat: Catatan/Topik `.kol-teks`, Waktu nowrap.
6. Antrean: badge status pendek (alasan di baris kedua abu-abu), emoji ●▶✓✗○ diganti ikon.
7. Buku Tamu: Tujuan `.kol-teks`. Performa: kolom durasi/persen `.kol-angka`. Kunjungan: hapus kolom `#`.
8. Dialog -> edit langsung di tabel (komponen bersama):
   - Topik Penanganan: klik nama = input (Enter simpan, Esc batal), baris "+ Tambah topik", urutan pakai ↑↓,
     status pakai saklar, cakupan pakai daftar kiri dengan jumlah.
   - Instansi: tabel inline (nama, singkatan) di halaman Kelola Layanan, bukan dialog.
   - Isian Pendataan Khusus: label & wajib inline; jenis/opsi lewat baris yang mengembang. Konfirmasi hapus tetap.
   - Tetap dialog: Selesai Eskalasi, Alihkan/Ambil Alih, Tolak Reservasi, Arsip/Hapus permanen, form Ubah Layanan
     (dipindah ke halaman bila sempat).
9. Pengaduan: satu kontrol status (bukan 4 tombol). Saran: potong 3 baris + "Selengkapnya".
10. RoleNote: satu kalimat, tanpa kotak biru.
11. Keadaan memuat/kosong/galat tabel: satu pola bersama.

### Temuan audit 2 (glass, gradasi, layout, homepage)

- Token global (`src/styles/globals.css`): primary = indigo Tailwind persis (#6366f1/#4f46e5), latar
  `body::before` 3 radial-gradient + linear, `--glass-*` dipakai di 31+ modul (blur 16-20px, bayangan biru-ungu),
  `.card:hover` mengangkat kartu, dua font (Inter + Plus Jakarta Sans).
- Pemindaian gaya (admin+FO): 13 emoji, 27 bayangan, 16 gradasi, 6 ungu/indigo, 67 blur kaca.
- Homepage: semua rata tengah, lencana di atas judul, kata judul bergradasi ungu-oranye, logo kecil di tengah
  hero, kartu layanan berikon dalam kotak berwarna 4 kolom dengan sel yatim, "Jalur Cepat" 9 kartu identik,
  tombol mengambang "Live Chat" bergradasi, footer daftar tautan.
- Admin shell: logo besar 120px di sidebar, judul halaman di pita kaca, latar gradasi terlihat di bawah konten.

Pratinjau tampilan tanpa database dibuat sebagai alat lokal dan tidak dimasukkan ke git.
