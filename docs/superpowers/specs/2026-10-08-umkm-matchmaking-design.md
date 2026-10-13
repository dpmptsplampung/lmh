# Rancangan: Impor UMKM & Matchmaking Perusahaan–UMKM

- Tanggal: 2026-10-08
- Status: **Rancangan disetujui CEO (brainstorm)** — belum ada implementasi
- Dokumen pendamping: [`2026-10-08-umkm-aturan-pelabelan.md`](2026-10-08-umkm-aturan-pelabelan.md) (taksonomi + aturan ketat pelabelan)
- Menggantikan: fitur UMKM "kebutuhan vs penawaran" (`listing_umkm`, `v_umkm_match`, `/umkm`, `/umkm/inbox`, `/umkm/edit/[id]`) — dipensiunkan setelah fitur baru berjalan.

## 1. Tujuan

1. Mengimpor data UMKM satudata (±904 ribu baris) **setelah dikurasi ketat**, sehingga yang tampil benar-benar layak dan jelas usahanya.
2. Menyediakan **katalog ala e-commerce** tempat perusahaan besar mencari UMKM sebagai pemasok **produk, jasa, atau bahan baku**.
3. Menyambungkan perusahaan ke UMKM secara **aman PDP** (kontak dibuka bertahap) dengan **tiket** yang ditindaklanjuti Petugas Matchmaking.
4. **Merekam dampak**: kunjungan, pencarian, UMKM dilihat/disukai, peminat, tiket, dan hasil kerja sama.

### Bukan cakupan fase 1
- Arah sebaliknya (UMKM mencari perusahaan / perusahaan memajang "kebutuhan terbuka") → fase 2.
- Ulasan/bintang dari perusahaan (hanya dari tiket berhasil) → fase 2.
- LLM di dalam aplikasi: **tidak ada sama sekali**. LLM hanya dipakai sekali sebagai alat bantu menyusun kamus label (lihat §3.3).

## 2. Data sumber (temuan dari sampel 100 baris)

File `Data UMKM Lengkap.xlsx`, sheet `data UMKM`, ±903.922 baris × 49 kolom, ekspor satudata.umkm.go.id (gabungan banyak file "Page N.xlsx"). Sampel 100 baris hanya dari Kab. Lampung Barat → **angka di bawah belum representatif**.

| Temuan | Dampak |
|---|---|
| ±1/3 baris berisi data usaha (produk, kegiatan, KBLI 5 digit, modal, omzet, HP, foto); sisanya kerangka (nama + NIK + alamat + kategori KBLI umum) | Saringan kelengkapan membuang mayoritas |
| `nib` kosong 100% | NIB tidak bisa jadi syarat |
| PII berat: `nik_pengusaha`, `tanggal_lahir`, `jenis_kelamin`, `is_disabilitas`, `pendidikan_formal`, `kontak_hp` | Dibuang/dibatasi di tahap lokal |
| `alamat_latitude/longitude` rusak (titik desimal hilang, mis. `-5.0751e+16`) | Diperbaiki skrip |
| `kontak_hp` tanpa `0` depan (`85379895270`) | Dinormalisasi |
| `nama_usaha` sering = nama orang | Judul publik diganti produk + kab/kota |
| Tidak ada pembeda kebutuhan/penawaran | Model matchmaking lama tidak bisa dipakai |
| `foto_usaha` = URL server satudata | Kelayakan hotlink **belum diketahui** (lihat §8) |

## 3. Bagian 1 — Impor & kurasi

### 3.1 Prinsip
- **Semua pembersihan di komputer lokal.** Data mentah (NIK dkk.) **tidak pernah** masuk database/cloud.
- Dua langkah terpisah: **(a) bersihkan & labeli → file bersih + rekap**; **(b) impor ke DB** hanya setelah CEO memeriksa rekap.
- File mentah & file bersih (masih berisi HP) disimpan di folder **di luar repository**, mis. `D:\Data-UMKM\`. Skrip disimpan di repo (`scripts/umkm/`), data tidak pernah.

### 3.2 Tahapan langkah (a)

| # | Tahap | Aturan |
|---|---|---|
| 1 | Buang PII | Hitung dulu agregat (jumlah per jenis kelamin, disabilitas, pendidikan, per kab/kota) untuk rekap, lalu buang `nik_pengusaha`, `tanggal_lahir`, `jenis_kelamin`, `is_disabilitas`, `pendidikan_formal`, `rt/rw`. `nama_pengusaha` disimpan **internal saja**. |
| 2 | Rapikan | HP → format `08…`, valid bila 10–13 digit dan diawali `08`; koordinat diperbaiki dan dicek dalam batas Provinsi Lampung (lat −6,0 s/d −3,7; lng 103,5 s/d 106,0), di luar itu dikosongkan; nama kab/kota diseragamkan; teks di-trim. |
| 3 | Saringan kelengkapan | Wajib: (`produk_utama` **atau** `kegiatan_utama` bermakna) **dan** HP valid **dan** `foto_usaha` terisi. |
| 4 | Pelabelan & kelayakan | Lewat **kamus label** (§3.3). Menggantikan saringan sektor berbasis KBLI: KBLI hanya lapisan terakhir. Baris berstatus selain `LAYAK` tidak tampil publik. |
| 5 | Buang duplikat | Kunci `id_data_badan_usaha`; tambahan: HP + nama usaha sama → ditandai duplikat, simpan yang datanya paling lengkap. |
| 6 | Judul publik | Bila `nama_usaha` = `nama_pengusaha` atau terdeteksi nama orang → judul = `<Spesifik> — <Kab/Kota>` (mis. "Keripik Pisang — Kab. Lampung Barat"). |
| 7 | Blocklist | Baris yang `id_data_badan_usaha`-nya ada di daftar opt-out/dihapus → dibuang. |

**Keluaran:** file bersih berlabel (CSV) + **rekap corong** berisi angka saja (904 rb → lolos #3 → berlabel LAYAK → setelah dedup), plus distribusi Jenis/Kategori/kab-kota dan alasan penolakan.

### 3.3 Pelabelan: "kamus kosakata", bukan per baris
Urutan prioritas sumber: **`produk_utama` > `kegiatan_utama` > `nama_usaha` > KBLI**.

1. Skrip menormalisasi frasa (`produk_utama`, `kegiatan_utama`, `nama_usaha` bila bukan nama orang) dan menghitung frekuensi pasangan **(frasa, KBLI 2 digit)**.
2. Frasa diurutkan dari yang paling sering; **LLM melabeli frasa, bukan baris**, sampai cakupan ≥85% baris yang lolos tahap 3 atau frekuensi < 3.
3. Hasil = **kamus label** (frasa → Jenis › Kategori › Spesifik + status + keyakinan). Skrip menerapkannya ke semua baris mengikuti urutan prioritas sumber.
4. Baris yang tidak tercakup kamus / `TIDAK_JELAS` → **antrean pelabelan petugas** (internal). Label dari petugas menambah kamus untuk impor berikutnya.
5. Aturan pelabelan lengkap, taksonomi tertutup, dan protokol model murah: **dokumen pendamping**.

**Pembagian model saat eksekusi:** taksonomi & aturan = Opus (sudah ditulis di dokumen pendamping) · skrip & pelabelan kamus = **Sonnet** (bukan Haiku) · cek format = skrip/Haiku · audit sampel acak 200 label = Opus.

### 3.4 Impor berulang (±6 bulan sekali)
- Kunci: `id_data_badan_usaha`.
- Kolom asal satudata (produk, omzet, foto, dsb.) diperbarui.
- Kolom yang dikelola petugas/UMKM **tidak pernah ditimpa**: status kontak, terverifikasi, disembunyikan, label hasil koreksi petugas, penghitung (dilihat/suka/peminat).
- Opt-out → blocklist permanen.

## 4. Bagian 2 — Katalog ala e-commerce (`/umkm`)

"Barang dagangan"-nya adalah **UMKM**, bukan produk.

### 4.1 Akses
- Jelajah **bebas tanpa login**; identitas baru diminta saat "Hubungi". Kunjungan dihitung per sesi anonim (anon sign-in yang sudah ada).
- Pembatas laju pencarian per sesi (`check_anon_rate`); tidak ada ekspor/unduh publik.

### 4.2 Alur pencarian
1. **Pilih Jenis**: Produk / Jasa / Bahan Baku.
2. **Pilih Kategori / ketik yang spesifik** (mis. "keripik pisang") — dicari di Spesifik, judul, produk, kegiatan (full-text + toleransi salah ketik).
3. **Kabupaten/kota** (opsional). Opsi "Hanya terverifikasi".

Pencarian = filter kolom label yang terindeks → ringan meski ratusan ribu baris.

### 4.3 Kartu & profil
- **Tampil publik:** judul, produk/kegiatan, Jenis › Kategori › Spesifik, **kab/kota saja**, foto, skala usaha, tahun mulai, status kontak, lencana, angka sosial.
- **Tidak tampil publik (internal petugas):** kecamatan, alamat, titik peta, omzet, modal, tenaga kerja, HP (kecuali status kontak mengizinkan, lewat alur §5), nama pemilik.
- **Lencana:** "Terverifikasi" (dikonfirmasi petugas) / "Data Satudata — belum diverifikasi" / "Baru".
- **"UMKM serupa"** (Spesifik/Kategori sama) di bawah profil; **"Favorit saya"** (daftar yang disukai sesi ini).

### 4.4 Angka sosial & pengurutan
| Angka | Definisi |
|---|---|
| Dilihat | jumlah buka profil, **dedup 1× per sesi per hari** |
| Pengunjung unik | jumlah sesi berbeda yang pernah membuka |
| Disukai | siapa saja, **1× per perangkat/sesi**, dengan pembatas laju; lonjakan tak wajar terlihat di dashboard |
| Peminat | jumlah formulir "Hubungi" terkirim (padanan "terjual") |

- Angka baru ditampilkan bila ≥10; di bawahnya tampil lencana "Baru".
- Urutkan: **Paling relevan (default)** · Paling dilihat · Paling disukai · Paling banyak peminat · Terbaru. "Relevan" = terverifikasi dulu, lalu kelengkapan data, lalu kecocokan teks.
- Angka disimpan sebagai **penghitung terdenormalisasi** di data UMKM dan diperbarui berkala dari tabel jejak — tidak dihitung ulang per tampilan.

### 4.5 Pencarian tanpa hasil
Tampil tombol **"Minta petugas carikan"** → tiket tanpa UMKM tertentu (§5). Kata kunci tanpa hasil tercatat untuk statistik.

## 5. Bagian 3 — Hubungi & tiket matchmaking

### 5.1 Status kontak UMKM
| Status | Tombol di profil |
|---|---|
| `belum_konfirmasi` (default semua data impor) | hanya **"Hubungi lewat petugas"** |
| `boleh_langsung` (petugas sudah dapat izin UMKM, atau UMKM klaim profil) | "Hubungi lewat petugas" + **"Hubungi langsung"** |
| `tidak_bisa_dihubungi` | "Hubungi lewat petugas" (petugas mencarikan alternatif); UMKM turun peringkat |

### 5.2 Formulir perusahaan
Nama, nama perusahaan, alamat perusahaan, HP, email, detail kebutuhan; opsional: volume/jumlah, frekuensi, target waktu. Centang persetujuan pemrosesan data (PDP, dicatat di `consent_log`).

### 5.3 Jalur langsung
Verifikasi email (link) → tampil HP + tombol WhatsApp UMKM → tercatat sebagai peminat (jalur langsung) → **email tindak lanjut 14 hari**: "Apakah berlanjut?" (jawab sekali klik → masuk statistik hasil).

### 5.4 Jalur petugas (tiket)
- **Sumber tiket:** (1) tombol di profil, (2) "Minta petugas carikan" (tanpa UMKM), (3) dibuat manual petugas dari email/surat/pertemuan.
- **Status:** `Baru → Diproses → Dipertemukan → Selesai`. Hasil wajib saat Selesai: **berlanjut** (nilai transaksi opsional) / **tidak berlanjut** + alasan (harga, kapasitas, kualitas, perusahaan batal, lainnya) / **UMKM tidak bisa dihubungi** (status kontak UMKM ikut diperbarui).
- Saat menelepon UMKM, petugas meminta izin kontak langsung → bila setuju: `boleh_langsung` + Terverifikasi.
- Perusahaan mendapat email setiap perubahan status (Resend, `lib/email-html.ts`).
- **Target respons pertama: 2 hari kerja**; lewat batas → ditandai merah.
- Riwayat setiap perubahan tiket tersimpan (pola `pengaduan_riwayat`).

### 5.5 Peran
- **Petugas Matchmaking UMKM** (ditunjuk admin) — satu-satunya yang memproses tiket dan mengoreksi label/status UMKM.
- **Front Office** — mendapat **notifikasi** setiap tiket baru dan akses **lihat saja**.
- **Admin** — semua, termasuk menunjuk Petugas Matchmaking dan mengelola kamus/taksonomi.
- Halaman admin baru wajib didaftarkan di `src/lib/admin-nav.ts`. Bentuk teknis "Petugas Matchmaking" (flag pada `petugas` vs peran baru) diputuskan saat perencanaan, mengikuti keputusan RBAC Okt 2026.

## 6. Bagian 4 — Statistik (dashboard admin)

Dapat dilihat admin, FO, Petugas Matchmaking; filter periode; ekspor Excel (pola `lib/rekap/excel.ts`).

| Corong | Angka |
|---|---|
| Kunjungan | sesi di halaman matchmaking |
| Pencarian | Jenis/Kategori/Spesifik terpopuler; **daftar pencarian tanpa hasil** |
| Dilihat | UMKM dilihat, terpopuler, per Kategori & kab/kota |
| Peminat | klik "Hubungi", formulir terkirim, jalur langsung vs petugas |
| Tiket | per status, lama respons pertama, **lewat 2 hari kerja**, lama sampai selesai |
| Hasil | jumlah berlanjut, nilai transaksi, alasan gagal |

**Kesehatan katalog:** total tampil, % terverifikasi, antrean belum berlabel, jumlah opt-out, jumlah "tidak bisa dihubungi", lonjakan suka tak wajar.

**Privasi:** jejak perilaku anonim (per sesi), diumumkan di kebijakan privasi (pola WP-14 / `jejak_minat_investasi`); jejak mentah dihapus setelah 12 bulan, agregat disimpan.

## 7. Garis besar model data (final ditentukan di rencana implementasi)

| Tabel | Isi |
|---|---|
| `umkm` | satu baris per UMKM: `sumber_id` (unik), judul, kolom publik, kolom internal, label (Jenis/Kategori/Spesifik/sumber label/keyakinan), status tampil, status kontak, terverifikasi, penghitung sosial |
| `umkm_kamus_label` | frasa + KBLI2 → label; sumber (`llm`/`petugas`), versi taksonomi |
| `umkm_taksonomi` | daftar tertutup Jenis/Kategori (dikelola admin) |
| `umkm_blocklist` | `sumber_id` opt-out + alasan + tanggal |
| `umkm_jejak` | event anonim: cari (filter, kata kunci, jumlah hasil), lihat, suka, klik hubungi |
| `umkm_suka` | (umkm, sesi) unik |
| `matchmaking_tiket` + `matchmaking_tiket_riwayat` | tiket, data perusahaan, jalur, status, hasil, petugas, timestamp |

Akses publik lewat **view/RPC yang hanya memuat kolom publik** (pola `v_umkm_public`), RLS ketat; logika penting (dedup jejak, penghitung, transisi status tiket) di Postgres sesuai konvensi project. Migrasi = forward-migration baru + test kontrak statis.

## 8. Hal terbuka (diputuskan saat eksekusi)

1. **Foto satudata**: apakah URL bisa diakses publik & boleh di-hotlink? Bila tidak → syarat "ada foto" dilonggarkan (lencana tanpa foto) atau foto diunggah ulang saat klaim. Hotlink butuh pembaruan CSP `img-src`.
2. **Dasar publikasi data satudata**: konfirmasi ke pemilik data (Kementerian UMKM/Dinas) bahwa profil usaha boleh dipublikasikan di portal DPMPTSP.
3. Statistik penuh 904 rb baris (angka saja) untuk menyesuaikan taksonomi v1 & ambang cakupan kamus.
4. Ukuran DB Supabase vs jumlah UMKM lolos + jejak.
5. Nasib data `listing_umkm` lama (arsip/migrasi) saat pensiun.

## 9. Urutan eksekusi

| Langkah | Isi | Model |
|---|---|---|
| E1 | Skrip statistik (angka saja) + daftar frasa terbanyak | Sonnet |
| E2 | Tinjau & sesuaikan taksonomi v1 dari statistik | Opus (singkat) |
| E3 | Skrip pembersihan tahap 1–3, 5–7 | Sonnet |
| E4 | Pelabelan kamus per batch + validasi skrip + audit batch pertama | Sonnet + audit Opus |
| E5 | Terapkan kamus → file bersih berlabel + rekap → **review CEO** | Sonnet |
| E6 | Sub-proyek aplikasi, masing-masing lewat `writing-plans`: (1) skema & impor DB, (2) katalog, (3) hubungi & tiket, (4) statistik | — |

Impor ke DB produksi (E6-1) **wajib konfirmasi CEO** (`scripts/apply-migration.mjs` menyentuh produksi).
