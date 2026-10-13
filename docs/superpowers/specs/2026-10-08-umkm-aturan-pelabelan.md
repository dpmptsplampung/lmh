# Aturan Pelabelan UMKM (Kamus Kosakata)

- Tanggal: 2026-10-08 · Taksonomi **v1**
- Dokumen induk: [`2026-10-08-umkm-matchmaking-design.md`](2026-10-08-umkm-matchmaking-design.md) §3.3
- Pembaca utama: **model pelabel (Sonnet)**. Baca dokumen ini **utuh** sebelum setiap sesi pelabelan. Aturan di sini **mengikat**; bila ragu, pilih `TIDAK_JELAS`.

---

## 0. Ringkasan untuk model pelabel (baca ini dulu)

1. Kamu melabeli **frasa**, bukan UMKM. Satu frasa bisa mewakili ribuan UMKM — satu kesalahan = ribuan profil salah. **Hati-hati > cepat.**
2. Pertanyaan yang kamu jawab: *"Bila perusahaan besar mencari pemasok, apakah UMKM yang menulis frasa ini bisa memasok sesuatu, dan apa?"*
3. **Jenis dan Kategori hanya dari daftar tertutup §3.** Dilarang mengarang kode.
4. **Ragu = `TIDAK_JELAS`.** Lebih baik tidak tampil daripada salah tampil.
5. Usaha yang melayani **konsumen perorangan secara eceran** = `TIDAK_LAYAK` (`ECERAN`), meskipun produknya bagus.
6. Keluaran **hanya CSV** sesuai §6. Tanpa penjelasan, tanpa markdown, tanpa baris tambahan.

---

## 1. Tujuan & definisi

Katalog matchmaking menawarkan **UMKM sebagai pemasok bagi perusahaan** (B2B). Label dipakai untuk pencarian 3 langkah: **Jenis → Kategori/Spesifik → kab/kota**.

| Istilah | Arti |
|---|---|
| **Jenis** | `BAHAN_BAKU` / `PRODUK` / `JASA` |
| **Kategori** | kode dari daftar tertutup §3 (mis. `PR-01`) |
| **Spesifik** | nama baku barang/jasa yang dipasok, maks. 3 kata (mis. "Keripik Pisang") |
| **Status** | `LAYAK` / `TIDAK_LAYAK` / `TIDAK_JELAS` / `KATEGORI_BELUM_ADA` |
| **Keyakinan** | `TINGGI` / `SEDANG` (tidak ada "rendah" — rendah = `TIDAK_JELAS`) |

### 1.1 Menentukan Jenis
- **BAHAN_BAKU** — hasil alam/primer **atau olahan setengah jadi** yang lazimnya **dibeli untuk diolah lagi** oleh pembeli (gabah, biji kopi, singkong, tepung tapioka, gaplek, karet, ikan segar, kayu gelondong, pasir).
- **PRODUK** — barang **jadi**, siap dipakai/dikonsumsi/dijual ulang tanpa diolah (keripik, kopi bubuk kemasan, kain tapis, kursi, sabun, bata).
- **JASA** — yang dijual adalah **pekerjaan/layanan**, bukan barang (katering, jahit pesanan, angkutan, sablon, bengkel, kebersihan).

Bila satu frasa memuat barang **dan** jasa, Jenis mengikuti **yang dibayar pembeli**: "jahit seragam" = JASA (ongkos jahit); "konveksi seragam" / "produksi seragam" = PRODUK (membeli seragam jadi).

---

## 2. Masukan yang diterima model

Skrip menyiapkan batch CSV (pemisah `;`, UTF-8), **maks. 200 baris per batch**:

```
id;frasa;kbli2;kbli2_nama;jumlah;contoh_lain
F000123;keripik pisang;10;Industri Makanan;1843;kripik pisang coklat | keripik pisang sale
```

| Kolom | Arti |
|---|---|
| `id` | ID frasa — wajib dikembalikan persis |
| `frasa` | frasa ternormalisasi (huruf kecil, tanpa tanda baca berlebih) dari `produk_utama` / `kegiatan_utama` / `nama_usaha` |
| `kbli2` | 2 digit pertama KBLI baris-baris pemilik frasa ini (pasangan frasa+kbli2 = satu kunci) |
| `kbli2_nama` | nama golongan pokok KBLI |
| `jumlah` | jumlah UMKM yang memakai pasangan ini |
| `contoh_lain` | ≤3 variasi tulisan asli, hanya sebagai konteks |

### 2.1 Normalisasi oleh skrip (sebelum ke model)
Huruf kecil · trim · spasi ganda → tunggal · buang tanda baca kecuali `&` dan `/` · buang awalan bentuk badan usaha (`ud`, `cv`, `pt`, `pd`, `kub`, `koperasi`) · buang kata pengisi **netral** (`usaha`, `bidang`, `jenis`, `berupa`, `dll`, `dsb`).
**Jangan dibuang** (karena sinyal penting): `toko`, `warung`, `kios`, `jual`, `jualan`, `dagang`, `produksi`, `pembuatan`, `olahan`, `home industri`, `grosir`, `agen`, `distributor`, `pengepul`, `supplier`, `catering`.

### 2.2 Peran `kbli2`
**Frasa menang atas KBLI.** KBLI hanya dipakai bila frasa **ambigu** (mis. "kopi", "ikan", "ayam", "kayu", "pisang"). KBLI dari pendataan sering salah kode — jangan menolak frasa produksi yang jelas hanya karena `kbli2` = 47.

---

## 3. Taksonomi tertutup v1

> Kode **hanya** dari tabel ini. Kategori harus sesuai Jenis-nya (`BB-` ↔ BAHAN_BAKU, `PR-` ↔ PRODUK, `JS-` ↔ JASA).

### 3.1 BAHAN_BAKU

| Kode | Kategori | Termasuk | Bukan (arahkan ke) |
|---|---|---|---|
| `BB-01` | Hasil Perkebunan | biji kopi/green bean, kopi gelondong/asalan, lada, kakao, kelapa butir, kopra, karet/lump, TBS sawit, cengkeh, pala, tebu, tembakau daun, nira aren | kopi bubuk kemasan (`PR-02`), gula aren cetak (`BB-07`) |
| `BB-02` | Tanaman Pangan | gabah, jagung pipil, singkong/ubi kayu, ubi jalar, kedelai, kacang tanah | beras kemasan bermerek (`PR-11` bila grosir), tepung (`BB-07`) |
| `BB-03` | Sayur & Buah Segar | sayuran, cabai, bawang, tomat, pisang, nanas, pepaya, jeruk, buah segar lain | keripik buah (`PR-01`) |
| `BB-04` | Peternakan | sapi/kambing/ayam hidup, telur, susu segar, daging segar dari peternak/rumah potong | bakso/olahan daging (`PR-01`) |
| `BB-05` | Perikanan | ikan/udang/cumi segar, ikan asin curah, rumput laut, benih ikan, hasil tangkapan nelayan | kerupuk ikan/olahan (`PR-01`), ikan hias (`PR-10`) |
| `BB-06` | Kayu, Bambu & Rotan | kayu gelondong/olahan kasar (balok, papan), bambu, rotan mentah, arang kayu | mebel (`PR-05`), anyaman (`PR-04`) |
| `BB-07` | Pangan Setengah Jadi | tepung tapioka, tepung lain, gaplek, beras dari penggilingan (curah), gula aren/merah cetak, minyak kelapa curah, kopi sangrai curah, tahu/tempe untuk dipasok* | — |
| `BB-08` | Galian & Bahan Alam Bangunan | pasir, batu kali/split, kerikil, tanah urug | bata/batako/genteng (`PR-06`) |
| `BB-09` | Barang Bekas & Daur Ulang | rongsok, besi tua, plastik/kardus bekas, minyak jelantah (pengepul) | — |
| `BB-10` | Pupuk, Bibit & Pakan | pupuk organik/kompos, bibit tanaman, bibit sawit/kopi, pakan ternak/ikan, maggot | — |

\* Tahu/tempe: pilih `PR-01` (makanan jadi) **kecuali** frasa menyebut pemasok/partai besar → `BB-07`. Default `PR-01`.

### 3.2 PRODUK

| Kode | Kategori | Termasuk | Bukan (arahkan ke) |
|---|---|---|---|
| `PR-01` | Makanan Olahan | keripik, kerupuk, kemplang, kue kering/basah produksi, roti, dodol, lempok, sambal kemasan, bumbu, abon, frozen food, bakso/nugget produksi, tahu/tempe, kue pesanan | warung bakso/makan (`TIDAK_LAYAK/ECERAN`), katering (`JS-01`) |
| `PR-02` | Minuman Olahan | kopi bubuk/kemasan, teh, jamu, sirup, sari buah, minuman kemasan, madu kemasan, air minum isi ulang/galon | kedai kopi/cafe (`ECERAN`) |
| `PR-03` | Pakaian & Tekstil | konveksi produk jadi, seragam jadi, kaos, batik, **kain tapis**, tenun, sulam, bordir produk | jasa jahit (`JS-02`), toko pakaian (`ECERAN`) |
| `PR-04` | Kerajinan & Suvenir | anyaman, ukiran, suvenir, aksesoris, manik, kerajinan bambu/rotan/limbah, plakat | — |
| `PR-05` | Mebel & Produk Kayu | kursi, meja, lemari, kusen, pintu, jendela kayu, rak kayu, spring bed lokal | kayu balok (`BB-06`) |
| `PR-06` | Bahan Bangunan Olahan | batu bata, batako, paving, genteng, buis beton, tiang/pagar beton | pasir/batu (`BB-08`), toko bangunan (`ECERAN`) |
| `PR-07` | Produk Logam & Alat | pandai besi, alat pertanian (cangkul, parang), teralis/pagar besi/kanopi **produk**, rak besi, gerobak, mesin sederhana | jasa las/perbaikan (`JS-06`) |
| `PR-08` | Kosmetik, Herbal & Kebersihan | sabun, minyak atsiri/kayu putih, lulur, herbal non-minuman, deterjen/cairan pembersih produksi | — |
| `PR-09` | Kemasan | kardus, plastik kemasan, besek/wadah anyaman untuk kemasan, label/stiker kemasan | percetakan umum (`JS-05`) |
| `PR-10` | Tanaman & Hewan Hias | tanaman hias, bibit bunga, ikan hias, burung kicau (budidaya) | bibit produksi pertanian (`BB-10`) |
| `PR-11` | Grosir Barang Konsumsi | **grosir/agen/distributor** sembako, minuman, ATK, gas LPG (pangkalan/agen), sabun dll. | toko/warung sembako (`ECERAN`) |

### 3.3 JASA

| Kode | Kategori | Termasuk | Bukan (arahkan ke) |
|---|---|---|---|
| `JS-01` | Katering & Nasi Kotak | catering/katering, nasi kotak, snack box, prasmanan | produksi kue (`PR-01`) | rumah makan/warung makan **tanpa** kata katering (`ECERAN`) |
| `JS-02` | Penjahitan Pesanan | penjahit, jahit seragam, jahit pakaian pesanan, bordir pesanan | permak/vermak (`JASA_PERSONAL`) |
| `JS-03` | Angkutan & Logistik | angkutan barang, truk, pick up, ekspedisi, kurir, rental/sewa mobil, bus/travel carter | ojek/ojol perorangan (`JASA_PERSONAL`) |
| `JS-04` | Kebersihan, Laundry & Pertamanan | cleaning service, laundry (kiloan/hotel/seragam), sedot WC, pertamanan/lanskap, pengendalian hama | — |
| `JS-05` | Percetakan, Sablon & Desain | percetakan, digital printing, sablon, spanduk/banner, stempel, desain grafis, plang/papan nama | fotokopi **saja** (`ECERAN`) |
| `JS-06` | Bengkel, Las & Perbaikan | bengkel mobil/motor, las, bubut, servis AC/elektronik/mesin, dinamo | tambal ban (`JASA_PERSONAL`) |
| `JS-07` | Konstruksi & Pertukangan | tukang bangunan, renovasi, kontraktor kecil, instalasi listrik/air, pengeboran sumur, pemasangan baja ringan | — |
| `JS-08` | Acara & Dokumentasi | sewa tenda, dekorasi, sound system, organ tunggal, foto/video dokumentasi, event organizer | rias pengantin/salon (`JASA_PERSONAL`) |
| `JS-09` | Jasa Pertanian & Perikanan | sewa traktor/alat panen, jasa penggilingan, jasa semprot, jasa potong hewan, jasa pengeringan | — |
| `JS-10` | Pelatihan & Jasa Profesional | kursus/pelatihan, jasa IT/website, konsultan, penerjemah, akuntansi/pajak UMKM | bimbel anak (`JASA_PERSONAL`) |

---

## 4. Status & alasan

| Status | Kapan | Kolom `kategori` | Kolom `catatan` |
|---|---|---|---|
| `LAYAK` | frasa jelas, B2B relevan, masuk daftar §3 | wajib kode §3 | kosong |
| `TIDAK_LAYAK` | jelas, tapi tidak layak katalog | kosong | **kode alasan** (tabel bawah) |
| `TIDAK_JELAS` | tidak bisa ditentukan dengan yakin | kosong | ≤6 kata mengapa |
| `KATEGORI_BELUM_ADA` | jelas & B2B relevan, tapi tidak ada kategori yang cocok | kosong | usulan nama kategori ≤4 kata |

**Kode alasan `TIDAK_LAYAK`:**

| Kode | Arti | Contoh |
|---|---|---|
| `ECERAN` | menjual eceran ke konsumen perorangan | warung, kelontong, toko sembako, kios, pulsa/konter HP, warung makan, bakso/mie ayam/pecel lele/soto (warung), gorengan, kedai kopi/cafe, angkringan, pedagang keliling/sayur keliling, toko pakaian, toko bangunan, pertamini/bensin eceran, fotokopi saja, apotek/toko obat |
| `JASA_PERSONAL` | jasa untuk perorangan, tak relevan B2B | pangkas rambut, salon, rias pengantin, pijat/urut, permak, tambal ban, ojek, bimbel anak, penitipan anak, cuci motor |
| `TIDAK_BERMAKNA` | tidak menjelaskan apa pun | "-", "ada", "usaha", "dagang", "jualan", "lainnya", "umkm", angka saja |
| `NAMA_ORANG` | hanya nama orang/toko tanpa petunjuk usaha | "hastuti", "bu sri", "toko berkah", "ud maju jaya" |
| `TERLARANG_SENSITIF` | tidak pantas dipromosikan pemerintah | minuman keras/tuak, rokok/rokok linting, judi/togel, rentenir/simpan pinjam/gadai, obat keras, satwa dilindungi, senjata |

Catatan: daun tembakau (petani) tetap `BB-01`; yang `TERLARANG_SENSITIF` adalah **produk rokok**.

---

## 5. Aturan Spesifik (wajib untuk `LAYAK`)

1. Kata benda barang/jasa yang dipasok — **bukan** kata kerja (`Keripik Pisang`, bukan `Membuat Keripik`).
2. **Maks. 3 kata**, Kapitalisasi Tiap Kata, **ejaan baku KBBI**: kripik→Keripik, krupuk→Kerupuk, cathering/ketring→Katering, sablon→Sablon, kue→Kue, tapis→Tapis.
3. **Tanpa** merek, nama orang, nama tempat, angka harga, kata pengisi (`usaha`, `jual`, `produksi`, `aneka`, `home industri`).
4. Bentuk **tunggal**, tidak memakai "-an" berlebih (`Keripik`, bukan `Keripik-keripikan`).
5. Pertahankan **varietas bila bermakna bagi pembeli**: `Kopi Robusta`, `Keripik Pisang`, `Gula Aren`, `Ikan Lele`.
6. **Banyak produk dalam satu frasa**: ambil **produk pertama** yang disebut bila beda kategori; bila satu kategori, ambil kepala bersama (`keripik pisang, singkong, talas` → `Keripik`).
7. Jangan mengulang nama kategori bila ada yang lebih spesifik (`PR-01` + `Makanan` ✗ → `Kue Kering` ✓). Bila memang hanya umum, boleh: `Makanan Ringan`.
8. Untuk JASA, Spesifik = layanannya: `Katering`, `Nasi Kotak`, `Jahit Seragam`, `Angkutan Barang`, `Sablon Kaos`, `Las Teralis`.

Setelah semua batch selesai, skrip mengumpulkan daftar Spesifik unik dan **satu pass konsolidasi** (Sonnet) menggabungkan sinonim ke bentuk kanonik (mis. `Kripik Pisang`, `Keripik Pisang Coklat` → `Keripik Pisang`). Pass konsolidasi tunduk pada aturan §5 yang sama.

---

## 6. Format keluaran (wajib persis)

Header + satu baris per `id` masukan, **urutan sama**, pemisah `;`, tanpa tanda kutip kecuali teks mengandung `;`:

```
id;status;jenis;kategori;spesifik;keyakinan;catatan
F000123;LAYAK;PRODUK;PR-01;Keripik Pisang;TINGGI;
F000124;TIDAK_LAYAK;;;;TINGGI;ECERAN
F000125;TIDAK_JELAS;;;;;dagang apa tidak disebut
F000126;KATEGORI_BELUM_ADA;PRODUK;;Lilin Aromaterapi;SEDANG;Lilin & Pewangi
```

| Kolom | `LAYAK` | `TIDAK_LAYAK` | `TIDAK_JELAS` | `KATEGORI_BELUM_ADA` |
|---|---|---|---|---|
| jenis | wajib | kosong | kosong | wajib |
| kategori | wajib (§3) | kosong | kosong | kosong |
| spesifik | wajib (§5) | kosong | kosong | wajib |
| keyakinan | `TINGGI`/`SEDANG` | `TINGGI`/`SEDANG` | kosong | `TINGGI`/`SEDANG` |
| catatan | kosong | kode alasan §4 | ≤6 kata | usulan kategori ≤4 kata |

**Keyakinan:** `TINGGI` = frasa sendiri sudah tegas. `SEDANG` = perlu `kbli2`/`contoh_lain` untuk memutuskan, atau ada sedikit tafsir. Selebihnya → `TIDAK_JELAS`.

---

## 7. Pohon keputusan (jalankan berurutan per baris)

1. Frasa kosong / tak bermakna / hanya nama orang/toko? → `TIDAK_LAYAK` (`TIDAK_BERMAKNA` / `NAMA_ORANG`).
2. Masuk daftar `TERLARANG_SENSITIF`? → `TIDAK_LAYAK`.
3. Ada sinyal **grosir** (`grosir`, `agen`, `distributor`, `pengepul`, `supplier`, `pemasok`, `partai besar`)? → **LAYAK**, kategori mengikuti barangnya (pengepul kopi → `BB-01`; agen sembako → `PR-11`; pengepul rongsok → `BB-09`). Lanjut ke 6.
4. Ada sinyal **eceran/personal** (`warung`, `toko`, `kios`, `jual` + barang konsumsi harian, `keliling`, `kedai`, `cafe`, `rumah makan`, daftar §4) **dan tidak** ada sinyal produksi (`produksi`, `pembuatan`, `olahan`, `home industri`, `pabrik`, `pengrajin`, `katering`)? → `TIDAK_LAYAK` (`ECERAN`/`JASA_PERSONAL`).
5. Frasa ambigu (komoditas polos: "kopi", "ikan", "ayam", "kayu", "pisang", "beras", "kue")? → putuskan dengan `kbli2` (§8). Tetap ambigu → `TIDAK_JELAS`.
6. Tentukan Jenis (§1.1) → Kategori (§3, cek kolom "Bukan") → Spesifik (§5) → Keyakinan (§6).
7. Tidak ada kategori cocok padahal jelas & B2B → `KATEGORI_BELUM_ADA`.

---

## 8. Penentuan dengan `kbli2` untuk frasa ambigu

| kbli2 | Golongan | Arah keputusan |
|---|---|---|
| 01 | Pertanian, peternakan, perburuan | `BB-01`/`BB-02`/`BB-03`/`BB-04`/`BB-10` sesuai komoditas |
| 02 | Kehutanan | `BB-06` |
| 03 | Perikanan | `BB-05` |
| 08 | Penggalian | `BB-08` |
| 10 | Industri makanan | `PR-01` atau `BB-07` (tepung/gula aren/beras giling/minyak curah) |
| 11 | Industri minuman | `PR-02` |
| 13, 14 | Tekstil, pakaian jadi | `PR-03` (atau `JS-02` bila jelas jasa jahit) |
| 16 | Kayu & barang dari kayu/anyaman | `PR-05` / `PR-04` / `BB-06` |
| 20 | Kimia | `PR-08` |
| 23 | Barang galian bukan logam | `PR-06` |
| 25, 28 | Barang logam, mesin | `PR-07` |
| 31 | Furnitur | `PR-05` |
| 32 | Pengolahan lainnya | `PR-04` |
| 33, 45, 95 | Reparasi | `JS-06` |
| 38 | Pengumpulan/daur ulang limbah | `BB-09` |
| 41–43 | Konstruksi | `JS-07` |
| 46 | Perdagangan besar | grosir → kategori barang (lihat langkah 3 §7) |
| 47 | Perdagangan eceran | komoditas polos → `ECERAN` (frasa produksi yang jelas tetap menang) |
| 49–53 | Angkutan & pergudangan | `JS-03` |
| 56 | Penyediaan makan minum | komoditas polos → `ECERAN`; katering/nasi kotak → `JS-01` |
| 18 | Percetakan | `JS-05` |
| 77 | Sewa | `JS-03` (kendaraan) / `JS-08` (tenda, sound) / `JS-09` (alat pertanian) |
| 81 | Kebersihan & lanskap | `JS-04` |
| 85 | Pendidikan | `JS-10` atau `JASA_PERSONAL` (bimbel anak) |
| 96 | Jasa perorangan lainnya | biasanya `JASA_PERSONAL`; laundry → `JS-04` |
| lainnya / kosong | — | putuskan dari frasa saja; tak bisa → `TIDAK_JELAS` |

---

## 9. Kasus sulit (acuan wajib)

| frasa | kbli2 | Hasil |
|---|---|---|
| biji kopi | 01 | LAYAK · BAHAN_BAKU · BB-01 · Biji Kopi · TINGGI |
| kopi | 01 | LAYAK · BAHAN_BAKU · BB-01 · Biji Kopi · SEDANG |
| kopi | 10 / 11 | LAYAK · PRODUK · PR-02 · Kopi Bubuk · SEDANG |
| kopi | 56 | TIDAK_LAYAK · ECERAN (kedai) |
| kopi bubuk robusta | apa pun | LAYAK · PRODUK · PR-02 · Kopi Robusta · TINGGI |
| kedai kopi | apa pun | TIDAK_LAYAK · ECERAN |
| pengepul kopi | 46 | LAYAK · BAHAN_BAKU · BB-01 · Biji Kopi · TINGGI |
| usaha bakso | 56 / 47 | TIDAK_LAYAK · ECERAN |
| produksi bakso | 10 | LAYAK · PRODUK · PR-01 · Bakso · TINGGI |
| bakso frozen | apa pun | LAYAK · PRODUK · PR-01 · Bakso Beku · TINGGI |
| keripik pisang | 47 | LAYAK · PRODUK · PR-01 · Keripik Pisang · SEDANG (frasa produksi menang) |
| jual keripik | 47 | TIDAK_LAYAK · ECERAN |
| catering | 56 | LAYAK · JASA · JS-01 · Katering · TINGGI |
| catering, nasi bakar, tekwan, soto | 56 | LAYAK · JASA · JS-01 · Katering · TINGGI |
| rumah makan padang | 56 | TIDAK_LAYAK · ECERAN |
| warung makan & terima pesanan nasi kotak | 56 | LAYAK · JASA · JS-01 · Nasi Kotak · SEDANG |
| ikan | 03 | LAYAK · BAHAN_BAKU · BB-05 · Ikan Segar · SEDANG |
| ikan | 47 | TIDAK_LAYAK · ECERAN |
| budidaya lele | apa pun | LAYAK · BAHAN_BAKU · BB-05 · Ikan Lele · TINGGI |
| kerupuk ikan | apa pun | LAYAK · PRODUK · PR-01 · Kerupuk Ikan · TINGGI |
| ternak ayam | 01 | LAYAK · BAHAN_BAKU · BB-04 · Ayam Hidup · TINGGI |
| ayam | 56 | TIDAK_LAYAK · ECERAN (ayam goreng/geprek) |
| singkong | 01 | LAYAK · BAHAN_BAKU · BB-02 · Singkong · TINGGI |
| tepung tapioka | apa pun | LAYAK · BAHAN_BAKU · BB-07 · Tepung Tapioka · TINGGI |
| gula merah / gula aren | apa pun | LAYAK · BAHAN_BAKU · BB-07 · Gula Aren · TINGGI |
| penggilingan padi | apa pun | LAYAK · BAHAN_BAKU · BB-07 · Beras · SEDANG |
| sembako | 47 | TIDAK_LAYAK · ECERAN |
| grosir sembako | 46 | LAYAK · PRODUK · PR-11 · Sembako · TINGGI |
| pangkalan gas | apa pun | LAYAK · PRODUK · PR-11 · Gas LPG · SEDANG |
| tapis / kain tapis | apa pun | LAYAK · PRODUK · PR-03 · Kain Tapis · TINGGI |
| jahit | 14 / 96 | LAYAK · JASA · JS-02 · Jahit Pakaian · SEDANG |
| konveksi | 14 | LAYAK · PRODUK · PR-03 · Konveksi · TINGGI |
| permak jeans | apa pun | TIDAK_LAYAK · JASA_PERSONAL |
| las | 25 / 33 | LAYAK · JASA · JS-06 · Las · TINGGI |
| pembuatan teralis | 25 | LAYAK · PRODUK · PR-07 · Teralis Besi · TINGGI |
| bengkel motor | 45 | LAYAK · JASA · JS-06 · Bengkel Motor · SEDANG |
| tambal ban | apa pun | TIDAK_LAYAK · JASA_PERSONAL |
| batu bata | apa pun | LAYAK · PRODUK · PR-06 · Batu Bata · TINGGI |
| toko bangunan | 47 | TIDAK_LAYAK · ECERAN |
| mebel | 31 | LAYAK · PRODUK · PR-05 · Mebel Kayu · TINGGI |
| kayu | 02 / 16 | LAYAK · BAHAN_BAKU · BB-06 · Kayu Olahan · SEDANG |
| rongsok / barang bekas | apa pun | LAYAK · BAHAN_BAKU · BB-09 · Barang Bekas · TINGGI |
| laundry | 96 | LAYAK · JASA · JS-04 · Laundry · SEDANG |
| fotokopi | 82 / 47 | TIDAK_LAYAK · ECERAN |
| fotokopi & percetakan | apa pun | LAYAK · JASA · JS-05 · Percetakan · SEDANG |
| sewa tenda | 77 | LAYAK · JASA · JS-08 · Sewa Tenda · TINGGI |
| salon | apa pun | TIDAK_LAYAK · JASA_PERSONAL |
| konter pulsa | apa pun | TIDAK_LAYAK · ECERAN |
| pertanian | 01 | TIDAK_JELAS · komoditas tidak disebut |
| petani | 01 | TIDAK_JELAS · komoditas tidak disebut |
| dagang | apa pun | TIDAK_LAYAK · TIDAK_BERMAKNA |
| hastuti | apa pun | TIDAK_LAYAK · NAMA_ORANG |
| toko berkah jaya | 47 | TIDAK_LAYAK · NAMA_ORANG |
| tuak | apa pun | TIDAK_LAYAK · TERLARANG_SENSITIF |
| lilin aromaterapi | 20 | KATEGORI_BELUM_ADA · PRODUK · Lilin Aromaterapi · usulan "Lilin & Pewangi" |

---

## 10. Protokol eksekusi model pelabel

1. **Awal sesi:** baca dokumen ini utuh. Jangan mengandalkan ingatan sesi lain.
2. **Kalibrasi:** batch **pertama** (200 frasa teratas) wajib diaudit (Opus/manusia) sebelum batch lain dijalankan. Bila ada kesalahan pola → perbaiki dokumen ini (naikkan versi) → ulang batch pertama.
3. **Per batch:** 200 baris; keluarkan **hanya** CSV §6. Satu batch = satu file `label_batch_NNN.csv`.
4. **Jangan** melihat atau mengubah batch lain; konsistensi dijaga dokumen ini, bukan ingatan.
5. **Validasi skrip** (otomatis, batch ditolak & diulang bila gagal):
   - header & jumlah kolom tepat; setiap `id` masukan muncul **tepat sekali**, urutan sama;
   - nilai `status`, `jenis`, `keyakinan`, kode alasan ∈ enum;
   - `kategori` ∈ §3 **dan** prefiks cocok dengan `jenis`;
   - `spesifik` 1–3 kata, hanya huruf/angka/spasi/`&`, Title Case, tidak mengandung kata terlarang (`usaha`, `jual`, `produksi`, `aneka`, `toko`, `warung`);
   - kolom kosong/terisi sesuai tabel §6.
6. **Cek konsistensi lintas batch** (skrip): frasa sama dengan `kbli2` berbeda yang hasilnya bertentangan tanpa alasan §8 → masuk daftar tinjau.
7. **Konsolidasi Spesifik** (§5, satu pass) setelah semua batch.
8. **Audit akhir:** 200 sampel acak **berbobot jumlah UMKM** dari status `LAYAK`, diperiksa Opus. **Ambang lulus: kesalahan ≤5%** (salah Jenis/Kategori, atau eceran lolos sebagai LAYAK). Gagal → perbaiki aturan, labeli ulang frasa terdampak.
9. **Yang tampil publik:** hanya `LAYAK` (keyakinan `TINGGI`/`SEDANG`). `TIDAK_JELAS` & `KATEGORI_BELUM_ADA` → antrean petugas; `KATEGORI_BELUM_ADA` yang sering muncul → kandidat kategori baru di versi taksonomi berikutnya (keputusan admin).

## 11. Versi & perubahan

- Setiap perubahan taksonomi/aturan menaikkan versi (v1 → v2) dan dicatat di bawah. Kamus menyimpan versi saat frasa dilabeli; perubahan kategori → hanya frasa terdampak yang dilabeli ulang.
- v1 (2026-10-08): disusun dari pengetahuan domain UMKM Lampung **tanpa** statistik data penuh. **Wajib ditinjau di langkah E2** setelah daftar frasa terbanyak tersedia.
