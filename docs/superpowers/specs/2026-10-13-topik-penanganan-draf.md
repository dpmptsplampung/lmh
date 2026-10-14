# Draf Topik Penanganan & Kode Antrean per Layanan

- Tanggal: 2026-10-13 · Status: **DRAF — menunggu koreksi CEO / masing-masing layanan**
- Dasar: keputusan G.4 (Opsi A) di [`rencana implementasi`](../plans/2026-10-13-implementasi-fo-mutasi-fondasi-plan.md).
- Sumber layanan: 10 layanan aktif di produksi (diperiksa read-only 2026-10-13). Semua `prefiks_antrean` saat ini kosong.
- **Catatan kejujuran:** isi topik di bawah disusun dari nama layanan dan pengetahuan umum, **bukan** dari prosedur resmi tiap layanan. Wajib dikoreksi oleh petugas/penanggung jawab masing-masing. Daftar disimpan di tabel `topik_penanganan` yang dapat diubah admin tanpa deploy, jadi tidak harus sempurna sekarang. Topik "Lainnya" selalu ada dan mewajibkan catatan singkat.

## 1. Topik Front Office (berlaku untuk semua pengunjung)

Informasi perizinan/syarat · Status permohonan · Pendaftaran atau kendala akun OSS · Konsultasi investasi · Kendala teknis (perlu eskalasi) · Pengaduan atau saran · Lainnya

## 2. Kode antrean 2 huruf (usul, dapat disunting admin)

Format tiket: `<KODE>-<nomor 3 digit>` (mis. `OS-014`), nomor reset tiap hari WIB per kode.

| Layanan | Kode |
|---|---|
| Helpdesk OSS | OS |
| Non OSS (SiCantik Lampung) | NO |
| BALMON | BM |
| Bank Lampung | BL |
| BPJS Kesehatan | BP |
| Investment Gallery | IG |
| Layanan Jasa Industri | JI |
| Matchmaking UMKM | MU |
| Sertifikasi Halal | SH |
| Sertifikasi Mutu Keamanan Hasil Perikanan | SM |

## 3. Topik petugas layanan (draf)

**Helpdesk OSS:** Pendaftaran/aktivasi akun OSS · Lupa kata sandi / verifikasi akun · Penerbitan NIB · Perubahan data NIB/usaha · Pemilihan KBLI · Perizinan berusaha berbasis risiko · Kendala sistem OSS · Lainnya

**Non OSS (SiCantik Lampung):** Pendaftaran akun SiCantik · Pengajuan permohonan izin non-OSS · Status/pelacakan permohonan · Persyaratan dokumen · Revisi atau penolakan permohonan · Kendala sistem · Lainnya

**BALMON:** Informasi perizinan/regulasi · Persyaratan dan prosedur · Status permohonan · Pengaduan atau gangguan · Konsultasi teknis · Lainnya

**Bank Lampung:** Informasi produk pembiayaan usaha · Pembiayaan/kredit UMKM · Pembukaan rekening · Persyaratan dan prosedur · Status pengajuan · Lainnya

**BPJS Kesehatan:** Pendaftaran peserta · Perubahan data peserta · Status kepesertaan · Iuran/tunggakan · Keluhan layanan · Lainnya

**Investment Gallery:** Informasi peluang investasi · Dokumen/profil investasi · Konsultasi investor · Permintaan data/peta potensi · Kunjungan atau pertemuan investor · Lainnya

**Layanan Jasa Industri:** Informasi layanan · Pengajuan layanan · Status permohonan · Persyaratan dan prosedur · Konsultasi teknis · Lainnya

**Matchmaking UMKM:** Pendaftaran UMKM · Pembaruan profil UMKM · Permintaan pemasok dari perusahaan · Pencocokan UMKM-perusahaan · Kendala katalog/sistem · Lainnya

**Sertifikasi Halal:** Pengajuan sertifikasi halal · Pendampingan pengajuan · Persyaratan dokumen · Status permohonan · Perpanjangan/perubahan · Kendala sistem · Lainnya

**Sertifikasi Mutu Keamanan Hasil Perikanan:** Pengajuan sertifikat · Persyaratan dan prosedur · Status permohonan · Inspeksi/audit · Perpanjangan · Lainnya

## 4. Cara koreksi

Tandai topik yang salah/kurang/berlebihan per layanan (atau kirim daftar yang benar). Koreksi masuk sebagai seed awal tabel `topik_penanganan` pada migrasi Tahap B; setelah itu admin dapat mengubah langsung di aplikasi.
