# Kontrak DB Tahap C: Live Chat sebagai Layanan Online Tercatat (untuk agent UI)

> Tanggal: 2026-10-14 · Branch `feat/audit-fondasi-fo-eskalasi` · Status migrasi: **DITULIS, BELUM DITERAPKAN**.
> Migrasi: `supabase/migrations/202610140009_chat_online.sql` (setelah 202610140003/0004/0005; tidak bergantung pada 0006–0008, tetapi diuji juga bersama 0006–0008).
> Rollback: `docs/rollback-chat-online-202610140009.sql`. Test kontrak statis: `supabase/migrations/chat_online.test.ts`.
> Uji perilaku: `scripts/test-chat-online.mjs` (transaksi selalu di-ROLLBACK). Dijalankan ke DB produksi pada 2026-10-14 06:13–06:15 WIB: `--pre 0002..0005 --apply 0009` = **99 lolos, 0 gagal**; `--pre 0002..0008 --apply 0009` = **99 lolos, 0 gagal**; jumlah baris sebelum = sesudah.
> Spec: `docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md` §3 (Chat), §4.7, K8, K10, K13. Aturan umum klien **sama dengan** `docs/analysis/FO-ESKALASI-KONTRAK-RPC.md` §0 (semua perubahan lewat RPC; baca `error`; kode galat di awal `error.message`; balasan `jsonb` `ok: true`; identitas dari sesi; jam server; idempoten `sudah_milik_anda`).

## 0. Ringkas

- **Kapan tercatat:** sesi chat menjadi layanan tercatat saat **ber-eskalasi** (status `eskalasi`) atau saat staf **mengambil** sesi yang masih `bot`. Saat itu dibuat `kunjungan` (`asal='online'`, `chat_sesi_id`) dan `penanganan` tahap 1 (`peran_tahap='fo'`, `saluran='chat'`, `menunggu`) = **kotak masuk FO**. Sesi yang hanya dijawab bot tidak membuat kunjungan.
- **Tanpa tiket:** chat tidak pernah menerbitkan `tiket_antrean`. Handoff FO → layanan = tahap `layanan` saluran `chat` dengan `tiket_id = NULL`.
- **Semua aksi staf atas sesi chat lewat RPC** `chat_ambil` / `chat_teruskan` / `chat_selesai`. DB **menolak** perubahan langsung `chat_sesi.status/ditangani_oleh/layanan_id/kunjungan_id` dengan `CHAT_HARUS_RPC`, termasuk dari service_role. **Akibatnya route lama `POST /api/chat/sesi` (`takeover`, `kembali_ke_bot`, `selesaikan`) gagal setelah migrasi** dan harus diganti (lihat §5).
- Alur yang **tidak berubah**: pengunjung membuat sesi (`bot`/`eskalasi`) lewat RLS; `/api/chat/ai` menaikkan `bot → eskalasi` (service_role); semua kirim/baca pesan (`/api/chat/messages`, RLS `chat_pesan`, realtime).
- **Pesan sistem ditulis RPC** di transaksi yang sama (pengirim `bot`). Route **tidak boleh** menulis pesan sistem sendiri lagi.
- **Hari tanpa pelayanan** (Sabtu/Minggu/tanggal di `hari_libur`; keputusan CEO 2026-10-14, migrasi `202610140012` #13, lihat §2.6): live chat dengan petugas tidak tersedia. `chat_ambil`/`chat_teruskan` menolak `HARI_TANPA_LAYANAN`; trigger eskalasi tidak mencatat kunjungan; `/api/chat/ai` tidak mengeskalasi; `/chat` memberi tahu pengunjung (bot saja). Penutupan otomatis 24 jam (`tutup_chat_tertinggal`, `0012` #11) tetap berlaku.

## 1. Skema

### 1.1 `chat_sesi` (diubah)
| Kolom | Tipe | Keterangan |
|---|---|---|
| `kunjungan_id` | uuid NULL | **BARU.** FK `kunjungan` (SET NULL). Terisi sejak eskalasi/diambil. Unik. Hanya ditulis RPC/trigger. |
| `status` | text | `bot` \| `eskalasi` \| `aktif` \| `selesai` (nilai tidak berubah; arti di §4) |
| `ditangani_oleh` | uuid NULL | `petugas.id` penangan tahap yang berjalan; NULL saat menunggu. Dipertahankan setelah `selesai` (siapa yang menutup). |
| `layanan_id` | uuid | layanan sesi. **Berubah** oleh `chat_teruskan` ke layanan tujuan (agar RLS chat lama memberi petugas tujuan akses baca/tulis). |

### 1.2 `kunjungan` (asal `online`)
Dibuat oleh trigger/RPC, tidak oleh klien: `asal='online'`, `chat_sesi_id` (unik per sesi), `status` (`menunggu` saat di kotak masuk / menunggu petugas layanan, `dilayani` saat ditangani, `selesai`), `tanggal` = tanggal WIB eskalasi (backfill: tanggal WIB `chat_sesi.created_at`), `waktu_masuk` = jam server, `qr_token` 32 hex (fondasi survei Tahap E). Data pengunjung **disalin dari `pengunjung`**: `pengunjung_id`, `nama` (fallback `chat_sesi.kontak_pengunjung`, lalu `'Pengunjung chat'`), `kontak_hp` (= `no_hp`), `email`, `asal_instansi`, `kategori`; `layanan_saran_id` = layanan sesi saat dicatat; `keperluan` NULL.

### 1.3 `penanganan` (saluran `chat`)
Kolom sama dengan kontrak FO §1.5. Khusus chat: `saluran='chat'`, `chat_sesi_id` terisi, `tiket_id` NULL (juga untuk tahap `layanan`). Satu tahap terbuka per kunjungan (invarian lama).

## 2. RPC

Kode galat umum: `FORBIDDEN` (42501, bukan staf aktif / peran salah / bukan layanannya), `SESI_TIDAK_SAH` (42501, sesi staf digantikan → arahkan ke login). Urutan kunci: `chat_sesi` (FOR NO KEY UPDATE) → `kunjungan` → `penanganan`; dua panggilan serentak atas sesi yang sama terserialkan.

### 2.1 `chat_ambil(p_sesi_id uuid, p_alasan text DEFAULT NULL) → jsonb`
Peran: `front_office`, `admin`, `petugas`. Atomik: `UPDATE penanganan … WHERE status='menunggu' AND penangan_id IS NULL`.

| Keadaan tahap terbuka | FO | Petugas (layanan = `chat_sesi.layanan_id`) | Admin |
|---|---|---|---|
| sesi `bot` (belum tercatat) | catat lalu ambil sebagai tahap `fo` | catat lalu ambil sebagai tahap `layanan` (layanannya) | catat lalu ambil sebagai `fo` |
| tahap `fo` `menunggu` (kotak masuk) | ambil (`fo`) | **ambil langsung** selama belum diambil FO: tahap berubah menjadi `layanan` (layanannya), tanpa tahap FO fiktif | ambil (`fo`) |
| tahap `layanan` `menunggu` (setelah diteruskan) | `FORBIDDEN` | ambil bila layanannya | ambil (`layanan`) |
| `berjalan` milik pemanggil | `sudah_milik_anda: true` (tanpa pesan baru) | sama | sama |
| `berjalan` milik orang lain | `SUDAH_DIAMBIL` | `SUDAH_DIAMBIL` | **ambil alih**: `p_alasan` 5–500 wajib (`ALASAN_WAJIB`), tahap lama `batal` (`batal_karena='diambil_alih'`), tahap baru `berjalan` untuk Admin (peran sama), `audit_log` `chat_ambil_alih` |

Efek sukses (bukan idempoten): tahap `berjalan` (penangan = pemanggil, `mulai_at` server), kunjungan `dilayani`, sesi `aktif` + `ditangani_oleh` = pemanggil, pesan sistem ke pengunjung. Admin: `audit_log` `chat_ambil`.
- Balasan: `{ok, sudah_milik_anda, ambil_alih, sesi_id, kunjungan_id, penanganan_id, peran_tahap, mulai_at}` (+ `pemilik_lama` bila `ambil_alih: true`).
- Galat: `FORBIDDEN`, `SESI_TIDAK_SAH`, `NOT_FOUND` (P0002), `INVALID_STATUS` (P0001, sesi `selesai`), `SUDAH_DIAMBIL` (P0001, kalah balapan → muat ulang daftar), `ALASAN_WAJIB` (22023, Admin ambil alih), `DIVERGENSI` (P0001, sesi belum selesai tanpa tahap terbuka; laporkan), `HARI_TANPA_LAYANAN` (P0001, `0012` #13: Sabtu/Minggu/hari libur, semua peran termasuk ambil alih Admin; diperiksa sebelum mengunci apa pun).

### 2.2 `chat_teruskan(p_sesi_id uuid, p_layanan_id uuid, p_topik_id uuid, p_catatan text) → jsonb`
Peran: `front_office`, `admin`; hanya **pemilik tahap FO yang berjalan**. Handoff **tanpa tiket**: tahap FO → `selesai` (`hasil='dieskalasi'`, topik FO aktif + catatan 1–200 wajib); tahap baru `layanan` (`p_layanan_id`, saluran `chat`, `menunggu`, `tiket_id` NULL); kunjungan `menunggu`; sesi → `eskalasi`, `ditangani_oleh` NULL, `layanan_id` = tujuan; pesan sistem "diteruskan ke petugas layanan …"; notifikasi web push ke semua petugas **aktif** layanan tujuan (`queue_notifikasi`, payload `{type:'chat_diteruskan', sesi_id, layanan_id, url:'/admin/chat'}`, tanpa PII). Admin: `audit_log` `chat_teruskan`. Tidak terikat jam tutup/jadwal (live chat tetap tersedia).
- Syarat layanan tujuan: ada, `aktif`, `punya_chat = true`. Boleh sama dengan layanan sesi saat ini.
- Balasan: `{ok, sesi_id, kunjungan_id, penanganan_fo_id, penanganan_layanan_id, layanan_id, layanan_nama, petugas_hadir, notifikasi_diantrekan}`. `petugas_hadir=false` (belum ada absensi `approved` hari ini) / `notifikasi_diantrekan=0` **bukan galat**: tampilkan peringatan ke FO.
- Galat: `FORBIDDEN`, `SESI_TIDAK_SAH`, `NOT_FOUND`, `INVALID_STATUS` (belum diambil / selesai), `BUKAN_TAHAP_FO` (P0001, tahap berjalan milik petugas layanan), `BUKAN_PEMILIK` (42501), `TOPIK_WAJIB` / `TOPIK_TIDAK_VALID` / `CATATAN_WAJIB` / `CATATAN_TERLALU_PANJANG` (22023), `LAYANAN_TIDAK_VALID` (22023), `HARI_TANPA_LAYANAN` (P0001, `0012` #13: petugas tujuan tidak bertugas pada Sabtu/Minggu/hari libur). Catatan: "tidak terikat jam tutup" di atas tetap berlaku untuk hari kerja.
- Setelah diteruskan, petugas layanan tujuan mengambil dengan `chat_ambil`. Mengembalikan chat dari petugas ke FO **belum didukung** (lihat §7).

### 2.3 `chat_selesai(p_sesi_id uuid, p_topik_id uuid, p_catatan text) → jsonb`
Peran: `front_office`, `admin`, `petugas`; hanya **pemilik tahap yang berjalan** (Admin pun harus `chat_ambil` dulu). Topik + catatan **wajib** (K10): tahap `fo` → topik FO (`layanan_id IS NULL`) + catatan 1–200; tahap `layanan` → topik aktif milik layanan tahap itu + catatan 1–1000. Tahap → `selesai` (`hasil='selesai'`, `topik` salinan nama), kunjungan → `selesai` (`selesai_at` server, trigger), sesi → `selesai` (`ditangani_oleh` tetap), **pesan penutup** (pengirim `bot`, `jenis_jawaban='penutup_survei'`) berisi **tempat** tautan survei tanpa URL. Admin: `audit_log` `chat_selesai`.
- Balasan: `{ok, sesi_id, kunjungan_id, penanganan_id, kunjungan_status, selesai_at, pesan_penutup_id}`.
- Galat: `FORBIDDEN`, `SESI_TIDAK_SAH`, `NOT_FOUND`, `INVALID_STATUS` (belum diambil / sudah selesai), `BUKAN_PEMILIK`, `TOPIK_WAJIB`, `TOPIK_TIDAK_VALID`, `CATATAN_WAJIB`, `CATATAN_TERLALU_PANJANG`.
- Survei (K13/Tahap E): cari pesan `jenis_jawaban='penutup_survei'` per sesi dan isi/ganti tautannya, atau kirim pesan baru. `kunjungan.qr_token` tersedia. Catatan: bila 202610140007 diterapkan, trigger `notify_kunjungan_status` sudah mengantrekan email/web push SKM (`/skm?token=<qr_token>`) saat kunjungan online `selesai`.

### 2.4 RPC FO lama dan saluran chat (konsisten)
`fo_ambil_dari_kotak_masuk`, `fo_selesai`, `fo_eskalasi` (0004/0007) **menolak** tahap saluran chat dengan `SALURAN_CHAT` (P0001). Untuk tahap chat pakai `chat_ambil` / `chat_selesai` / `chat_teruskan`. Job akhir hari (`tandai_tidak_terlayani_akhir_hari`) dan penutupan otomatis (`tutup_penanganan_tertinggal`, 0008) **tidak menyentuh** saluran chat: chat menunggu tetap di kotak masuk lintas hari.

### 2.5 `CHAT_HARUS_RPC` (42501)
Dari trigger `trg_chat_sesi_jaga_rpc`. Tanpa RPC hanya boleh: INSERT sesi berstatus `bot`/`eskalasi` tanpa `ditangani_oleh`/`kunjungan_id`; `bot → eskalasi`; `bot → selesai` (sesi belum tercatat); SET NULL otomatis akibat FK. Kolom lain (`kontak_pengunjung`, `updated_at`) bebas seperti sebelumnya.

### 2.6 Hari tanpa pelayanan (`202610140012` #13; keputusan CEO 2026-10-14)
- `hari_tanpa_layanan(p_tanggal date DEFAULT hari ini WIB) → boolean` (STABLE, SECURITY DEFINER, EXECUTE untuk anon/authenticated/service_role): `ISODOW IN (6,7)` atau tanggal ada di `hari_libur`. Sama dengan `hariTanpaLayanan()` di `src/lib/llm/bot-waktu.ts` dan aturan `tambah_hari_kerja`. Tidak memakai jadwal per layanan (chat lintas layanan).
- `chat_ambil`, `chat_teruskan`: `HARI_TANPA_LAYANAN` (P0001) untuk semua peran, sebelum mengunci/menulis apa pun. `chat_selesai`: **tidak** ditolak (pemegang chat dari hari kerja tetap dapat menutup).
- Trigger `chat_sesi_eskalasi_kunjungan` / `chat_pesan_eskalasi_kunjungan`: tidak membuat kunjungan/tahap pada hari itu. Sesi yang tetap `eskalasi` tanpa kunjungan dicatat saat pesan pengunjung berikutnya di hari kerja atau saat `chat_ambil` (hari kerja), atau ditutup `tutup_chat_tertinggal` setelah 24 jam tanpa aktivitas.
- Klien (tidak memanggil fungsi ini; menilai hari dari `hari_libur` lewat `src/lib/chat/hari-tanpa-layanan.ts`): `/api/chat/ai` tanpa eskalasi (termasuk jalur gagal; `reason` `hari_tanpa_layanan`, balasan menyarankan hari kerja berikutnya + kanal `wa_number`/`contact_email` dari `site_settings` bila terisi); `/chat` menampilkan pemberitahuan, menyembunyikan "Hubungkan ke Petugas", menonaktifkan layanan tanpa bot, dan meneruskan pesan sesi `eskalasi` ke bot; `/admin/chat` menonaktifkan Ambil Chat / Ambil Alih / Teruskan dengan alasan. Route `/api/chat/sesi` memetakan `HARI_TANPA_LAYANAN` ke HTTP 409 (`src/lib/chat-staf.ts`).

## 3. Transisi status

```
chat_sesi:  bot ──/api/chat/ai (service_role) / INSERT 'eskalasi'──► eskalasi   [trigger: kunjungan online 'menunggu' + tahap fo 'menunggu']
            bot ──chat_ambil──► aktif                                           [kunjungan dibuat saat itu juga]
            bot ──(tanpa RPC)──► selesai                                        [sesi tak tercatat, boleh]
            eskalasi ──chat_ambil──► aktif ──chat_teruskan──► eskalasi (layanan tujuan) ──chat_ambil──► aktif
            aktif ──chat_selesai──► selesai ; aktif ──chat_ambil (Admin + alasan)──► aktif (penangan Admin)
            (aktif → bot "kembali ke bot" TIDAK lagi didukung DB)

kunjungan (online): menunggu ──chat_ambil──► dilayani ──chat_teruskan──► menunggu ──chat_ambil──► dilayani ──chat_selesai──► selesai

penanganan (chat): fo menunggu ──chat_ambil(FO/Admin)──► fo berjalan ──chat_selesai──► selesai(hasil selesai)
                                                                   └──chat_teruskan──► selesai(hasil dieskalasi) + layanan menunggu
                   fo menunggu ──chat_ambil(petugas)──► layanan berjalan (baris yang sama, peran diubah)
                   layanan menunggu ──chat_ambil──► layanan berjalan ──chat_selesai──► selesai
                   berjalan ──chat_ambil(Admin, alasan)──► batal(diambil_alih) + tahap baru berjalan (Admin)
```

## 4. Kueri baca (PostgREST, lewat RLS)

### 4.1 Kotak masuk chat FO
```ts
supabase.from('penanganan')
  .select('id, kunjungan_id, chat_sesi_id, tahap_ke, created_at, kunjungan:kunjungan_id(nama, asal_instansi, kategori, layanan_saran_id, tanggal)')
  .eq('peran_tahap', 'fo').eq('status', 'menunggu').eq('saluran', 'chat')
  .order('created_at', { ascending: true })
```
Kotak masuk FO non-chat (kontrak FO §6.1) **harus** menambah `.neq('saluran', 'chat')` (kini kotak masuk memuat chat juga), atau satu daftar gabungan yang memanggil RPC sesuai `saluran`. Realtime: `postgres_changes` pada `penanganan` (filter `saluran=eq.chat`) dan/atau `chat_sesi` (sudah dipakai `admin/chat`).

### 4.2 Antrean chat petugas layanan
Chat yang boleh diambil petugas = sesi di layanannya (`chat_sesi.layanan_id`) yang tahap terbukanya `menunggu`:
```ts
supabase.from('penanganan')
  .select('id, chat_sesi_id, peran_tahap, layanan_id, created_at, kunjungan:kunjungan_id(nama, asal_instansi)')
  .eq('saluran', 'chat').eq('status', 'menunggu')   // RLS: petugas hanya melihat chat yang sesinya di layanannya
```
`peran_tahap='fo'` = belum diambil FO (boleh ambil langsung); `peran_tahap='layanan'` = diteruskan FO (catatan FO: tahap sebelumnya `tahap_ke - 1`, kolom `topik`, `catatan`). Alternatif yang sudah ada: `rpc('chat_sesi_ringkas')` (status `eskalasi`).

### 4.3 Chat yang sedang saya tangani / riwayat
```ts
supabase.from('penanganan').select('id, chat_sesi_id, peran_tahap, layanan_id, mulai_at, kunjungan_id')
  .eq('saluran', 'chat').eq('penangan_id', myPetugasId).eq('status', 'berjalan')
// riwayat satu chat
supabase.from('penanganan').select('*').eq('chat_sesi_id', sesiId).order('tahap_ke')
// kunjungan dari sesi
supabase.from('chat_sesi').select('id, status, layanan_id, ditangani_oleh, kunjungan_id').eq('id', sesiId).single()
```
**Siapa boleh membalas** (aturan untuk `/api/chat/messages`, yang memakai service_role): hanya penangan tahap `berjalan` sesi itu (`penanganan.penangan_id = me` dan `chat_sesi_id = sesi`, `status='berjalan'`); sesi `bot`/`eskalasi` → minta `chat_ambil` dulu. RLS `chat_pesan` **tidak diubah** (petugas layanan sesi dan Admin tetap bisa INSERT langsung; FO hanya lewat route service_role).

### 4.4 Topik
Sama dengan kontrak FO §6.5: tahap `fo` → `.is('layanan_id', null)`; tahap `layanan` → `.eq('layanan_id', tahap.layanan_id)`.

### 4.5 Visibilitas (RLS baca, diperluas di 0009)
- Admin, FO: seperti kontrak FO §1.5 (FO melihat semua tahap `fo menunggu`, termasuk chat, plus kunjungan yang memuatnya).
- Petugas: **tambahan** — semua tahap dan baris `kunjungan` dari kunjungan online yang sesinya **saat ini** berada di layanannya. Setelah chat diteruskan ke layanan lain, petugas layanan asal tidak lagi melihat sesi/tahap/kunjungan itu (kecuali ia pernah menangani tahapnya).
- Pengunjung: tidak melihat `penanganan`; melihat `kunjungan` miliknya (policy lama).

## 5. Perubahan wajib di klien (agent UI)

1. `src/app/api/chat/sesi/route.ts`: `takeover` → `rpc('chat_ambil', {p_sesi_id})` (Admin merebut sesi orang lain: kirim `p_alasan`); `selesaikan` → `rpc('chat_selesai', {p_sesi_id, p_topik_id, p_catatan})` (form topik + catatan wajib); aksi baru `teruskan` → `rpc('chat_teruskan', …)` (FO). Panggil RPC dengan klien **ber-JWT pengguna** (server client), bukan service_role: RPC membaca `auth.uid()` dan `sesi_valid()`. Hapus penulisan pesan sistem dan `audit_log` di route (RPC yang menulis). Hapus/ sembunyikan `kembali_ke_bot`.
2. `src/app/admin/chat/page.tsx`: kotak masuk dari §4.1/§4.2; tombol per peran (§2.1); dialog topik + catatan (penghitung 200/1000) untuk teruskan/selesai; pilihan layanan tujuan dari `layanan` `aktif` + `punya_chat`; peringatan `petugas_hadir=false`.
3. `src/app/api/chat/messages/route.ts`: aturan "siapa boleh membalas" §4.3 untuk semua staf (FO juga), bukan hanya petugas.
4. `src/app/chat/page.tsx`: tidak wajib berubah. Status `eskalasi` setelah diteruskan = "menunggu petugas layanan". Pesan `jenis_jawaban='penutup_survei'` bisa diberi gaya khusus.
5. Tipe TS: `chat_sesi.kunjungan_id`, kode galat `CHAT_HARUS_RPC`.

## 6. Peringatan

1. **Cutover bersama klien Tahap C.** Setelah 0009 diterapkan dan sebelum route diganti, "Ambil alih"/"Selesaikan" di admin chat gagal (`CHAT_HARUS_RPC`, route menjawab 500). Terapkan di luar jam layanan bersamaan dengan deploy klien.
2. **Backfill** saat migrasi: sesi `eskalasi` → kunjungan + tahap FO `menunggu`; sesi `aktif` ber-penangan → kunjungan `dilayani` + tahap `berjalan` (petugas berlayanan → tahap `layanan`; FO/Admin → `fo`), `mulai_at` = waktu migrasi (durasi tahap backfill tidak akurat); sesi `aktif` tanpa penangan → `eskalasi`. Uji 2026-10-14 di produksi: **2 sesi nyata** akan dibackfill (1 `aktif`, 1 `eskalasi`). Sesi lama yang basi akan muncul di kotak masuk: FO menutupnya dengan `chat_ambil` + `chat_selesai`.
3. Sesi `bot` yang diambil staf langsung tercatat (kunjungan + tahap). Sesi `bot` yang ditutup tanpa diambil tidak tercatat.
4. Notifikasi ke FO saat sesi masuk kotak masuk **tidak** dibuat (hanya realtime UI); notifikasi hanya ke petugas saat diteruskan.
5. PII: `kunjungan` online menyalin nama/HP/email/instansi dari profil pengunjung. Anonimisasi 0008 mencakup `kunjungan` > 730 hari; isi `chat_pesan` tetap tidak dianonimkan (pertanyaan terbuka 0008).
6. Konflik lama 0003: `kunjungan.chat_sesi_id` `ON DELETE SET NULL` bertentangan dengan CHECK `kunjungan_online_chat_check`. Menghapus `chat_sesi` yang punya kunjungan online akan **gagal** (saat ini tidak ada jalur yang menghapus sesi chat).
7. Konkurensi sejati (dua koneksi) tidak diuji; yang diuji urutan berurutan + penguncian baris.

## 7. Pertanyaan terbuka (untuk CEO)

1. ~~**Kapan dicatat**~~ — **DIJAWAB CEO 2026-10-14: saat eskalasi** (pilihan sekarang; sesi yang tuntas oleh bot tidak dicatat). Pada hari tanpa pelayanan tidak dicatat sama sekali (§2.6).
2. ~~**"Kembali ke bot"**~~ — **DIJAWAB CEO 2026-10-14: fitur dihapus** (tanpa RPC pengganti).
3. **Petugas mengembalikan chat ke FO** (padanan `layanan_kembalikan` untuk chat) belum ada. Perlu?
4. FO lain merebut chat yang sedang ditangani FO lain: kini **ditolak** (`SUDAH_DIAMBIL`; route lama mengizinkan). Hanya Admin (dengan alasan) yang bisa. Setuju?
5. `chat_teruskan` mensyaratkan `layanan.punya_chat = true`. Setuju?
6. Isi pesan penutup dan tautan survei (Tahap E/K13).
7. Notifikasi web push ke FO untuk chat baru di kotak masuk?
