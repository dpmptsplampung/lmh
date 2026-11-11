# Bukti 01: struktur halaman, query Supabase, rekap, UMKM, free tier

Dikumpulkan 2026-11-11 (read-only, analisis statis). Jumlah baris = `wc -l` pada berkas tracked git; berkas `*.test.*` dan `src/test/` tidak dihitung. Heuristik regex di bagian 3 dapat meleset (rantai query > 12 baris, `.limit` di helper); anggap "perlu dicek" bila dipakai sebagai dasar keputusan.

**Koreksi peta kode:** `CLAUDE.md` masih menyebut `admin/umkm` (~1000 baris) dan `umkm` (~900 baris). Keduanya sudah TIDAK ADA (commit `7929cab` "hapus marketplace UMKM lama"). Pengganti: `src/app/umkm/katalog/*` (halaman tipis 10-11 baris, isi di komponen), `src/app/me/umkm`, `src/app/admin/umkm-{tugas,laporan,pengawasan}` (halaman tipis, isi di `src/components/admin/umkm-*`). Total berkas `*umkm*` di src: ~6.900 baris (termasuk test).

## 1. Inventaris ukuran (30 terbesar, bukan test)

Dari 64 `page.tsx`, 46 diawali `'use client'`; 18 server component (tipis/statis: `admin/fo/daftar`, `admin/scan`, `umkm/katalog*`, `me/umkm`, `me/usaha*`, `admin/umkm-*`, `standar-pelayanan`, dst.). Beranda `/` (`src/app/page.tsx`, 304 baris) juga `'use client'`.

| # | Berkas | Baris | page.tsx client? |
|---|---|---|---|
| 1 | src/app/admin/antrian/page.tsx | 1375 | ya |
| 2 | src/app/chat/page.tsx | 1353 | ya |
| 3 | src/components/admin/PelayananWizardModal.tsx | 1063 | (komponen) |
| 4 | src/app/admin/chat/page.tsx | 861 | ya |
| 5 | src/app/admin/chat/faq/page.tsx | 792 | ya |
| 6 | src/app/me/reservasi/page.tsx | 723 | ya |
| 7 | src/components/fo/WalkinPanel.tsx | 688 | - |
| 8 | src/app/admin/settings/jadwal/page.tsx | 633 | ya |
| 9 | src/app/admin/petugas/page.tsx | 622 | ya |
| 10 | src/app/api/admin/pelayanan/[tiketId]/route.ts | 617 | - (route) |
| 11 | src/app/gallery/page.tsx | 600 | ya |
| 12 | src/app/admin/kunjungan/page.tsx | 597 | ya |
| 13 | src/components/fo/ScanPanel.tsx | 582 | - |
| 14 | src/app/admin/profil/page.tsx | 581 | ya |
| 15 | src/app/admin/fo/penanganan/page.tsx | 568 | ya |
| 16 | src/lib/fo/walkin.ts | 562 | - |
| 17 | src/app/admin/page.tsx | 561 | ya |
| 18 | src/app/admin/gallery/page.tsx | 543 | ya |
| 19 | src/app/admin/absensi/page.tsx | 526 | ya |
| 20 | src/components/ProfileCompletenessGate.tsx | 477 | - |
| 21 | src/components/layout/Sidebar.tsx | 453 | - |
| 22 | src/components/admin/ChatAksiDialog.tsx | 440 | - |
| 23 | src/app/admin/saran/page.tsx | 438 | ya |
| 24 | src/lib/survei/export.ts | 436 | - |
| 25 | src/app/admin/rekap/page.tsx | 436 | ya |
| 26 | src/app/me/page.tsx | 424 | ya |
| 27 | src/app/admin/settings/ai/page.tsx | 422 | ya |
| 28 | src/components/admin/AbsensiWizardModal.tsx | 404 | - |
| 29 | src/app/api/chat/ai/route.ts | 401 | - (route) |
| 30 | src/app/admin/layanan/page.tsx | 398 | ya |

Komponen UMKM terbesar (baru): `components/admin/umkm-tugas/TugasUmkm.tsx` 292, `lib/umkm-katalog/wilayah.ts` 269, `DetailPermintaan.tsx` 234, `umkm-katalog/Katalog.tsx` 227. Tidak ada berkas UMKM > 300 baris.

## 2. Peta isi 8 halaman terbesar (rentang baris)

Pola umum: satu komponen client raksasa berisi state + query Supabase langsung dari browser + handler + JSX. Tidak ada hook/util per halaman kecuali yang tertulis.

### 2.1 admin/umkm (sekarang `admin/umkm-tugas` + `TugasUmkm.tsx`, 292 baris)
- `src/app/admin/umkm-tugas/page.tsx` server component tipis, isi di `components/admin/umkm-tugas/TugasUmkm.tsx`.
- TugasUmkm.tsx:33-43 state (list, query, detail, permintaan, klaim, work, mode 8 nilai, loading, error, notice); :67 satu `useEffect`; sisanya render per `mode` ke `DetailTugas` (186), `DetailPermintaan` (234), `DetailKlaim` (110), `DetailPekerjaan` (104), `BantuPermintaan` (158), `ProfilForm` (140), `NomorTugas` (62), `PemilikTerdaftar` (75).
- Data: tidak ada query Supabase di client; semua lewat `/api/admin/umkm-tugas/*` ke RPC `umkm_daftar_tugas(p_cursor)` (keyset, LIMIT 21 per sumber; `supabase/migrations/202611090011_umkm_pemilik_integrasi.sql:241-293`). Sudah terpecah baik.

### 2.2 chat (`src/app/chat/page.tsx`, 1353 baris)
| Blok | Baris |
|---|---|
| util `urutkanFaq`, `subscribeOnline` | 78-121 |
| `PublicChatPage` + 34 `useState` (tersebar sampai :872), ref | 122-200 |
| effect FAQ + `fetchFAQs` (`faq_knowledge_base` :277) | 203-297 |
| effect layanan (`v_layanan_publik` :304), `cariLayananUrl` | 298-356 |
| `ambilDaftar` (`chat_sesi` :379 / RPC `chat_percakapan_saya`), `muatRiwayatAwal`, `bukaPercakapan` | 366-437 |
| effect URL/percakapan, polling status 60 dtk (:502, `STATUS_REFRESH_MS`) | 438-511 |
| `syncMessages` + Realtime channel `chat-sesi-<id>` (2 binding `postgres_changes`, :541-575) | 512-578 |
| `muatRiwayatLebihLama`, `buatSesi`, `mulaiSesi` (insert `consent_log` :682) | 589-728 |
| `postPesan`, `askAI` (fetch `/api/chat/ai`, timeout 65 dtk), `kirimFoto`, `handleRetry`, `handleEscalateManual` | 740-927 |
| `masukDenganGoogle` | 936-947 |
| JSX `return` (form :1050) | 948-1353 |
Pendamping: `DaftarPercakapan.tsx`, `merge.ts` (setInterval :130).

### 2.3 umkm publik (sekarang `components/umkm-katalog/Katalog.tsx`, 227 baris)
- `src/app/umkm/katalog/page.tsx` server tipis (metadata), isi di `Katalog.tsx`.
- Katalog.tsx: state 12 (:23-37); `load` (:39-65, fetch `/api/umkm-katalog?...`, `AbortController`, retry sekali bila `SNAPSHOT_BERUBAH`); effect opsi filter `/api/umkm-katalog/filter` (:67-74); effect muat (:75-79); JSX sampul+pencarian (:99-119), panel filter (:122-153), hasil/kerangka/kosong/kartu/paginasi cursor (:155-212), `FormulirKatalog` (:216).
- Tidak ada query Supabase langsung dari browser; memakai API publik ber-cache sebagian (lihat 4B).

### 2.4 admin/antrian (`src/app/admin/antrian/page.tsx`, 1375 baris)
| Blok | Baris |
|---|---|
| `AntrianPage`/`AntrianMemuat` pembungkus | 176-219 |
| `AntrianIsi` + 35 `useState`/ref | 220-292 |
| effect URL, `useRealtimeRefetch(tiket_antrean, poll 30 dtk)` | 294-303 |
| `fetchData` (profil sekali; `muatAntreanFo`; `tiket_antrean` :404/:435/:455/:473; `penanganan` :528) | 308-519 |
| `muatCatatanEskalasi`, `muatStatusSurvei` | 520-562 |
| aksi: panggil (:576, RPC `panggil_tiket`), `jalankanAksi`, mulai (:633), selesaikan (:656, RPC `layanan_selesai`) | 564-681 |
| resolver/label/turunan, `fetchRekapAbsensi` (:731 `absensi_petugas`), CSV absen | 682-812 |
| turunan panel "sekarang/berikutnya" | 813-845 |
| `renderNama/Status/Aksi` (kolom tabel ~265 baris) | 846-1110 |
| JSX: header, filter, `Tabel` (:1244, :1289), 7 modal (:1312-1371: AmbilAlih, Alihkan, KembalikanKeFo, SelesaiEskalasi, KoreksiPelayanan, PelayananWizard, SurveiQr) | 1133-1375 |
Anak yang sudah ada: `PanelSekarang.tsx`, `antrianUrl.ts`.

### 2.5 admin/rekap (`src/app/admin/rekap/page.tsx`, 436 baris + `TabelDataPelayanan.tsx` 146)
- 51-79 konstanta tab/kolom (`BAGIAN`, `KOLOM_HARIAN`, `KOLOM_KINERJA`, `UKURAN_HALAMAN = 50`); 89-93 `ambilJson`; 95 `RekapTerpadu`; 100-122 state (16); 127-160 `useMemo` opsi/params; 175-190 effect `?bagian=lingkup`; 192-229 `muat` (satu fetch per tab/halaman/filter, penjaga `permintaanTerakhir`); 231-285 `unduh` (fetch export); 287-428 JSX (`Tabel` :368 harian, `TabelDataPelayanan` :400, `Tabel` :413 kinerja); 430 pembungkus `Suspense`.
- Tidak ada query Supabase di client; semua lewat `/api/admin/rekap/terpadu`. Halaman sendiri sudah ramping; beban ada di server/DB (4A).

### 2.6 admin/chat (`src/app/admin/chat/page.tsx`, 861 baris)
State 30 (:109-582 tersebar); ref :142-153; `handleGenerateDraft` (:195, fetch `/api/chat/ai/draft`); `muatKontak` (:223); `fetchSessions` (:236-293; `chat_sesi` :225, `penanganan` :247); Realtime `chat-admin` (:297-393; `chat_sesi` event `*` + `chat_pesan` INSERT); `loadMessages` (:405), `muatRiwayatLebihLama` (:424); turunan izin (:484-508); aksi (:529-580); `kirimFoto` (:583), `handleSendMessage` (:604); daftar (:645-655); JSX `return` :656-861 dengan 3 dialog (:826 AmbilAlih, :836 Teruskan, :848 Selesai). Query tambahan: `topik_penanganan` :320, `layanan` :334, `petugas` :335.

### 2.7 admin/chat/faq (`src/app/admin/chat/faq/page.tsx`, 792 baris)
`muatBertahap` (:44, pemuat halaman-halaman); state 26 (:77-123); role/akses turunan (:87-131); effect prefill (:133), layanan (:142-174, `layanan` :148), role/`petugas` (:183-217, :196), daftar FAQ (:227-264, `faq_knowledge_base` :236/:241); `prosesFaq` (:273, `/api/admin/faq/embed`), `handleToggleBot` (:329), `handleToggleAktif` (:349), `simpanFaq` (:369-431), `hapusFaq` (:432-458); paginasi klien `tampil.slice` (:459-460); JSX `return` :473-792 (FaqFormDialog :771, HapusFaqDialog :784).

### 2.8 me/reservasi (723 baris) dan dua halaman besar berikutnya
- me/reservasi: state 19 (:56-84); `muatDaftar` (:95), `muatLayananOpsi` (:112, `v_layanan_publik` :116), effect :131-182 (`v_antrian_loket` :168, `hari_libur` :219, RPC `is_layanan_buka_jadwal` :232), `handleSubmit` (:183-309, `consent_log` :274), `batalkan` (:310), JSX :358-723 (form :409).
- admin/settings/jadwal (633): helper murni :60-102; state :135-163; `loadJadwal` :168, `loadLibur` :199, `muatDaftar` :223; `handleSaveJadwal` :302-346; libur :347-435; JSX :436-633 (2 `Tabel`, 1 form).
- admin/petugas (622): helper `kelompokkan` :55-72, `api` :79-92; state :101-122; `load` :124 (fetch `/api/admin/petugas`); aksi :167-271; kolom :281-362; JSX :366-622 dengan 8 `AkunDialog` (:456-598).

## 3. Query Supabase ganda dan pola berisiko

Metode: regex `.from('x')` / `.rpc('x')` pada semua `.ts/.tsx` non-test di `src/`. 144 nama unik; 47 muncul di >= 2 berkas. Mayoritas query tabel dijalankan dari browser (`lib/supabase/client`) di halaman client.

### 3.1 Dipakai >= 2 berkas (ringkas)
| Tabel/RPC | # berkas | Contoh file:baris (dalam src/app kecuali tertulis lain) |
|---|---|---|
| petugas | 52 | admin/absensi:89, admin/antrian:330, admin/chat:335, admin/fo/kotak-masuk:137, api/admin/petugas:20/25/33, api/admin/riwayat:57/58 |
| layanan | 31 | admin/chat/faq:148/337, admin/chat:334, admin/dokumen:65, admin/fo/penanganan:205, admin/topik:76, api/admin/rekap/terpadu:46, api/admin/rekap/performa:43, pengaduan:34, standar-pelayanan:35, transparansi:40 |
| pengunjung | 12 | admin/data-governance:116, api/chat/ai:175, api/chat/messages:85, auth/callback:54 |
| kunjungan | 9 | admin/kunjungan:264, admin/page:151/188/211, me/page:143, me/_cangkang/useDataPengunjung:110 |
| chat_sesi | 9 | admin/chat:225, api/chat/ai:68/96/105/185, api/chat/ai/draft:65, lib/hooks/useNavBadges:93 |
| penanganan | 7 | admin/antrian:528, admin/chat:247, admin/fo/kotak-masuk:97/116/121, admin/fo/penanganan:156/166, lib/hooks/useNavBadges:75/95/104 |
| audit_log | 7 | admin/data-governance:73/77/81/124, api/admin/rekap/terpadu/export:70, api/admin/riwayat:29 |
| tiket_antrean | 5 | admin/antrian:404/435/455/473, admin/fo/penanganan:187, admin/page:158/175/231, lib/hooks/useNavBadges:113/119 |
| investment_documents | 6 | admin/gallery:90/116/171/310, gallery:64, api/investasi/lead:43, api/investment-docs/[id]:33 |
| chat_pesan | 6 | api/chat/ai:79, api/chat/ai/draft:86, api/chat/messages:194, lib/chat/riwayat:30 |
| hari_libur | 6 | admin/settings/jadwal:206/365/409, me/reservasi:219, components/EstimasiAntrean:72, components/admin/CalendarBanner:19, lib/chat/hari-tanpa-layanan:47, lib/llm/bot:72 |
| site_settings | 5 | admin/layar:144/216, admin/settings:37/78, lib/chat/hari-tanpa-layanan:66, lib/llm/bot:67, lib/site-settings:35 |
| topik_penanganan | 4 | admin/chat:320, admin/fo/penanganan:198, admin/topik:75/138, components/admin/TopikCatatanFields:33 |
| faq_knowledge_base | 4 | admin/chat/faq:236/241/356/387, chat:277 |
| v_layanan_publik | 4 | chat:304, me/page:157, me/reservasi:116, lib/homepage/data:146 |
| consent_log | 4 | admin/data-governance:96, chat:682, me/reservasi:274, components/ProfileCompletenessGate:164 |
| v_antrian_loket | 3 | me/reservasi:168, components/EstimasiAntrean:56 (`select('*')`), lib/homepage/data:197 |
| saran | 3 | admin/pesan-perilaku/cetak:88, admin/saran:151/164/249, lib/hooks/useNavBadges:130 |
| pengaduan | 3 | api/admin/pengaduan:138/174/185, api/admin/pengaduan/[id]/lampiran:44, useNavBadges:124 |
| push_subscriptions | 3 | api/notif/retry:86, api/notif/send:82, me/notifications:68/128/175 |
| absensi_petugas | 3 | admin/absensi:104, admin/antrian:737, lib/hooks/useSesiKerja:86 |
| rpc layanan_selesai | 3 | admin/antrian:671, api/admin/pelayanan/[tiketId]:516, components/admin/SelesaiEskalasiModal:87 |
| rpc chat_minta_petugas | 3 | api/chat/ai:236, api/chat/messages:351, api/chat/petugas:55 |
| rpc akun_akhiri_sesi | 3 | api/admin/petugas/[id]/reset-password:47, api/admin/petugas/[id]:176, api/admin/petugas/status:34 |
| rpc rekap_data_pelayanan | 2 | api/admin/rekap/terpadu:77, lib/rekap/terpaduServer:83 |

Duplikasi bermakna: (a) daftar `layanan`, `petugas`, `topik_penanganan` untuk dropdown dimuat ulang sebagai query terpisah di >= 6 halaman admin; (b) `useNavBadges` (sidebar) menghitung `penanganan`/`tiket_antrean`/`chat_sesi` yang juga dihitung `admin/antrian`, `admin/page`, `admin/kunjungan` (masing-masing di-poll sendiri); (c) status jadwal dihitung di beberapa jalur (`hari_libur`, `jadwal_standby`, RPC `is_layanan_buka_jadwal`, `layanan_status_hari_ini`).

### 3.2 `select('*')` (non-head), 5 lokasi
admin/gallery/page.tsx:90 (`investment_documents`); api/admin/pelayanan/[tiketId]/route.ts:203 (`pelayanan_oss`) dan :214 (`pelayanan_perizinan`); app/layar/[token]/page.tsx:135 (`v_layar_antrian`, di-poll tiap layar TV); components/EstimasiAntrean.tsx:56 (`v_antrian_loket`, publik).

### 3.3 `.select()` tanpa `.limit/.range/.single/head` dalam jendela 12 baris (heuristik): 108 lokasi
Mayoritas tabel referensi kecil (`layanan`, `petugas`, `hari_libur`, `topik_penanganan`). Yang dapat tumbuh tak terbatas (perlu dicek filter di luar jendela):
- admin/antrian/page.tsx:404,435,455,473 (`tiket_antrean`; sebagian memakai `.range` di baris lain), :528 (`penanganan`), :737 (`absensi_petugas`)
- admin/kunjungan/page.tsx:189 (`penanganan`); admin/page.tsx:175,231 (`tiket_antrean`), :211 (`kunjungan`)
- admin/fo/kotak-masuk:97,116,121; admin/fo/penanganan:156,166,187
- admin/chat/ai-log:53 (`chat_ai_log`); admin/chat/faq:236,241 (`faq_knowledge_base`, dimuat bertahap lewat `muatBertahap` :44); admin/data-governance:96 (`consent_log`); admin/investasi-leads:74; admin/gallery:90
- api/chat/messages/route.ts:194 (`chat_pesan`); lib/chat/riwayat.ts:30; chat/page.tsx:379 (`chat_sesi`); gallery/page.tsx:64
- api/notif/send:82, api/notif/retry:86 (`push_subscriptions`, seluruh baris)
- Batas `max-rows` PostgREST tidak terverifikasi statis; `lib/rekap/exportAll.ts:12-17` mendokumentasikan kasus pemotongan diam-diam.

### 3.4 Waterfall / berurutan yang bisa paralel
- admin/antrian/page.tsx:308-519 `fetchData`: berurutan `auth.getUser` (:327, hanya sekali) -> `petugas` (:329) -> `muatKoordinator` (:340) -> `muatAntreanFo` (:367, loop :375 halaman 200) -> query utama (:425) -> query panel (:442) -> stats (:464) -> total harian (:475) -> `Promise.all` catatan+survei (:493). Setelah profil termuat, tiap refresh (Realtime atau poll 30 dtk) = 4 await berurutan + 1 paralel; stats/total tidak bergantung pada hasil query utama.
- app/page.tsx (beranda, client): `getUser` (:90) lalu `petugas` (:92) berurutan; `Promise.all` blok+layanan+status (:110-113) lalu `getSiteSettings` (:119) sesudahnya. `muatLayanan` (`lib/homepage/data.ts:138-156`) mencoba beberapa "tingkat" select berurutan bila kolom belum ada.
- api/admin/rekap/terpadu: 4-7 panggilan DB berurutan per request (4A).
- api/admin/rekap/performa/route.ts:30-48: `fetchAllPages` penuh (`penanganan` rentang) lalu `petugas`+`layanan` paralel lalu agregasi di JS (`hitungPerforma`).
- lib/rekap/terpaduServer.ts:82-93 `ambilSemuaDataPelayanan`: loop berurutan per 1000 baris, sampai 50 RPC pada ekspor 50.000 baris. lib/rekap/khususServer.ts:80-90: blok 4 paralel per 500 id (sudah paralel).

### 3.5 Fetch client yang bisa menjadi server component
Data publik/semi-statis dibaca dari browser: `app/page.tsx` + `lib/homepage/data.ts` (`v_layanan_publik`, `homepage_blok`, RPC `layanan_status_hari_ini`, `site_settings`), `transparansi:40`, `pengaduan:34`, `gallery/page.tsx:64`, `chat/page.tsx:277,304` (FAQ + layanan), `me/page.tsx:157`, `me/reservasi/page.tsx:116`. Halaman `admin/*` bergantung pada sesi + Realtime di client (bukan kandidat langsung).
Di seluruh `src` hanya `lib/umkm-katalog/publik-server.ts` dan `foto-server.ts` memakai `unstable_cache`/`revalidateTag`; tidak ada `export const revalidate` atau `use cache` di halaman mana pun.

## 4. Area lambat

### 4A. Rekap (admin/rekap + lib/rekap + api/admin/rekap)
Alur untuk tab "Data Pelayanan" (juga Helpdesk OSS / Non OSS), per muat/ganti halaman/filter:
1. Browser: `fetch /api/admin/rekap/terpadu?bagian=data&page=N&page_size=50...` (`page.tsx:192-229`). Tanpa cache klien; pindah tab = fetch ulang. Sekali di awal: `?bagian=lingkup` (:175-190).
2. Vercel function `api/admin/rekap/terpadu/route.ts:27` (`force-dynamic`), berurutan:
   - `auth.getUser()` (round-trip ke Supabase Auth; `terpaduServer.ts:38`), sesudah `proxy.ts` sudah merefresh sesi untuk `/admin*`.
   - RPC `lingkup_data_saya` (`terpaduServer.ts:40`).
   - RPC `rekap_ringkasan_dilayani` (`lib/rekap/ringkasan.ts:16`).
   - RPC `rekap_data_pelayanan` dengan `p_hitung: true` (`route.ts:77`).
   - Bila Layanan terpilih: `layanan.select(form_pendataan)` (`terpaduServer.ts:99`), `pendataan_khusus_field` (`khususServer.ts:56`), RPC `pendataan_khusus_peta` per 500 id.
   = minimal 4 round-trip DB berurutan (5-7 dengan Layanan terpilih) + 1 ke Auth.
3. Di DB, `rekap_pelayanan_inti` (versi terakhir `supabase/migrations/202611040001_perbaikan_tinjauan_akhir.sql:559-654`) = fungsi plpgsql `RETURN QUERY ... UNION ALL` (hasil dimaterialisasi per panggilan; predikat pemanggil tidak bisa di-push-down). Pemanggil:
   - `rekap_data_pelayanan` (`202611010005_rekap_data_tanpa_form.sql:36-119`) memanggilnya DUA kali bila `p_hitung` (COUNT dan halaman),
   - `rekap_ringkasan_dilayani` (`202611040001:665-730`) memakai CTE sendiri atas `penanganan JOIN kunjungan` + `tiket_antrean` + oss + perizinan (terpisah dari inti, kerja serupa),
   - `rekap_harian_terpadu` dan `rekap_kinerja_petugas` masing-masing sekali (`202610290002_rekap_terpadu.sql:238,287`).
   Satu muat tab Data = rentang tanggal (<= 366 hari) dihitung ~3x di DB sebelum `LIMIT 50`; kerja DB skala dengan total baris rentang, bukan 50. `staf_lingkup()` dipanggil di tiap fungsi.
   - Detail halaman: subquery terkorelasi `fo_nama` per baris ke `penanganan` (`202611010005:~79-87`, terlayani UNIQUE `(kunjungan_id,tahap_ke)`), `to_jsonb(o)`/`to_jsonb(pz)` seluruh baris pendataan per baris.
4. Indeks (dari migrasi): `kunjungan(tanggal DESC)` (`202607290013:40`), `kunjungan(status,tanggal)` (`202610140003:298`); `penanganan`: `(penangan_id, mulai_at DESC)`, `(layanan_id,status)`, `(tiket_id) WHERE tiket_id IS NOT NULL`, `(peran_tahap, mulai_at)`, UNIQUE `(kunjungan_id,tahap_ke)` (`202610140003:501,540-543`); `tiket_antrean(layanan_id,tanggal,status)`, `(kunjungan_id)` (`202607290013:65-66`). Filter inti `p.status='selesai' AND k.tanggal BETWEEN` lewat JOIN `kunjungan`; tidak ada indeks `penanganan(status)` atau `tiket_antrean(status,tanggal)`; cabang B memakai `COALESCE(k.tanggal,t.tanggal)` (non-sargable).
5. Payload: halaman data 50 baris, tiap baris memuat identitas + `pendataan` jsonb (formulir OSS/Perizinan penuh); perkiraan kasar 1-3 KB/baris, jadi 50-150 KB/respons (perkiraan, belum diukur). Harian/Kinerja: satu jsonb agregat kecil. Tidak ada `Cache-Control` pada JSON (hanya `no-store` di ekspor).
6. Paginasi: ada. UI memakai OFFSET (`p_lewati`), yang tetap menghitung ulang inti penuh; keyset `p_setelah` hanya untuk ekspor.
7. Ekspor (`export/route.ts:26-91`): <= 50 RPC berurutan (tiap panggilan menghitung ulang inti), lalu ExcelJS (`excelTerpadu.ts:24-63`) membangun seluruh workbook di memori. Tanpa `maxDuration`.
8. Tab Performa (`api/admin/rekap/performa/route.ts`): agregasi di JS. `fetchAllPages` menarik semua baris `penanganan` rentang (halaman 1000, <= 50.000 baris) lalu `hitungPerforma` (`lib/rekap/performa.ts`, 169 baris) di Node. Kandidat agregasi SQL (RPC `rekap_kinerja_petugas` sudah ada untuk tab Kinerja).

### 4B. UMKM (katalog publik, pemilik, admin)
Alur katalog `/umkm/katalog`:
1. Halaman server tipis tanpa data; `Katalog.tsx` melakukan dua fetch paralel: `/api/umkm-katalog/filter` (:67) dan `/api/umkm-katalog?...` (:39). Setiap pindah halaman/filter/ketik = fetch baru (yang lama di-abort).
2. `api/umkm-katalog/route.ts:5` memanggil `layaniPublik` (`lib/umkm-katalog/publik-server.ts:32`): klien Supabase anon baru per panggilan (:16), RPC `umkm_cari_katalog` (1 round-trip, tanpa `auth.getUser`). Cache `unstable_cache` revalidate 60 dtk HANYA bila tanpa `q/jenis/kategori/spesifik/kabupaten_kota/cursor` (`route.ts:7-8`, `publik-server.ts:25-30,42-45`), plus `umkm_filter_katalog`. Pencarian dengan kata kunci/filter/cursor selalu ke DB. Fetch internal `cache: 'no-store'` (:18).
3. Bila halaman pertama kosong: panggilan tambahan `catatTanpaHasil` (RPC `umkm_catat_tanpa_hasil`, `statistik-server.ts`) di jalur respons (`route.ts:14-18`, termasuk `response.clone().json()`).
4. `umkm_cari_katalog` versi terakhir `supabase/migrations/202611100003_umkm_produk_baca.sql:52-` (plpgsql, banyak CTE `MATERIALIZED`):
   - CTE `cocok` menghitung SEMUA profil terbit yang cocok (join `umkm_profil` x `umkm_revisi`, LEFT JOIN `umkm_skor`, `md5(hari||id)` per baris, `EXISTS` ke `umkm_produk` dengan `ILIKE '%q%'`) pada setiap panggilan, termasuk halaman cursor; baru `LIMIT 21`. Biaya skala dengan jumlah profil terbit.
   - `ILIKE '%q%'` pada `r.spesifik`, `r.kategori`, `umkm_produk.nama`, `r.nama`, `r.deskripsi`; indeks GIN trigram hanya untuk `umkm_revisi.nama` dan `.deskripsi` (`202611090002_umkm_katalog.sql:65-66`); tidak ada untuk `spesifik`, `kategori`, `umkm_produk.nama` (hanya UNIQUE `(revisi_id,urutan)`); klausa OR lintas kolom jarang memakai satu indeks.
   - Tiap item halaman memanggil `umkm_private.kartu(id)` (`202611100003:23`) yang memanggil `foto_publik(revisi)` (agg `umkm_foto`) + `statistik_publik` (join `umkm_private.statistik`, `umkm_stat_total`): 3-4 subquery x <= 20 baris.
   - Indeks tersedia: `umkm_katalog_terbit (terbit_pada DESC,id DESC) WHERE status='terbit'`, `umkm_katalog_label (jenis,kategori,kabupaten_kota)` (`202611090002:56-57`), `umkm_profil_revisi_disetujui`.
   - `umkm_filter_katalog` (`202611090002:154`): tiga `SELECT DISTINCT` atas join profil-revisi terbit; di-cache 60 dtk.
5. Admin (`umkm-tugas`, `-laporan`, `-pengawasan`): `/api/admin/umkm-*` ke RPC ber-cursor (`umkm_daftar_tugas`, `umkm_cari_profil`, `umkm_jejak_pengawasan`, `umkm_cari_pengawasan`, `umkm_laporan_statistik`; 20 baris/halaman). `umkm_daftar_tugas` (`202611090011:241-293`) menjalankan beberapa CTE `MATERIALIZED` (profil, pesan, laporan, ...) tiap panggilan. `umkm_detail_tugas` mengembalikan `to_jsonb(revisi)`, produk, seluruh foto (metadata), izin dalam satu jsonb.
6. Foto lewat R2 (`lib/storage/*`, `foto-server.ts`); `api/umkm-katalog/bersihkan-draf` `maxDuration = 60`. Invalidasi: `invalidasiKatalog()` (`foto-server.ts`) memanggil `revalidateTag`, juga saat `SNAPSHOT_BERUBAH`.
7. Tidak ditemukan query tak terbatas dari browser untuk UMKM. Yang terbukti di kode: (a) pencarian berfilter tidak ter-cache + scan penuh `cocok`; (b) `catatTanpaHasil` sinkron; (c) klien Supabase baru per panggilan; (d) tidak ada header cache edge dari kode (belum diperiksa `headersPrivat` di `server.ts`).

## 5. Kendala free tier yang terbukti di kode

### Vercel Hobby (fungsi)
- `maxDuration` 60 dtk: `api/chat/ai` (:18), `api/chat/ai/draft` (:10), `api/admin/faq/embed` (:9), `api/admin/settings/bot/coba` (:12), `api/notif/send` (:12), `api/notif/retry` (:15), `api/umkm-katalog/bersihkan-draf` (:7). 5 dtk: `api/health/ready`. `vercel.json` = `{}` (tanpa cron; penjadwalan di pg_cron). Klien chat menunggu 65 dtk (`chat/page.tsx:90`).
- Tanpa `maxDuration` (default platform): `api/investment-docs/upload`, `api/investment-docs/page-image`, `api/admin/rekap/terpadu/export`, `api/admin/survei/export`, `api/admin/dokumen/embed`, `api/admin/rekap/performa`, `api/admin/umkm-laporan/export`.
- Dependensi native/berat di bundel: `canvas`, `sharp`, `pdfjs-dist`, `exceljs` (hanya dipakai `investment-docs/upload`, `investment-docs/page-image`, `lib/rekap/excelTerpadu.ts`, `lib/survei/export.ts`).

### Supabase free
- Realtime: `useRealtimeRefetch` membuka satu channel per kombinasi tabel dan tetap memolling cadangan. `Sidebar` -> `useNavBadges` (`penanganan, chat_sesi, tiket_antrean`, poll 30 dtk; `useNavBadges.ts:32,221`); `admin/antrian:301`, `admin/kunjungan:399`, `admin/page:328`, `admin/fo/kotak-masuk:176`, `admin/fo/penanganan:246` (masing-masing poll 30 dtk). Satu admin di dashboard + sidebar = >= 2 channel pada tabel yang sama + 2 timer poll.
- `useNavBadges` tiap tick (30 dtk dan tiap event Realtime, debounce 500 ms): hingga ~8 query count `head:true` (`useNavBadges.ts:75-130`) per sesi staf.
- Channel lain: `admin/chat` (`chat-admin`, `chat_sesi` event `*` + `chat_pesan` INSERT), `chat/page.tsx:546` (per sesi, 2 binding), `EstimasiAntrean.tsx:108`/`useAntreanFeed.ts:118` (`antrean:publik`, anon), `usePanggilanLayar.ts:167` (`layar:panggilan`).
- Layar TV (`layar/[token]`): `useAntreanFeed` poll 15 dtk (`select('*')` `v_layar_antrian` + `ambilStatusBuka`), `usePanggilanLayar` poll 5 dtk (`POLL_PANGGILAN_MS`), pengumuman tiap 5 menit; satu layar sekitar 16 request/menit tetap.
- Sesi staf: `useSesiStaf` ping tiap 60 dtk (`useSesiStaf.ts:22,133`).
- Auth: tiap request `/admin*` menjalankan refresh sesi di `proxy.ts`, dan route rekap memanggil `auth.getUser()` lagi.

## 6. Kandidat "kerja berat CPU" (konkret)

| Berkas | Apa yang dikerjakan | Perkiraan frekuensi |
|---|---|---|
| src/app/api/investment-docs/upload/route.ts:214-238 | pdfjs render tiap halaman PDF (<= 50, skala 1,5) ke canvas + `toBuffer('image/png')`, semua di memori, lalu unggah PNG | jarang (admin unggah); sangat berat per panggilan |
| src/app/api/investment-docs/page-image/route.ts:218-229 | `sharp().metadata()` + `composite` watermark per permintaan; unduh PNG dari storage tiap kali; cache memori per proses (:21-44) | tiap pengunjung galeri x tiap halaman; tinggi |
| src/lib/rekap/excelTerpadu.ts:24-63 + src/lib/rekap/terpaduServer.ts:75-94 | ExcelJS tulis <= 50.000 baris x kolom dinamis, didahului <= 50 RPC berurutan | ekspor manual; sedang |
| src/lib/survei/export.ts (436 baris) | workbook ExcelJS laporan survei | manual |
| src/lib/rekap/performa.ts + src/app/api/admin/rekap/performa/route.ts | tarik semua `penanganan` rentang (<= 50.000 baris, halaman 1000), agregasi di Node | tiap buka/ubah rentang tab Performa |
| supabase/migrations/202611040001_perbaikan_tinjauan_akhir.sql:559 `rekap_pelayanan_inti` | UNION ALL dua sumber atas rentang <= 366 hari; ~3x per muat tab Data, ~2x Harian/Kinerja | tiap muat tab rekap |
| supabase/migrations/202611100003_umkm_produk_baca.sql:52- `umkm_cari_katalog` | `cocok` penuh (ILIKE multi-kolom, `md5`, subquery produk) + `kartu()` x20 | tiap pencarian katalog tak ter-cache |
| src/app/api/chat/ai/route.ts (401) + lib/gemini.ts, lib/llm/* | embedding + `match_faq`/`match_dokumen` (pgvector 3072-dim, FTS) + LLM berantai, redaksi PII, deteksi injeksi | tiap pesan pengunjung ke bot |
| src/app/api/admin/{faq,dokumen}/embed | pembuatan embedding (panggilan eksternal) per FAQ/dokumen | manual admin; dokumen bisa banyak potongan |
| src/app/admin/antrian/page.tsx:846-1110 (client) | render `renderNama/Status/Aksi` per baris tabel, tiap refresh 30 dtk/Realtime | tiap refresh, di browser |
| src/app/chat/merge.ts, src/app/chat/page.tsx | penggabungan/sinkron pesan di client | per pesan/event |

## Yang tidak bisa dipastikan secara statis
- Waktu nyata rekap: `EXPLAIN (ANALYZE, BUFFERS)` untuk `rekap_pelayanan_inti`, `rekap_ringkasan_dilayani`, `rekap_data_pelayanan` pada data produksi (rentang 7 vs 366 hari); apakah plan memakai `idx_kunjungan_tanggal` atau seq scan; jumlah baris `penanganan`/`tiket_antrean`.
- Biaya `staf_lingkup()` dan fungsi RLS `boleh_*` per baris pada `penanganan`/`tiket_antrean` untuk query langsung dari browser.
- Jumlah baris yang benar-benar dimuat query tanpa `.limit` (bagian 3.3) di produksi, dan nilai `max-rows` PostgREST proyek.
- Waktu `umkm_cari_katalog` dengan N profil terbit (jumlah profil terbit saat ini tidak diketahui) dan apakah planner memakai indeks trigram untuk klausa OR.
- Cold start Vercel, jumlah instance (efektivitas cache memori `page-image`), durasi dan memori puncak `upload` PDF 50 halaman, batas memori fungsi Hobby.
- Latensi Vercel <-> Supabase (apakah satu region) dan Auth round-trip.
- Jumlah koneksi Realtime bersamaan dan pesan/bulan vs kuota free; jumlah staf yang membuka sidebar bersamaan.
- Apakah `headersPrivat` (`lib/umkm-katalog/server.ts`) mengizinkan cache edge; perilaku `unstable_cache` antar-instance.
- Ukuran payload sebenarnya (jsonb `pendataan` per baris, `umkm_detail_tugas`).
- Status penerapan migrasi di produksi (CLAUDE.md menyebut sebagian "belum diterapkan"; `docs/MIGRATIONS.md` tidak dibaca di sini).
