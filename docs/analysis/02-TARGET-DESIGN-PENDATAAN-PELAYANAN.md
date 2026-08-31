# 02 — TARGET DESIGN: FITUR PENDATAAN PELAYANAN
**Lampung Maju Hub (LMH)**  
**Modul:** Loket Layanan Antrean, Helpdesk OSS, & Perizinan DPMPTSP  
**Dokumen Induk:** LMH-AGENT-SPEC.md

---

## 1. STRUKTUR FORMULIR PENDATAAN

### 1.1 Kelompok 1: Helpdesk OSS
- **Field Wajib (*Mandatory*):**
  1. `nama_pemohon`: Nama lengkap pemohon (prapopulasi dari registrasi awal).
  2. `nama_usaha`: Nama badan usaha / toko / usaha perorangan.
  3. `uraian_solusi`: Uraian kendala dan solusi / konsultasi yang diberikan di loket.
  4. `tindak_lanjut`: Tindakan atau tindak lanjut yang diambil.
- **Field Opsional (Tambahan Format Excel OSS):**
  1. `tipe_pelaku_usaha`: `perseorangan` (Orang Perseorangan) | `non_perseorangan` (Badan Usaha).
  2. `status_penanaman_modal`: `PMDN` | `PMA` | `tidak_ada` (Bukan PMA/PMDN).
  3. `lokasi_usaha`: Teks bebas nama kabupaten/kota/wilayah kegiatan usaha (mis. *Bandar Lampung*).
  4. `skala_usaha`: `Mikro` | `Kecil` | `Menengah` | `Besar`.
  5. `sektor_usaha_kbli`: Kode 5 digit KBLI / sektor usaha.
  6. `alamat_pemohon`, `no_hp`, `email`, `keperluan_awal` (prapopulasi).
  7. `catatan_internal`: Catatan tambahan internal loket.

### 1.2 Kelompok 2: Layanan Perizinan DPMPTSP
- **Field Wajib (*Mandatory*):**
  1. `nama_pemohon`: Nama lengkap pemohon (prapopulasi).
  2. `nama_perusahaan`: Nama badan usaha / perusahaan / perorangan pemohon.
  3. `opd_teknis`: OPD Teknis terkait (mis. Dinas ESDM, Dinas Lingkungan Hidup, Dinas Kehutanan, dll).
  4. `uraian_permohonan`: Uraian permohonan izin/non-perizinan atau dokumen yang diajukan.
  5. `tindak_lanjut`: Tindak lanjut yang diambil di loket.
- **Field Opsional:**
  1. `alamat_pemohon`, `no_hp`, `email`, `keperluan_awal` (prapopulasi).
  2. `catatan_petugas`: Catatan persyaratan atau arahan tindak lanjut tambahan.

---

## 2. INTEGRASI REKAPITULASI & EKSPOR CSV
- **Tab Rekap OSS:** Kolom `[Tanggal/Tiket, Pemohon, Nama Usaha & Tipe, Lokasi & Penanaman Modal, KBLI & Skala, Tindakan, Uraian Solusi, Petugas]`.
- **CSV Ekspor OSS:** `Tanggal,Nomor Tiket,Nama Pemohon,No HP,Nama Usaha,Tipe Pelaku Usaha,Status Penanaman Modal,Lokasi Usaha,Skala Usaha,KBLI,Tindakan,Uraian Solusi,Petugas,Status`.
- **Tab Rekap Perizinan:** Kolom `[Tanggal/Tiket, Pemohon/Perusahaan, OPD Teknis, Uraian Permohonan, Tindak Lanjut, Catatan Petugas, Petugas]`.
- **CSV Ekspor Perizinan:** `Tanggal,Nomor Tiket,Nama Pemohon,No HP,Nama Perusahaan,OPD Teknis,Uraian Permohonan,Tindak Lanjut,Catatan Petugas,Petugas,Status`.
