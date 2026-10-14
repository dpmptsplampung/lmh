# Kontrak DB Tahap B: Alur Front Office → Eskalasi (untuk agent UI)

> Tanggal: 2026-10-13 · Branch `feat/audit-fondasi-fo-eskalasi` · Status migrasi: **DITULIS, BELUM DITERAPKAN** (tidak pernah dijalankan ke DB mana pun).
> Migrasi: `supabase/migrations/202610140003_fo_model_data.sql`, `202610140004_fo_rpc.sql`, `202610140005_fo_selaras_antrean.sql`.
> Rollback: `docs/rollback-fo-model-data-202610140003.sql`, `docs/rollback-fo-rpc-202610140004.sql`, `docs/rollback-fo-selaras-antrean-202610140005.sql`.
> Test kontrak statis: `supabase/migrations/fo_eskalasi.test.ts` (memeriksa bahwa dokumen ini memuat semua RPC dan kode galat). Uji perilaku: `scripts/test-fo-eskalasi.mjs` (belum dijalankan).
> Spec: `docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md` §3–§4. Dokumen ini **mengikat**: bila berbeda dengan spec, yang berlaku adalah dokumen ini (lihat §8 Deviasi).

## 0. Aturan umum untuk klien

1. **Semua perubahan status lewat RPC** (`supabase.rpc(nama, {param})`). Klien **tidak punya** policy INSERT/UPDATE/DELETE pada `kunjungan`, `tiket_antrean`, `penanganan`. `UPDATE` langsung mengembalikan 0 baris (bukan galat) → jangan dipakai.
2. **Selalu baca `error`.** Kode galat ada di **awal pesan** (`error.message` diawali `KODE:`). Cocokkan awalan (`message.startsWith('SUDAH_DIAMBIL')`), jangan hanya SQLSTATE. SQLSTATE (`error.code`) disertakan sebagai pelengkap.
3. Balasan sukses selalu `jsonb` dengan `ok: true`. Galat = exception (tidak ada `ok: false`).
4. Identitas pemanggil diambil dari sesi (`staf_saya()` / `auth.uid()`), **tidak pernah** dari parameter. Semua RPC staf memanggil `sesi_valid()` → `SESI_TIDAK_SAH` berarti arahkan ke login (pola A2).
5. Semua waktu (`mulai_at`, `selesai_at`, `waktu_*`, `kunjungan.selesai_at`) diisi **jam server**. Tidak ada parameter waktu.
6. Tanggal "hari ini" = WIB (`Asia/Jakarta`), sama dengan `src/lib/time.ts`.
7. Tombol aksi dikunci selama request; respons idempoten (`sudah_milik_anda`, `sudah_ada`) diperlakukan sebagai sukses.
8. Setelah migrasi diterapkan, PostgREST harus memuat ulang skema (Supabase biasanya otomatis; bila RPC "not found", `NOTIFY pgrst, 'reload schema'` oleh pengelola DB).

## 1. Skema tabel

### 1.1 `layanan.prefiks_antrean` (diubah)
- `text NOT NULL`, CHECK `^[A-Z]{2}$`, UNIQUE (`uq_layanan_prefiks_antrean`).
- Kosong/NULL saat INSERT/UPDATE → **dibuat otomatis** oleh trigger `trg_layanan_isi_prefiks` (huruf besar + trim dulu). Bentrok kode manual → `23505` (route Kelola Layanan sudah memetakan ke 409).
- Backfill: OS (Helpdesk OSS), NO (Non OSS), BM (BALMON), BL (Bank Lampung), BP (BPJS), IG (Investment Gallery), JI (Jasa Industri), MU (Matchmaking UMKM), SH (Sertifikasi Halal), SM (Sertifikasi Mutu…); layanan lain auto-generate.
- **UI wajib:** `src/app/api/admin/layanan/[id]/route.ts` (zod `^[A-Z]{1,3}$`) dan `LayananForm` harus diubah ke tepat 2 huruf; nilai 1/3 huruf kini ditolak CHECK (`23514`). Kirim `null`/kosong = minta kode otomatis.

### 1.2 Nomor tiket
- `nomor_display` = `<KODE>-<nnn>` (mis. `OS-014`; ≥ 1000 menjadi `OS-1000`). Nomor reset per (layanan, tanggal WIB), atomik (`antrean_counter`).
- `tiket_antrean.tanggal` = tanggal WIB saat tiket terbit (bukan tanggal kunjungan).

### 1.3 `kunjungan` (diubah)
| Kolom | Tipe | Keterangan |
|---|---|---|
| `asal` | text | `walk_in` \| `reservasi` \| `online` (online wajib `chat_sesi_id`; dipakai Tahap C) |
| `status` | text | `terjadwal` \| `menunggu` \| `dilayani` \| `selesai` \| `batal` \| `no_show` \| `tidak_terlayani` (nilai tidak berubah; arti baru di §5) |
| `chat_sesi_id` | uuid NULL | FK `chat_sesi` |
| `selesai_at` | timestamptz NULL | **diisi trigger** saat status masuk `selesai`/`batal`/`no_show`/`tidak_terlayani`; NULL bila kembali aktif |
| `asal_instansi`, `kategori`, `email`, `keperluan` | text NULL | data pengunjung (walk-in FO tidak punya baris `pengunjung`); `kategori` ∈ `UMKM`,`Umum`,`Instansi`,`Investor` |
| `tujuan` | text NULL | `loket` \| `bertemu_seseorang` (reservasi baru) |
| `layanan_saran_id` | uuid NULL | layanan yang dipilih saat reservasi = **saran** tujuan eskalasi, bukan tiket |
| `nama_yang_ditemui`, `jam_rencana` | text / time NULL | reservasi |
| `client_request_id` | uuid NULL UNIQUE | idempotensi `fo_mulai_kunjungan` |
| `dibuat_oleh` | uuid NULL | `petugas.id` FO pembuat |
| (lama) `id, pengunjung_id, nama, kontak_hp, qr_token, tanggal, waktu_masuk, legacy_visit_id, created_at, updated_at` | | `qr_token` kini juga dibuat untuk walk-in FO (fondasi survei) |

RLS baca (tidak berubah): pengunjung = miliknya (`kunjungan_select_own`); staf = `boleh_kunjungan(id)` (Admin/FO semua; petugas hanya kunjungan yang punya tiket di layanannya). **Policy `kunjungan_staff_update` dicabut.**

### 1.4 `tiket_antrean` (diubah)
- `status` += `dikembalikan` (dikembalikan petugas ke FO) dan `dialihkan` (dipindah Admin; lihat `dialihkan_ke`). Keduanya **status akhir**.
- `penanganan_asal_id uuid NULL` → tahap FO yang melahirkan tiket. **NULL = tiket lama** (alur `visit`).
- `dialihkan_ke uuid NULL` → tiket pengganti.
- RLS baca tidak berubah: pengunjung tiketnya; Admin/FO semua; petugas layanannya.

### 1.5 `penanganan` (BARU) — satu baris per tahap
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid PK | |
| `kunjungan_id` | uuid NOT NULL | FK kunjungan (CASCADE) |
| `tahap_ke` | int ≥ 1 | urutan dalam kunjungan, UNIQUE per kunjungan |
| `peran_tahap` | text | `fo` \| `layanan` |
| `layanan_id` | uuid NULL | NULL ⇔ `fo` |
| `saluran` | text | `walk_in` \| `qr` \| `chat` (diwarisi tahap sebelumnya) |
| `penangan_id` | uuid NULL | `petugas.id`; diisi saat mulai; hanya dia yang boleh menutup |
| `tiket_id` | uuid NULL | wajib untuk `layanan` non-chat; NULL untuk `fo` |
| `topik_id` | uuid NULL | FK `topik_penanganan` (SET NULL bila topik dihapus) |
| `topik` | text NULL | **salinan nama topik** saat ditutup (pakai ini untuk tampilan/rekap) |
| `hasil` | text NULL | `selesai` \| `dieskalasi` \| `dikembalikan` (hanya bila `status='selesai'`) |
| `catatan` | text NULL | wajib saat `selesai`; FO ≤ 200, layanan ≤ 1000 karakter; untuk `batal` berisi alasan sistem/Admin |
| `status` | text | `menunggu` \| `berjalan` \| `selesai` \| `batal` |
| `batal_karena` | text NULL | `dialihkan` \| `diambil_alih` \| `tidak_terlayani` (hanya bila `batal`) |
| `mulai_at`, `selesai_at` | timestamptz NULL | jam server |
| `chat_sesi_id` | uuid NULL | hanya saluran chat (Tahap C) |
| `dibuat_oleh` | uuid NULL | petugas yang membuat baris (mis. FO yang mengeskalasi) |
| `created_at`, `updated_at` | timestamptz | `created_at` = masuk kotak masuk/antrean (waktu tunggu = `mulai_at - created_at`) |

Invarian (CHECK/indeks): `menunggu` → tanpa penangan/waktu; `berjalan` → penangan + `mulai_at`; `selesai` → penangan, `mulai_at`, `selesai_at`, `hasil`, `catatan`, dan `topik` (kecuali `hasil='dikembalikan'`); `batal` → `selesai_at` + `batal_karena`. **Satu tahap terbuka (`menunggu`/`berjalan`) per kunjungan** dan per tiket.

RLS: **hanya SELECT**, lewat `boleh_penanganan(...)`:
- Admin: semua.
- FO: baris yang `penangan_id` = dirinya, semua `menunggu` + `peran_tahap='fo'` (kotak masuk), dan semua tahap lain dari kunjungan yang memuat baris-baris tadi (konteks riwayat).
- Petugas: tahap layanannya, tahap yang ia tangani, dan semua tahap lain dari kunjungan yang punya tahap di layanannya (mis. catatan eskalasi FO).
- Pengunjung/anon: tidak ada.
Realtime: `penanganan` masuk publikasi `supabase_realtime` (postgres_changes menghormati RLS).

### 1.6 `topik_penanganan` (BARU)
`id uuid, layanan_id uuid NULL (NULL = topik FO), nama text (2..100, unik per layanan tanpa beda huruf besar), aktif boolean, urut int, created_at, updated_at`.
RLS: SELECT semua staf aktif; INSERT/UPDATE/DELETE hanya Admin (langsung lewat PostgREST, tanpa RPC). Nonaktifkan (`aktif=false`) alih-alih menghapus topik terpakai. Seed: 7 topik FO + 6–8 topik per 10 layanan (draf, `docs/superpowers/specs/2026-10-13-topik-penanganan-draf.md`), masing-masing punya "Lainnya" (`urut` 99).

## 2. RPC — Front Office (peran `front_office` atau `admin`)

Kode galat umum semua RPC staf: `FORBIDDEN` (42501, bukan staf aktif / peran salah), `SESI_TIDAK_SAH` (42501).

### 2.1 `fo_mulai_kunjungan(p_nama text, p_asal_instansi text, p_kontak_hp text DEFAULT NULL, p_kategori text DEFAULT NULL, p_email text DEFAULT NULL, p_keperluan text DEFAULT NULL, p_layanan_saran_id uuid DEFAULT NULL, p_pengunjung_id uuid DEFAULT NULL, p_client_request_id uuid DEFAULT NULL) → jsonb`
Walk-in. Membuat `kunjungan` (`walk_in`, `dilayani`, tanggal hari ini) + `penanganan` tahap 1 (`fo`, `walk_in`, `berjalan`, penangan = pemanggil). **Tidak menerbitkan tiket.**
- Validasi: nama 3–120; asal/instansi 2–200; HP opsional `^(\+?62|0)[0-9]{8,14}$` (spasi/strip dibuang); kategori opsional ∈ daftar; email opsional berformat; keperluan ≤ 500; layanan saran harus aktif; `p_pengunjung_id` (opsional, bila FO memilih pengunjung terdaftar) harus ada.
- Ditolak setelah jam tutup (`layanan_sudah_tutup()`, 16:00 dari pengaturan).
- Idempoten: `p_client_request_id` yang sama dari staf yang sama → balasan `sudah_ada: true` (kunjungan lama). Dua request serentak dengan id sama: satu menang, satu bisa menerima `23505` → panggil ulang = `sudah_ada`.
- Balasan: `{ok, sudah_ada:false, kunjungan_id, penanganan_id, qr_token, mulai_at}` atau `{ok, sudah_ada:true, kunjungan_id, penanganan_id, qr_token}`.
- Galat: `DATA_TIDAK_VALID` (22023), `LAYANAN_TIDAK_VALID` (22023), `NOT_FOUND` (P0002, pengunjung), `LAYANAN_TUTUP` (P0001), `IDEMPOTENSI_BENTROK` (P0001, id dipakai staf lain).

### 2.2 `fo_checkin_reservasi(p_qr_token text) → jsonb`
Scan QR reservasi. Kunjungan `terjadwal` hari ini → `dilayani` (+ `waktu_masuk` server) + `penanganan` (`fo`, `qr`, `berjalan`). Tanpa tiket. Reservasi lama (dibuat lewat `visit` sebelum cutover) ikut didukung: `visit` disinkronkan ke `dilayani`.
- Balasan: `{ok, kunjungan_id, penanganan_id, nama, tanggal, tujuan, layanan_saran_id, layanan_saran_nama, nama_yang_ditemui, keperluan, mulai_at}` (layanan saran → pra-pilih di dialog eskalasi).
- Galat: `NOT_FOUND` (P0002), `QR_KEDALUWARSA` (P0001: `no_show` atau tanggal sudah lewat), `INVALID_STATUS` (P0001: sudah check-in/batal/selesai), `BUKAN_HARI_INI` (P0001: reservasi tanggal mendatang).
- Pratinjau sebelum check-in (tanpa mengubah apa pun): baca langsung `kunjungan` (§6.4).

### 2.3 `fo_tolak_reservasi(p_qr_token text, p_alasan text) → jsonb`
Pengganti tombol "Tolak" di scan lama. `terjadwal` → `batal`, `audit_log` (`fo_tolak_reservasi`).
- Balasan: `{ok, kunjungan_id, status:'batal'}`. Galat: `ALASAN_WAJIB` (22023, 5–500), `NOT_FOUND`, `INVALID_STATUS`.

### 2.4 `fo_selesai(p_penanganan_id uuid, p_topik_id uuid, p_catatan text) → jsonb`
FO menyelesaikan sendiri. Tahap → `selesai` (`hasil='selesai'`), kunjungan → `selesai` (`selesai_at` server). Reservasi lama: `visit` → `selesai` (SKM lama tetap terkirim).
- Syarat: tahap `fo`, bukan chat, `berjalan`, `penangan_id` = pemanggil. Topik = topik FO aktif (`layanan_id IS NULL`). Catatan wajib 1–200 (trim).
- Balasan: `{ok, penanganan_id, kunjungan_id, kunjungan_status, selesai_at}`.
- Galat: `NOT_FOUND`, `BUKAN_TAHAP_FO` (P0001), `SALURAN_CHAT` (P0001, pakai RPC chat Tahap C), `INVALID_STATUS`, `BUKAN_PEMILIK` (42501), `TOPIK_WAJIB` / `TOPIK_TIDAK_VALID` / `CATATAN_WAJIB` / `CATATAN_TERLALU_PANJANG` (22023).

### 2.5 `fo_eskalasi(p_penanganan_id uuid, p_layanan_id uuid, p_topik_id uuid, p_catatan text) → jsonb`
Tahap FO → `selesai` (`hasil='dieskalasi'`, topik + catatan wajib seperti 2.4); terbit tiket baru `<KODE>-<nnn>` (`menunggu`, `penanganan_asal_id` = tahap FO); tahap berikut (`layanan`, `menunggu`, `tiket_id`); kunjungan → `menunggu`; notifikasi web push ke semua petugas **aktif** layanan itu (`queue_notifikasi`, payload `{type:'eskalasi_fo', tiket_id, layanan_id, nomor_display, url:'/admin/antrian'}`, tanpa nama pengunjung).
- Syarat layanan tujuan: ada, `aktif`, `punya_antrean`; beroperasi hari ini (`is_layanan_buka_jadwal`); belum jam tutup.
- Balasan: `{ok, kunjungan_id, penanganan_fo_id, penanganan_layanan_id, tiket_id, nomor_display, layanan_id, layanan_nama, petugas_hadir, notifikasi_diantrekan}`. `petugas_hadir=false` (belum ada absensi `approved` hari ini) **bukan galat**: tampilkan peringatan ke FO.
- Galat: semua galat 2.4 + `LAYANAN_TIDAK_VALID` (22023), `LAYANAN_TIDAK_BUKA` (P0001), `LAYANAN_TUTUP` (P0001).

### 2.6 `fo_ambil_dari_kotak_masuk(p_penanganan_id uuid) → jsonb`
Atomik: `UPDATE … WHERE status='menunggu' AND peran_tahap='fo'` → `berjalan`, penangan = pemanggil; kunjungan → `dilayani`. FO mana pun boleh.
- Balasan: `{ok, sudah_milik_anda:false, penanganan_id, kunjungan_id, mulai_at}`; klik ganda oleh orang sama → `sudah_milik_anda:true`.
- Galat: `NOT_FOUND`, `SUDAH_DIAMBIL` (P0001, kalah balapan → muat ulang kotak masuk), `BUKAN_TAHAP_FO`, `SALURAN_CHAT`, `INVALID_STATUS`.
- Setelah diambil, FO menutup dengan `fo_selesai` atau `fo_eskalasi` (bisa ke layanan mana pun, termasuk yang sama).

## 3. RPC — Petugas layanan / Admin

### 3.1 `layanan_mulai(p_tiket_id uuid) → jsonb` (A3, diselaraskan)
Perilaku A3 tidak berubah (Admin semua layanan, petugas layanannya, FO ditolak; atomik; `SUDAH_DIAMBIL`; idempoten `sudah_milik_anda`). **Tambahan:** untuk tiket hasil eskalasi, tahap `menunggu` → `berjalan` (penangan = pemanggil) dan kunjungan → `dilayani`.
Balasan: `{ok, sudah_milik_anda, dilayani_oleh, waktu_mulai_layan}`. Galat: `FORBIDDEN`, `SESI_TIDAK_SAH`, `NOT_FOUND`, `SUDAH_DIAMBIL`, `INVALID_STATUS`, `DIVERGENSI`.

### 3.2 `layanan_selesai(p_tiket_id uuid, p_form_type text DEFAULT NULL, p_payload jsonb DEFAULT NULL, p_topik_id uuid DEFAULT NULL, p_catatan text DEFAULT NULL) → jsonb` (signature BARU)
Aturan A3 tetap (hanya pemilik `dilayani_oleh`; FO ditolak; pendataan OSS/Perizinan sama persis dengan A3). **Tiket hasil eskalasi (punya tahap `berjalan`) WAJIB `p_topik_id` (topik aktif milik layanan tiket) dan `p_catatan` (1–1000)**, divalidasi sebelum apa pun ditulis. Tahap → `selesai` (`hasil='selesai'`), kunjungan → `selesai` bila tak ada tahap terbuka. Tiket lama: topik/catatan diabaikan (boleh NULL).
- Panggilan lama (`{p_tiket_id, p_form_type, p_payload}`) tetap sah. `finalize_pelayanan(uuid,text,jsonb)` (pembungkus) tetap ada tetapi **tidak bisa** mengirim topik/catatan → untuk tiket hasil eskalasi akan gagal `TOPIK_WAJIB`; route `api/admin/pelayanan/[tiketId]` harus memanggil `layanan_selesai` dengan 5 parameter.
- Balasan: `{ok, is_locked, waktu_selesai, penanganan_id (NULL untuk tiket lama), kunjungan_status}`.
- Galat: `FORBIDDEN`, `SESI_TIDAK_SAH`, `INVALID_FORM`, `NOT_FOUND`, `INVALID_STATUS`, `BUKAN_PEMILIK`, `TOPIK_WAJIB`, `TOPIK_TIDAK_VALID`, `CATATAN_WAJIB`, `CATATAN_TERLALU_PANJANG`, `LOCKED`, `DIVERGENSI`.

### 3.3 `layanan_kembalikan(p_tiket_id uuid, p_catatan text, p_topik_id uuid DEFAULT NULL) → jsonb`
Peran `admin`/`petugas`, **hanya pemilik** (`dilayani_oleh`) tiket `dilayani` hasil eskalasi. Tiket → `dikembalikan` (`waktu_selesai` server); tahap layanan → `selesai` (`hasil='dikembalikan'`, catatan 1–1000 wajib, topik opsional); tahap FO baru `menunggu` (masuk **kotak masuk FO**); kunjungan → `menunggu`.
- Balasan: `{ok, tiket_id, kunjungan_id, penanganan_layanan_id, penanganan_fo_id, waktu_selesai}`.
- Galat: `NOT_FOUND`, `TIKET_LAMA` (P0001, tiket alur visit), `INVALID_STATUS`, `BUKAN_PEMILIK`, `CATATAN_WAJIB`, `CATATAN_TERLALU_PANJANG`, `TOPIK_TIDAK_VALID`, `DIVERGENSI`.

### 3.4 `admin_ambil_alih(p_tiket_id uuid, p_alasan text) → jsonb` (A3, diselaraskan)
Perilaku A3 tetap (hanya Admin, alasan ≥ 5, tiket `dilayani`, `audit_log`). **Tambahan:** tahap `berjalan` pemilik lama → `batal` (`batal_karena='diambil_alih'`, catatan = alasan), tahap baru `berjalan` untuk Admin. Balasan dan galat sama dengan A3: `{ok, sudah_milik_anda, pemilik_lama, dilayani_oleh}`; `FORBIDDEN`, `SESI_TIDAK_SAH`, `ALASAN_WAJIB`, `NOT_FOUND`, `INVALID_STATUS`.

### 3.5 `admin_alihkan(p_tiket_id uuid, p_layanan_tujuan uuid, p_alasan text) → jsonb`
Hanya Admin. Tiket hasil eskalasi berstatus `menunggu`/`dipanggil`/`dilayani` dipindah ke layanan lain: tiket lama → `dialihkan` (`dialihkan_ke`), tahap lama → `batal` (`dialihkan`), tiket baru `<KODE baru>-<nnn>` `menunggu` + tahap baru `menunggu`, kunjungan → `menunggu`, `audit_log` (`admin_alihkan`, nilai lama/baru), notifikasi petugas layanan tujuan (`type:'tiket_dialihkan'`). Tidak memeriksa jadwal/jam tutup (keputusan Admin); `petugas_hadir` sebagai info.
- Balasan: `{ok, tiket_lama_id, tiket_baru_id, nomor_display, layanan_id, layanan_nama, penanganan_id, petugas_hadir, notifikasi_diantrekan}`.
- Galat: `FORBIDDEN`, `SESI_TIDAK_SAH`, `ALASAN_WAJIB` (5–500), `NOT_FOUND`, `TIKET_LAMA`, `INVALID_STATUS`, `LAYANAN_SAMA` (22023), `LAYANAN_TIDAK_VALID`, `DIVERGENSI`.
- Mengarahkan ke **petugas tertentu** belum didukung (lihat §9).

## 4. RPC — Pengunjung (reservasi online)

### 4.1 `reservasi_buat(p_tujuan text, p_tanggal date, p_layanan_id uuid DEFAULT NULL, p_nama_yang_ditemui text DEFAULT NULL, p_keperluan text DEFAULT NULL, p_jam_rencana time DEFAULT NULL) → jsonb`
Pengganti `INSERT visit` di `me/reservasi`. Pemanggil harus punya baris `pengunjung` (`auth_user_id = auth.uid()`). Membuat `kunjungan` `reservasi`/`terjadwal` (nama/HP/instansi/kategori/email disalin dari profil). **Tidak** menulis `visit`, tidak menerbitkan tiket.
- Validasi: `p_tujuan` ∈ `loket`, `bertemu_seseorang`; tanggal hari ini s.d. +7 hari, bukan Sabtu/Minggu; `loket` → layanan aktif, `punya_antrean`, bukan `nonaktif`, beroperasi pada tanggal itu (`is_layanan_buka_jadwal`); `bertemu_seseorang` → `p_nama_yang_ditemui` 3–120; keperluan ≤ 500; kuota `layanan.kuota_harian` bila diisi (saat ini NULL semua = tanpa batas); satu reservasi `terjadwal` yang sama (tanggal + tujuan + layanan) per pengunjung.
- Consent PDP (`consent_log`) tetap ditulis klien seperti sekarang **sebelum** memanggil RPC.
- Balasan: `{ok, kunjungan_id, qr_token, tanggal, status:'terjadwal'}` (`qr_token` = 32 hex, tampilkan sebagai QR).
- Galat: `FORBIDDEN` (belum masuk / tanpa profil), `SESI_TIDAK_SAH`, `DATA_TIDAK_VALID`, `TANGGAL_TIDAK_VALID` (22023), `LAYANAN_TIDAK_VALID`, `LAYANAN_TIDAK_BUKA`, `RESERVASI_GANDA` (P0001), `KUOTA_PENUH` (P0001).

### 4.2 `reservasi_batalkan(p_kunjungan_id uuid) → jsonb`
Pengunjung membatalkan reservasi miliknya yang `terjadwal` → `batal`. Reservasi lama ikut menyinkronkan `visit`.
Balasan `{ok, kunjungan_id, status:'batal'}`. Galat: `FORBIDDEN`, `NOT_FOUND` (juga bila bukan miliknya), `INVALID_STATUS`.

## 5. Transisi status

```
kunjungan:  (walk-in)  ──fo_mulai_kunjungan──► dilayani
            terjadwal ──fo_checkin_reservasi──► dilayani ; terjadwal ──fo_tolak_reservasi / reservasi_batalkan──► batal
            dilayani ──fo_selesai──► selesai
            dilayani ──fo_eskalasi──► menunggu ──layanan_mulai──► dilayani ──layanan_selesai──► selesai
            dilayani(layanan) ──layanan_kembalikan──► menunggu ──fo_ambil_dari_kotak_masuk──► dilayani (FO lagi)
            menunggu/dilayani ──admin_alihkan──► menunggu (tiket baru)
            menunggu ──job 16:00──► tidak_terlayani ;  terjadwal (tanggal lewat) ──job no-show harian──► no_show

penanganan: menunggu ──ambil / layanan_mulai──► berjalan ──selesai/eskalasi/kembalikan──► selesai(hasil)
            menunggu|berjalan ──admin_alihkan──► batal(dialihkan) ; berjalan ──admin_ambil_alih──► batal(diambil_alih)
            menunggu ──job 16:00──► batal(tidak_terlayani)

tiket (hasil eskalasi): menunggu ──layanan_mulai──► dilayani ──layanan_selesai──► selesai
            dilayani ──layanan_kembalikan──► dikembalikan ; menunggu|dipanggil|dilayani ──admin_alihkan──► dialihkan
            menunggu|dipanggil ──job 16:00──► tidak_terlayani
```
Tahap `berjalan` yang lupa ditutup pada akhir hari **tidak** ditutup otomatis (kunjungan tetap `dilayani`).

## 6. Bacaan PostgREST yang boleh dipakai UI

(Semua lewat RLS; tidak perlu RPC.)

### 6.1 Kotak masuk FO
```ts
supabase.from('penanganan')
  .select('id, kunjungan_id, tahap_ke, saluran, created_at, dibuat_oleh, kunjungan:kunjungan_id(nama, kontak_hp, asal_instansi, keperluan, asal, tanggal)')
  .eq('peran_tahap', 'fo').eq('status', 'menunggu')
  .order('created_at', { ascending: true })
```
Alasan pengembalian = tahap sebelumnya (`tahap_ke - 1`, `hasil='dikembalikan'`, kolom `catatan`, `layanan_id`, `penangan_id`). Realtime: `postgres_changes` pada `penanganan` (filter `peran_tahap=eq.fo`).

### 6.2 Penanganan saya (FO / petugas)
```ts
supabase.from('penanganan')
  .select('id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, tiket_id, status, mulai_at, kunjungan:kunjungan_id(nama, asal_instansi, keperluan, layanan_saran_id)')
  .eq('penangan_id', myPetugasId).eq('status', 'berjalan')
```
Riwayat hari ini: `.eq('penangan_id', myPetugasId).gte('mulai_at', awalHariWIBIso)` (hitung batas dengan `src/lib/time.ts`).
Riwayat satu kunjungan: `.from('penanganan').select('*').eq('kunjungan_id', id).order('tahap_ke')`.

### 6.3 Antrean layanan (petugas / Admin)
```ts
supabase.from('tiket_antrean')
  .select('id, nomor, nomor_display, status, waktu_terbit, waktu_mulai_layan, dilayani_oleh, penanganan_asal_id, kunjungan:kunjungan_id(nama, keperluan, asal_instansi)')
  .eq('layanan_id', layananId).eq('tanggal', todayWIB())
  .in('status', ['menunggu', 'dipanggil', 'dilayani'])
  .order('nomor')
```
Catatan eskalasi FO untuk tiket: `.from('penanganan').select('topik, catatan, penangan_id, selesai_at').eq('id', tiket.penanganan_asal_id)`. Tiket lama punya `penanganan_asal_id = null` (jalur `layanan_selesai` tanpa topik/catatan).

### 6.4 Pratinjau QR reservasi (FO)
```ts
supabase.from('kunjungan')
  .select('id, nama, tanggal, status, tujuan, layanan_saran_id, nama_yang_ditemui, keperluan, legacy_visit_id')
  .eq('qr_token', token).eq('asal', 'reservasi').maybeSingle()
```
Reservasi lama (`legacy_visit_id` terisi): `tujuan/layanan/keperluan` ada di `visit` (FO boleh membaca `visit`); `fo_checkin_reservasi` sudah mengembalikan nilai gabungannya. Reservasi lama bertujuan `bertemu_seseorang` **tidak punya** baris `kunjungan` (trigger lama hanya menyalin `loket`) → `NOT_FOUND`.

### 6.5 Topik
```ts
supabase.from('topik_penanganan').select('id, nama, urut').eq('aktif', true)
  .is('layanan_id', null)                 // FO
  // .eq('layanan_id', layananId)         // petugas layanan
  .order('urut').order('nama')
```
Admin mengelola langsung (`insert`/`update` pada tabel ini; cek `error` dan baris terdampak).

### 6.6 Reservasi pengunjung
```ts
supabase.from('kunjungan').select('id, tanggal, status, qr_token, tujuan, layanan_saran_id, jam_rencana')
  .eq('asal', 'reservasi').order('tanggal', { ascending: false })   // RLS: hanya miliknya
```

## 7. Peringatan

1. **Cutover bersama.** Ketiga migrasi + klien Tahap B diterapkan bersamaan, di luar jam layanan, antrean kosong (Gerbang G.6). Klien lama `admin/scan` (UPDATE `visit`) dan `me/reservasi` (INSERT `visit`) tetap berfungsi secara DB sampai WP-24 mematikan dual-write, tetapi menghasilkan data alur lama (tiket langsung terbit, tanpa FO).
2. **`visit` belum dipensiunkan.** Alur baru tidak menulis `visit`, kecuali menyinkronkan reservasi lama. Akibatnya untuk kunjungan baru: **SKM via `visit.qr_token` (`get_skm_context`/`submit_skm_response`), notifikasi `notify_visit_selesai`, `skm_response_rate`, `mv_estimasi_layanan`, pengingat H-1 (`jumlah_terdaftar`) tidak berjalan** sampai WP-24/Tahap E memindahkannya. `me/page.tsx` yang membaca `visit` harus pindah ke `kunjungan`.
3. **`layanan_selesai` berganti signature.** Bentuk 3-argumen dihapus; argumen bernama lama tetap sah. Muat ulang skema PostgREST setelah terap.
4. **Form Kelola Layanan** harus mengirim prefiks tepat 2 huruf (atau kosong = otomatis).
5. **TS types**: tambahkan status tiket `dikembalikan`/`dialihkan` dan `kunjungan.asal='online'` ke union di `src/lib/constants.ts` / tipe terkait; rekap (`src/lib/rekap/`) perlu label untuk dua status baru (`rollup_rekap_harian.total_hadir` kini tidak menghitung `dialihkan`).
6. **Layar TV** (`v_layar_antrian`) tidak berubah: menghitung `menunggu`/`dilayani` semua tiket hari ini; setelah cutover semua tiket berasal dari eskalasi.
7. **Notifikasi petugas** diantrekan sebagai `web_push` ke `petugas.auth_user_id`; terkirim hanya bila petugas punya `push_subscriptions` dan cron `notif/send` berjalan.
8. **PII**: kolom baru `kunjungan.email/asal_instansi/kontak_hp` dan `penanganan.catatan` berisi data pribadi; tampilkan hanya ke staf; job anonimisasi belum mencakup kolom baru (lihat §9).
9. `penanganan` dan RPC baru belum pernah dieksekusi di DB mana pun; kontrak ini diturunkan dari SQL yang ditulis, bukan dari uji perilaku.

## 8. Deviasi dari spec (sadar)

| Spec | Implementasi | Alasan |
|---|---|---|
| `penanganan.status` = menunggu/berjalan/selesai | + `batal` dengan `batal_karena` (`dialihkan`, `diambil_alih`, `tidak_terlayani`) | tahap yang ditutup Admin/sistem tanpa hasil tidak boleh tampil sebagai "selesai" di rekap |
| `topik` (teks) | `topik_id` (FK) + `topik` (salinan teks) | tahan rename/nonaktif topik |
| `fo_eskalasi(kunjungan, layanan, catatan)` | `(penanganan, layanan, topik, catatan)` | topik wajib (K10) dan tahap yang ditutup harus spesifik |
| "cari/buat pengunjung" walk-in | kunjungan menyimpan data pengunjung; `p_pengunjung_id` opsional untuk menautkan profil yang sudah ada | `pengunjung.auth_user_id` NOT NULL: FO tidak bisa membuat akun pengunjung; mengikuti pola walk-in sekarang (`visit` tanpa pengunjung) |
| FO saja yang mendaftarkan walk-in (K3) | `front_office` **dan `admin`** | Admin pengganti saat FO tidak ada (perlu konfirmasi CEO) |
| catatan layanan | wajib 1–1000 saat selesai/kembalikan tiket hasil eskalasi | §4.2 "catatan NOT NULL saat selesai" |
| Tahap 'menunggu' kunjungan | kunjungan `menunggu` selama antre di layanan atau di kotak masuk FO | membedakan "sedang dilayani" vs "menunggu" |

## 9. Pertanyaan terbuka (untuk CEO)
1. Bolehkah Admin bertindak sebagai FO (mendaftarkan walk-in/scan)? Saat ini **ya**.
2. Eskalasi setelah 16:00 ditolak (`LAYANAN_TUTUP`), sama dengan walk-in. Perlu pengecualian bagi pengunjung yang sudah dilayani FO sebelum jam tutup?
3. Tahap `berjalan` yang tidak ditutup sampai akhir hari: biarkan (sekarang) atau tutup otomatis dengan `batal_karena` baru?
4. Catatan petugas layanan wajib saat selesai (selain form Pendataan)? Saat ini **wajib** untuk tiket hasil eskalasi; UI dapat mengisi otomatis dari `uraian_solusi`.
5. `admin_alihkan` ke **petugas tertentu** (K7) belum didukung; cukup layanan?
6. Retensi/anonimisasi untuk kolom PII baru di `kunjungan` dan `penanganan.catatan` (KEBIJAKAN_PDP).
7. Reservasi pengunjung lama bertujuan `bertemu_seseorang` (dibuat sebelum cutover) tidak bisa di-check-in lewat alur baru.

## 10. WP-24 (202610140007 + 202610140008): yang berubah bagi klien

> Ditulis, belum diterapkan. Diterapkan dalam jendela cutover yang sama dengan 0002..0006 (runbook `docs/RUNBOOK_FO_ESKALASI.md` bagian WP-24). Bagian ini MENGGANTIKAN peringatan §7.1–7.2 dan menjawab §9 butir 3, 6, 7.

1. **`visit` = arsip baca saja.** INSERT/UPDATE/DELETE dari klien gagal `42501` (permission denied); dari fungsi/service_role gagal `VISIT_ARSIP` (42501). SELECT (`visit_select_own`) tetap. Tidak ada RPC yang menyinkronkan `visit` lagi; `fo_sinkron_visit` dihapus. Realtime `postgres_changes` pada `visit` (mis. `admin/page.tsx`, `admin/kunjungan/page.tsx`) tidak akan menyala lagi: dengarkan `tiket_antrean`/`penanganan`/`kunjungan` atau andalkan polling.
2. **Reservasi lama**: reservasi `loket` yang masih `terjadwal` kini punya `tujuan`, `layanan_saran_id`, `keperluan`, `nama_yang_ditemui`, `jam_rencana`, `asal_instansi` di `kunjungan` (disalin dari `visit`). Reservasi lama `bertemu_seseorang` bertanggal hari ini atau nanti dibuatkan baris `kunjungan` (QR sama) sehingga `fo_checkin_reservasi` bekerja (§9.7 terjawab). Pratinjau §6.4 tidak perlu membaca `visit` lagi. Balasan `fo_checkin_reservasi` tetap sama.
3. **Tiket lama** (`legacy_visit_id`): `layanan_mulai`/`layanan_selesai` kini juga menggerakkan `kunjungan` (`dilayani`/`selesai`). `layanan_mulai` tidak lagi melempar `DIVERGENSI`.
4. **SKM berjalan untuk kunjungan baru**: `get_skm_context(p_token)` / `submit_skm_response(...)` (signature dan nilai balik SAMA: `invalid|not_found|not_completed|duplicate|submitted`) memakai `kunjungan.qr_token` dan `kunjungan.status = 'selesai'` (termasuk kunjungan yang selesai di FO). `layanan_nama`/`skm_respons.layanan_id` = layanan tiket `selesai` terakhir; **NULL bila selesai di FO**. `skm_respons.kunjungan_id` baru (unik). Token lama tanpa kunjungan dijawab dari arsip `visit`.
5. **Notifikasi pengunjung** (antre `notifikasi`, payload `kunjungan_id`, tanpa nama): kunjungan → `selesai`: email `skm_survey` (email profil, atau email yang dicatat FO bila tanpa akun) + push `skm_survey_push` (`url: /skm?token=…`); reservasi `terjadwal` → `dilayani`/`menunggu`: `reservasi_confirmed` (+ `_email`); tiket terbit `menunggu`: push `tiket_menunggu`; tiket → `dilayani`: push `tiket_dilayani`. Push hanya untuk pengunjung berakun.
6. **Response rate, audit, estimasi, pengingat** pindah ke `kunjungan`/`tiket_antrean`: `skm_response_rate.dilayani` +1 saat kunjungan `selesai` (layanan sama dengan SKM); `audit_log` `update_status` untuk entitas `kunjungan` dan `tiket_antrean` (hanya bila status berubah); `mv_estimasi_layanan`/`v_antrian_loket` dari `tiket_antrean` (kolom sama); `jumlah_terdaftar` dari reservasi `kunjungan` + tiket.
7. **§9.3 terjawab — penutupan otomatis**: job `penanganan_tutup_otomatis` (23:00 WIB) menutup tahap `berjalan` (non-chat) yang tertinggal → `penanganan.status='batal'`, **`batal_karena='tidak_ditutup'`** (nilai baru), catatan sistem; tiket `dilayani` → `selesai` dengan `waktu_selesai` NULL (durasi tidak diketahui); kunjungan → **`selesai`** (pengunjung sudah dilayani; SKM terkirim). UI/rekap: tampilkan `tidak_ditutup` sebagai "tidak ditutup petugas", jangan hitung durasinya.
8. **§9.6 terjawab — retensi 730 hari**: job anonimisasi juga mengosongkan PII `kunjungan` (nama → `[anonim]`, HP/email/instansi/yang ditemui/keperluan → NULL), `penanganan.catatan` → `[anonim]`, dan arsip `visit`. Belum mencakup `pelayanan_*`, `buku_tamu`, chat.
