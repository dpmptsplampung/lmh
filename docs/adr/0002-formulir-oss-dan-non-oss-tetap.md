# Formulir OSS dan Non OSS tetap, Layanan lain memakai Pendataan Khusus dinamis

Pendataan Khusus per Layanan kini diatur admin (jenis isian dinamis). Helpdesk OSS dan Non OSS sudah punya formulir tetap (`pelayanan_oss`, `pelayanan_perizinan`) yang dipakai rekap, ekspor Excel, koreksi, dan banyak test. Kami memutuskan **kedua formulir itu tetap seperti sekarang** dan hanya Layanan lain yang memakai Pendataan Khusus dinamis, karena data yang sudah ada tidak boleh diubah dan pemilik tidak ingin memindahkan data lama.

## Considered Options

- **Pindahkan** formulir lama menjadi definisi dinamis dan migrasikan datanya — satu jalur rekap, tetapi butuh migrasi data di produksi. Ditolak.
- **Arsipkan** tabel lama dan baca sebagai arsip untuk periode lama — tetap dua jalur rekap tanpa manfaat bagi OSS. Ditolak.

## Consequences

Rekap Data Pelayanan punya dua sumber kolom: kolom tetap untuk Helpdesk OSS/Non OSS, kolom dinamis untuk Layanan lain. Admin tidak bisa mengubah isian formulir OSS/Non OSS; perubahan di sana tetap butuh migrasi dan deploy. Jangan "merapikan" kedua formulir ini ke model dinamis tanpa keputusan baru dari pemilik.
