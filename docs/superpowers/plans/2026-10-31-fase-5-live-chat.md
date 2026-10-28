# Fase 5 — Live Chat: Satu Percakapan per Layanan, Bot di Luar Jam, Email ke Petugas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengunjung punya satu percakapan tetap per Layanan (seperti kontak WhatsApp) dengan daftar percakapan dan riwayat penuh; di luar jam operasional Layanan bot tetap menjawab dan email ke petugas hanya dikirim bila pengunjung meminta petugas; kalimat survei Q24 dihapus; `chat_sesi`/`chat_pesan` tidak lagi terbaca semua FO (celah Fase 3).

**Architecture:** Dua migrasi forward. `202610310001` = lingkup baca chat staf (`boleh_chat_sesi`, memakai `staf_lingkup()` Fase 3), penggantian policy baca/ubah `chat_sesi`/`chat_pesan`, RPC `chat_percakapan_saya()` (daftar percakapan). `202610310002` = `chat_layanan_status` (satu fungsi "petugas chat tersedia?" di atas `is_layanan_buka_jadwal`), `chat_minta_petugas` (eskalasi + pesan tunggu + antrean email berdedup), `chat_selesai` (Q24) dan `tutup_chat_tertinggal` (tidak menutup chat yang menunggu petugas selama akhir pekan) sebagai salinan ber-anti-drift. **Percakapan = (pengunjung_id, layanan_id) diturunkan dari `chat_sesi`** — tanpa tabel/kolom baru dan tanpa UPDATE, sehingga seluruh data lama otomatis masuk riwayat (B1). Sesi per kunjungan tetap dibuat seperti sekarang (rekap Fase 3 dan `chat_selesai_khusus` Fase 4 tak tersentuh). Klien: halaman `/chat` menjadi daftar -> percakapan, route messages memuat riwayat lintas sesi dan menegakkan lingkup staf lewat RPC berJWT pengguna, route baru `status` dan `petugas`, bot memakai jadwal per Layanan.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase Postgres + RLS + Realtime, zod 4, Vitest (`--pool=vmForks`), CSS Modules, `@chatscope/chat-ui-kit-react`.

**Spec:** [`docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md`](../specs/2026-10-26-layanan-dinamis-design.md) §2 (B1–B5), §4.4, §6, §7, **§8**. ADR [0003](../../adr/0003-koordinator-dan-akses-data-per-orang.md). Rencana sebelumnya: [Fase 3](2026-10-29-fase-3-koordinator-rekap.md) (celah chat, K7), [Fase 4](2026-10-30-fase-4-pendataan.md).

## Global Constraints

- **B1:** migrasi tanpa `DELETE`/`TRUNCATE`/`DROP TABLE|COLUMN`/`UPDATE` nilai lama. Boleh: fungsi/policy baru, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS`+`CREATE POLICY`, indeks. Percakapan lama tidak dipetakan dengan menulis baris: kunci diturunkan `(pengunjung_id, layanan_id)`.
- **B2:** `202610310001_chat_lingkup_percakapan.sql`, `202610310002_chat_luar_jam.sql` + test kontrak statis masing-masing, sha256 di `MANIFEST.json` (`node scripts/gen-migration-manifest.mjs`), entri `FORWARD_MIGRATION_FILES`. Policy tulis `TO authenticated`; tidak ada `FOR ALL` tanpa `TO`. Setiap `SECURITY DEFINER`: `SET search_path = pg_catalog, public`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, lalu `GRANT EXECUTE` seperlunya; pemanggil dari `auth.uid()`. Salinan fungsi lama diberi tes anti-drift.
- **B3:** role tetap tiga. **B4:** hari/jam WIB (`Asia/Jakarta` di SQL; `src/lib/time.ts` di klien). **B5:** live chat hanya login Google (anon tanpa baris `pengunjung` tetap ditolak RLS).
- **Satu fungsi keputusan jadwal:** "petugas chat tersedia" = `is_layanan_buka_jadwal(layanan, tanggal WIB, jam WIB)` (jadwal per Layanan; kalender global `hari_tanpa_layanan` tidak dipakai lagi oleh chat — `202610310003`).
- Teks pengunjung persis spec: `Mohon menunggu respon dari petugas; petugas akan menjawab pada jam kerja.` Kalimat `Tautan survei kepuasan layanan akan disediakan di sini.` dihapus dari pesan penutup baru dan disaring dari tampilan pesan lama.
- Hormati: rate limit, redaksi PII + deteksi injeksi (`lib/pii.ts`) sebelum LLM, rantai LLM (`lib/llm/registry.ts`), publikasi Realtime (RLS berlaku), CSP (`next.config.ts`; tanpa origin baru).
- Sebelum migrasi diterapkan: aplikasi tidak crash, turun ke perilaku lama (status -> kalender global lama, daftar -> `select chat_sesi`, minta petugas -> 409 `MIGRASI_BELUM_DITERAPKAN` lalu jalur lama, lingkup staf -> aturan TS lama).
- **Dilarang:** menerapkan migrasi, `npm run test:rls`, `node scripts/apply-migration.mjs`, koneksi DB nyata, email nyata, push.
- UI Indonesia, CSS Modules, aksesibel (`role`, label, `aria-live`), daftar percakapan ramah ponsel.

## Inventaris jalur baca data chat (wajib ditegakkan)

| # | Jalur | Data | Penegakan sesudah Fase 5 | Test |
|---|---|---|---|---|
| C1 | RLS `chat_sesi_owner_select` | sesi | pemilik (`pengunjung.auth_user_id = auth.uid()`) ATAU `boleh_chat_sesi(id)` | `chat_lingkup_percakapan.test.ts` |
| C2 | RLS `chat_pesan_owner_select` | pesan | pemilik sesi ATAU `boleh_chat_sesi(sesi_id)` | idem |
| C3 | RLS `chat_sesi_petugas_update` | status sesi | cabang staf = `boleh_chat_sesi(id)` (kolom staf tetap dijaga trigger `CHAT_HARUS_RPC`) | idem |
| C4 | RPC `chat_sesi_ringkas` (invoker) | daftar sesi staf | otomatis mengikuti C1/C2 | idem (pin: tidak diubah) |
| C5 | RPC `chat_percakapan_saya()` (definer) | daftar percakapan pengunjung | hanya baris `auth.uid()` sendiri | idem |
| C6 | `GET /api/chat/messages` (service-role) | pesan satu sesi + riwayat lintas sesi | pengunjung: pemilik sesi; staf: RPC `boleh_chat_sesi` dengan JWT pengguna (fallback aturan TS lama bila RPC belum ada); riwayat = semua sesi `(pengunjung, layanan)` yang sama, hanya bila sesi jangkar lolos | `messages.test.ts` |
| C7 | `POST /api/chat/messages` cabang staf | tulis pesan | `boleh_chat_sesi` + syarat memegang sesi (tetap) | `messages.test.ts` |
| C8 | `POST /api/chat/ai/draft` (service-role) | 5 pesan terakhir | petugas/admin + `boleh_chat_sesi` | `draft.test.ts` |
| C9 | Realtime `chat_sesi`/`chat_pesan` | event | RLS C1/C2; baris yang keluar lingkup tidak terkirim (daftar staf memakai poll lambat 60 dtk sebagai cadangan) | `page.aksi.test.tsx` |
| C10 | `useNavBadges` (count `chat_sesi` eskalasi) | angka | RLS C1 (FO/petugas melihat sesi terbuka = jendela operasional) | (ada) |
| C11 | `GET /api/chat/status` | status jadwal publik | tanpa PII, tanpa auth | `status.test.ts` |
| C12 | `chat_minta_petugas` | tulis pesan sistem + antrean email | hanya pemilik sesi; email tanpa PII | `chat_luar_jam.test.ts` |
| C13 | `kunjungan` identitas chat, `chat_selesai[_khusus]`, rekap | — | tidak berubah (Fase 3/4) | pin di kontrak |

## Keputusan pelaksana

| # | Keputusan (spec diam tentang perilaku terlihat) | Biaya bila keliru |
|---|---|---|
| K1 | **Kunci percakapan = `(pengunjung_id, layanan_id)`** diturunkan dari `chat_sesi` (tanpa tabel/kolom/UPDATE). Sesi lama otomatis menjadi riwayat. | Pengunjung yang dianonimkan (`pengunjung_id` NULL) atau berganti akun Google memulai percakapan baru. |
| K2 | Sesi dipakai ulang selama terbuka (`bot`/`eskalasi`/`aktif`); sesi baru dibuat saat pesan pertama sesudah sesi terakhir `selesai` (ditutup petugas atau otomatis). Sesi bot-saja tidak dirotasi harian. Rekap tidak terpengaruh (berbasis `penanganan`). | Sesi bot bisa berumur panjang; "per kunjungan" untuk survei kelak diturunkan dari `kunjungan`. |
| K3 | **Lingkup chat staf (`boleh_chat_sesi`)**: admin semua; FO+Koordinator semua; Petugas+Koordinator sesi Layanannya; siapa pun yang pernah menangani (`ditangani_oleh` atau `penanganan.penangan_id`); jendela operasional = sesi terbuka (`eskalasi`/`aktif`, `bot` ≤ 7 hari) bagi FO (semua Layanan) dan Petugas (Layanannya). Selain itu tertutup. | FO/Petugas biasa tak bisa lagi membuka chat yang sudah ditutup orang lain; tandai Koordinator bila perlu. |
| K4 | **Riwayat untuk staf:** bila staf boleh membaca satu sesi percakapan, ia melihat seluruh riwayat percakapan itu (semua sesi pengunjung+Layanan sama) — konteks yang diperlukan untuk melayani. | Petugas biasa yang mengambil chat melihat percakapan lama yang ditangani rekan; batasi ke sesi sendiri = satu filter di route. |
| K5 | **(Diubah lead, review akhir)** "Petugas tersedia" untuk chat = jadwal per Layanan (`is_layanan_buka_jadwal`) saja, sesuai spec §4.4 (satu sumber kebenaran): Layanan yang buka Sabtu = buka. Gerbang DB lama "hari tanpa pelayanan" global (`202610140012`) diganti per Layanan di `202610310003` (trigger eskalasi per Layanan sesi, `chat_ambil` per Layanan sesi, `chat_teruskan` per Layanan tujuan; gerbang = Layanan beroperasi sebagian hari itu). | Layanan tanpa jadwal sama sekali hari itu menolak ambil/teruskan; jadwal salah = chat tertutup. |
| K6 | Meminta petugas: tombol "Hubungkan ke Petugas" + deteksi niat konservatif di teks (`mintaPetugas`, tanpa LLM). Jam kerja: eskalasi deterministik (alur lama: kunjungan + kotak masuk FO). Eskalasi otomatis karena bot tak punya jawaban tetap hanya di jam kerja; di luar jam bot tak pernah mengeskalasi sendiri. | Kalimat yang salah dikira meminta petugas mengirim 1 email/sesi; pola dapat dipersempit di satu berkas. |
| K7 | **Penerima email:** petugas aktif role `petugas` di Layanan itu dengan `email_notifikasi` terverifikasi; bila tak ada, FO aktif ber-email terverifikasi; bila tetap tak ada, tidak ada email (hasil RPC `penerima: 0` + log peringatan) dan pengunjung tetap melihat teks tunggu. Dedup `notifikasi.idempotency_key = chat_minta_petugas:<sesi>:<petugas>`; penanda sesi = pesan sistem `minta_petugas_luar_jam`. Isi email tanpa nama/isi pesan pengunjung, hanya Layanan + tautan `/admin/chat?sesi=`. | Petugas tanpa email terverifikasi tak diberi tahu; daftar periksa pemilik. |
| K8 | Pesan tunggu persis spec disimpan sebagai pesan sistem; keterangan "petugas kembali bertugas <hari, tanggal, jam>" hanya di spanduk (dihitung `chat_layanan_status`), bukan di pesan tersimpan. | Bila jadwal berubah, pesan lama tidak basi karena tak memuat tanggal. |
| K9 | Layanan tanpa bot di luar jam: pengunjung boleh meninggalkan pesan; pesan pertama otomatis dianggap permintaan petugas (sekali per sesi). Sebelumnya diblokir pada hari tanpa pelayanan. | Pesan menumpuk sampai jam kerja. |
| K10 | `tutup_chat_tertinggal`: sesi `eskalasi` tidak ditutup otomatis sebelum ada hari operasional Layanan penuh sejak aktivitas terakhir (batas aman 14 hari); sesi `aktif` tetap 24 jam. Pesan tutup otomatis tak lagi menyuruh "mulai chat baru" (percakapan berlanjut). | Chat menunggu petugas bisa >24 jam saat akhir pekan/libur. |
| K11 | Q24: `chat_selesai` diganti (salinan + anti-drift) tanpa kalimat survei; baris lama tidak diubah, disaring di tampilan (`bersihkanPenutup`). Jenis `penutup_survei` dipertahankan sebagai penanda penutup sesi. | Teks lama tetap tersimpan di DB/ekspor. |
| K12 | Persetujuan PDP dicatat saat percakapan PERTAMA dengan sebuah Layanan, bukan tiap sesi. | Naik versi kebijakan perlu fitur persetujuan ulang (belum ada). |
| K13 | "Belum dibaca" per perangkat (`localStorage lmh_chat_dibaca_<layanan>`), bukan lintas perangkat. | Indikator tak sinkron antar perangkat. |
| K14 | Percakapan Layanan yang diarsipkan/tanpa chat: tampil baca-saja di daftar, tidak bisa mengirim. | — |
| K15 | Koordinator mengambil alih chat (K7 Fase 3) **ditunda** (menyalin `chat_ambil` >140 baris); Admin tetap bisa ambil alih. | Koordinator belum bisa ambil alih chat. |
| K16 | Daftar sesi staf: poll cadangan 60 dtk walau Realtime sehat (event untuk baris yang keluar lingkup tak terkirim, mis. chat ditutup rekan). | Daftar bisa tertinggal ≤ 60 dtk. |
| K17 | Spanduk pengunjung memakai status per Layanan; kalender global lama (`hari-tanpa-layanan.ts`) tetap hanya untuk halaman staf dan sebagai cadangan sebelum migrasi. | — |

## Review Focus

1. **FO/Petugas membuka chat di luar lingkup lewat API langsung** (route memakai service-role): `GET/POST messages` dan `draft` memanggil RPC `boleh_chat_sesi` dengan JWT pengguna; FO biasa → sesi tertutup milik FO lain 403. Test route + kontrak.
2. **Kalimat biasa yang menyebut "petugas"** (mis. "syarat menjadi petugas kebersihan") tidak boleh mengirim email; niat harus berupa permintaan berbicara. Test `mintaPetugas`.
3. **Permintaan berulang/serentak di luar jam** → satu pesan sistem dan satu email per (sesi, penerima); klik ganda aman. Test kontrak (kunci sesi `FOR NO KEY UPDATE`, `ON CONFLICT DO NOTHING`, penanda sebelum tulis).
4. **Chat yang menunggu akhir pekan/libur** tidak ditutup otomatis; migrasi belum diterapkan → semua jalur turun ke perilaku lama tanpa crash. Test kontrak + tes klien dengan RPC tak ada.
5. **Pengunjung mengetik saat sesi terakhir `selesai`/belum ada sesi** → sesi baru dibuat dan pesan tidak hilang; gagal membuat sesi → pesan "Gagal terkirim" + "Kirim ulang"; offline tetap diblok. Test halaman.

---

### Task 1: Migrasi 202610310001 — lingkup chat staf + daftar percakapan

**Files:** Create `supabase/migrations/202610310001_chat_lingkup_percakapan.sql`, `supabase/migrations/chat_lingkup_percakapan.test.ts`; Modify `MANIFEST.json`, `migration-test-utils.ts`.

**Interfaces (DB):**
- `boleh_chat_sesi(p_sesi uuid) → boolean` (STABLE, DEFINER; staf aktif saja; aturan K3).
- `chat_percakapan_saya() → TABLE(layanan_id uuid, layanan_nama text, layanan_aktif boolean, punya_chat boolean, chatbot_aktif boolean, jumlah_sesi integer, sesi_terakhir_id uuid, sesi_terbuka_id uuid, status_terakhir text, last_pesan text, last_pesan_at timestamptz, last_pengirim text)` (DEFINER, filter `pengunjung.auth_user_id = auth.uid()`, urut `last_pesan_at` terbaru).
- Indeks `idx_chat_sesi_pengunjung_layanan (pengunjung_id, layanan_id, created_at DESC)`.

- [ ] **Step 1:** Tulis `chat_lingkup_percakapan.test.ts` (`// @vitest-environment node`, pola `selesai_dengan_pendataan.test.ts`): terdaftar tepat sesudah `202610300002`; prasyarat `to_regprocedure('public.staf_lingkup()')`; aditif (tanpa `DELETE|TRUNCATE|DROP TABLE|DROP COLUMN|UPDATE public.`); `boleh_chat_sesi` memuat `staf_lingkup()`, `me.role = 'admin'`, `me.role = 'front_office' AND me.koordinator`, cabang Petugas+Koordinator `s.layanan_id = me.layanan_id`, `s.ditangani_oleh = me.id`, `penanganan` `p.chat_sesi_id = s.id AND p.penangan_id = me.id`, jendela `s.status IN ('eskalasi', 'aktif')` dan `bot` dengan `interval '7 days'`, `SECURITY DEFINER SET search_path = pg_catalog, public`, GRANT hanya `authenticated, service_role`; ketiga policy memakai `TO authenticated`, memanggil `boleh_chat_sesi`, **tidak** memuat `get_my_role() IN ('admin', 'front_office')` maupun `layanan_id = public.get_my_layanan_id()`; tidak ada `FOR ALL`; tidak ada `USING (true)`; `chat_percakapan_saya` memfilter `auth_user_id = auth.uid()`, `GROUP`/`DISTINCT` per `(pengunjung_id, layanan_id)`, tanpa kolom pengunjung lain; pin: `chat_sesi_ringkas` tidak diganti. Jalankan → FAIL.
- [ ] **Step 2:** Tulis migrasi (kepala komentar: isi, syarat/urutan 0001→0002, penerapan pemilik, klien aman sebelum migrasi, idempoten, rollback tidak disediakan karena policy lama dapat dipulihkan dari `202609230001` — cantumkan DDL pemulihan dalam komentar). Generate manifest, tambah `FORWARD_MIGRATION_FILES`, jalankan `npx vitest run --pool=vmForks supabase/migrations` → PASS.
- [ ] **Step 3:** Commit.

### Task 2: Migrasi 202610310002 — status jadwal chat, minta petugas, Q24, tutup otomatis

**Files:** Create `supabase/migrations/202610310002_chat_luar_jam.sql`, `supabase/migrations/chat_luar_jam.test.ts`; Modify `MANIFEST.json`, `migration-test-utils.ts`.

**Interfaces (DB):**
- `chat_layanan_status(p_layanan_id uuid) → jsonb` `{ada, buka, tanggal, hari_tanpa_layanan, libur_keterangan, buka_berikutnya_tanggal, buka_berikutnya_jam}` (STABLE, DEFINER, GRANT `anon, authenticated, service_role`; `buka = NOT hari_tanpa_layanan(tgl) AND is_layanan_buka_jadwal(l, tgl, jam)`; buka berikutnya = hari pertama (≤ 30 hari) yang `NOT hari_tanpa_layanan` dan buka, hari ini hanya bila belum lewat jam mulai).
- `chat_minta_petugas(p_sesi_id uuid, p_eksplisit boolean DEFAULT true) → jsonb` `{ok, buka, status, sudah_diminta, noop, penerima, pesan}` (VOLATILE, DEFINER, GRANT `authenticated`). Galat awal pesan: `FORBIDDEN` (42501, bukan pemilik), `NOT_FOUND` (P0002), `INVALID_STATUS` (P0001, sesi `selesai`), `LAYANAN_TIDAK_VALID` (22023), `RATE_LIMIT` (P0001; hanya `p_eksplisit`, 5 per 60 dtk lewat `anon_rate_limit`).
- `chat_selesai(uuid,uuid,text)` dan `tutup_chat_tertinggal()` = `CREATE OR REPLACE` salinan sumber (0009 §8 / 0012 §10) dengan perubahan eksplisit di bawah.

- [ ] **Step 1:** Tulis `chat_luar_jam.test.ts`: prasyarat (`is_layanan_buka_jadwal(uuid,date,time)`, `hari_tanpa_layanan(date)`, `chat_pesan_sistem`, `chat_ubah_sesi`, `chat_selesai`, `tutup_chat_tertinggal`, `boleh_chat_sesi`); `chat_layanan_status` memanggil `is_layanan_buka_jadwal` dan `hari_tanpa_layanan` dan tidak menghitung jadwal sendiri selain jam mulai; `chat_minta_petugas`: pemilik dari `auth.uid()` + `pengunjung`, `FOR NO KEY UPDATE` pada `chat_sesi` sebelum membaca penanda, status `bot` -> `eskalasi` hanya lewat `chat_ubah_sesi`, `p_eksplisit = false` hanya bertindak bila `status = 'eskalasi'` dan tutup (tidak pernah menaikkan `bot`), penanda `jenis_jawaban = 'minta_petugas_luar_jam'` dicek `NOT EXISTS` sebelum menulis pesan/email, teks tunggu persis `Mohon menunggu respon dari petugas; petugas akan menjawab pada jam kerja.`, email hanya bila tutup, penerima `role = 'petugas' AND layanan_id`, `aktif = true`, `email_notifikasi_verified_at IS NOT NULL`, fallback `front_office`, `INSERT INTO public.notifikasi` dengan `idempotency_key` `'chat_minta_petugas:'` dan `ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`, subjek/isi email tidak memuat `nama`/`isi` pengunjung, rate limit 5/60 hanya eksplisit; **anti-drift `chat_selesai`**: setelah komentar dibuang dan spasi dirapatkan, sama dengan versi `202610140009` kecuali tepat satu blok pesan penutup (teks lama berakhir `Tautan survei kepuasan layanan akan disediakan di sini.` dihapus; `'penutup_survei'` tetap); **anti-drift `tutup_chat_tertinggal`** dari `202610140012` kecuali (a) predikat `WHERE` pemilih sesi dan (b) pemeriksaan ulang setelah kunci mengikuti horizon `eskalasi` (hari operasional penuh, batas 14 hari), (c) teks pesan tutup; `GRANT … tutup_chat_tertinggal TO service_role` tetap. Jalankan → FAIL.
- [ ] **Step 2:** Tulis migrasi (+ manifest, daftar). `npx vitest run --pool=vmForks supabase/migrations` → PASS.
- [ ] **Step 3:** Commit.

### Task 3: Pustaka murni chat

**Files:** Create `src/lib/chat/status-layanan.ts`, `src/lib/chat/minta-petugas.ts`, `src/lib/chat/percakapan.ts` + tes `*.test.ts` di sebelahnya.

**Interfaces (Produces):**
- `status-layanan.ts`: `interface StatusLayananChat { buka: boolean; tanggal: string; liburKeterangan: string | null; hariTanpaLayanan: boolean; bukaBerikutnya: { tanggal: string; jam: string } | null; sumber: 'jadwal' | 'kalender_global' }`; `parseStatusLayanan(data: unknown): StatusLayananChat | null` (bentuk lain/array → null); `muatStatusLayananChat(client: SupabaseClient, layananId: string, now?: Date): Promise<StatusLayananChat>` (RPC `chat_layanan_status`; galat/null → `statusKalenderGlobal` dari `muatInfoHariLayanan` + jam tutup 16:00 lama, `sumber: 'kalender_global'`; tidak pernah melempar); `TEKS_MENUNGGU_PETUGAS`; `teksBukaBerikutnya(s): string` ("Senin, 2 November 2026 pukul 08.00 WIB"); `teksPetugasTidakTersedia(layananNama, s)`; `teksBotLuarJam(s, sebab)` (pengganti `teksBotTanpaPetugas`).
- `minta-petugas.ts`: `mintaPetugas(teks: string): boolean`.
- `percakapan.ts`: `interface PercakapanRingkas {layananId; layananNama; layananAktif; punyaChat; chatbotAktif; jumlahSesi; sesiTerakhirId; sesiTerbukaId; statusTerakhir; lastPesan; lastPesanAt; lastPengirim}`; `dariBarisRpc(rows)`, `dariBarisSesi(rows, namaLayanan)` (cadangan tanpa RPC: kelompok `(layanan_id)`, urut terbaru); `belumDibaca(p, dibacaIso)`; `kunciDibaca(layananId)`; `bacaDibaca/tulisDibaca` (try/catch localStorage); `bersihkanPenutup(isi)` (menghapus kalimat survei lama).

- [ ] **Step 1:** Tes: `parseStatusLayanan` menerima objek RPC lengkap, menolak `[]`/`null`/string; `muatStatusLayananChat` RPC `{error: {code:'PGRST202'}}` → `sumber: 'kalender_global'` (Sabtu tutup, Rabu 10:00 buka, Rabu 16:30 tutup); `teksBukaBerikutnya({tanggal:'2026-11-02', jam:'08:00'})` = `Senin, 2 November 2026 pukul 08.00 WIB`; `mintaPetugas`: benar untuk "saya ingin berbicara dengan petugas loket.", "hubungkan ke petugas", "mau chat sama petugas", "bisa bicara dengan operator?", "minta cs"; salah untuk "syarat menjadi petugas kebersihan", "petugas loket buka jam berapa", "apa tugas petugas", "terima kasih petugas", "" ; `dariBarisSesi` mengelompokkan per layanan, mengambil sesi terbuka terbaru; `belumDibaca` benar hanya bila pengirim terakhir bot/petugas dan lebih baru dari penanda; `bersihkanPenutup('Sesi chat telah selesai. Terima kasih …. Tautan survei kepuasan layanan akan disediakan di sini.')` menghapus kalimat survei saja. FAIL → implementasi → PASS. Commit.

### Task 4: Route `GET /api/chat/status` dan `POST /api/chat/petugas`

**Files:** Create `src/app/api/chat/status/route.ts` (+ `status.test.ts`), `src/app/api/chat/petugas/route.ts` (+ `petugas.test.ts`).

**Interfaces:** `GET ?layanan_id=<uuid>` → `{ status: StatusLayananChat }` (tanpa auth, `Cache-Control: no-store`, 400 bila bukan UUID). `POST {sesi_id}` (auth pengguna; klien berJWT pengguna; RPC `chat_minta_petugas(p_sesi_id, p_eksplisit: true)`) → `{ ok, buka, status, sudah_diminta, noop, penerima, pesan }`; pemetaan galat: `FORBIDDEN` 403, `NOT_FOUND` 404, `INVALID_STATUS` 409, `LAYANAN_TIDAK_VALID` 422, `RATE_LIMIT` 429, objek belum ada → 409 `MIGRASI_BELUM_DITERAPKAN` (`objekBelumAda`, `KODE_MIGRASI_BELUM` dari `src/lib/akses-data/galat.ts`).

- [ ] **Step 1:** Tes: status 400 untuk id bukan UUID; RPC gagal → tetap 200 dengan `sumber: 'kalender_global'`; petugas 401 tanpa user; body tak valid 422; RPC dipanggil dengan argumen persis; tiap kode galat → status HTTP di atas; `PGRST202` → 409 `MIGRASI_BELUM_DITERAPKAN`. FAIL → implementasi → PASS. Commit.

### Task 5: Bot memakai jadwal per Layanan; niat meminta petugas di `/api/chat/ai`

**Files:** Modify `src/lib/llm/bot-waktu.ts` (+ tes), `src/lib/llm/bot.ts`, `src/app/api/chat/ai/route.ts` (+ `ai.test.ts`).

**Interfaces:** `bot-waktu.ts`: `AlasanTutup` ditambah `'di_luar_jadwal'`; `modeDariStatus(s: StatusLayananChat): ModeLayanan` (`tutup = !buka`; alasan: libur → `libur_nasional`, `hariTanpaLayanan` → `akhir_pekan`, selain itu `di_luar_jadwal`; `kerjaBerikutnya = s.bukaBerikutnya?.tanggal ?? null`). `jalankanBot` input menerima `modeLayanan?: ModeLayanan` (bila ada, `muatKalender` dilewati); teks mode luar jam untuk `di_luar_jadwal` = "layanan sedang di luar jam operasional". Route: status dimuat lewat `muatStatusLayananChat` sebelum bot; `hasil.mode.tutup` (bukan `modeHariTanpaLayanan`) menahan eskalasi dan mengganti teks gagal dengan `teksBotLuarJam`; bila `mintaPetugas(rawPertanyaan)` dan `layanan.chatbot_aktif` atau tidak, route memanggil RPC `chat_minta_petugas` (klien JWT pengguna, `p_eksplisit: true`) tanpa memanggil LLM dan menjawab `{jawaban: null, eskalasi: true, reason: 'minta_petugas', pesan, status}`; RPC belum ada → lanjut alur biasa.

- [ ] **Step 1:** Tes: `modeDariStatus` untuk ketiga alasan; `ai.test.ts`: Rabu 16:30 (status tutup) pertanyaan tak terjawab → TIDAK eskalasi, teks luar jam, `chat_ai_log.eskalasi=false`; `mintaPetugas` → RPC dipanggil, `LLM`/`match_faq` tidak; RPC `PGRST202` → alur lama; injeksi prompt di luar jam → tanpa eskalasi; semua tes lama (RPC `[]`) tetap lulus karena `parseStatusLayanan([])` → kalender global. FAIL → implementasi → PASS. Commit.

### Task 6: `/api/chat/messages` riwayat + lingkup staf; `draft`; email implisit

**Files:** Create `src/lib/chat/akses.ts` (+ tes), `src/lib/chat/riwayat.ts` (+ tes); Modify `src/app/api/chat/messages/route.ts` (+ `messages.test.ts`), `src/app/api/chat/ai/draft/route.ts` (+ `draft.test.ts`), `src/app/chat/merge.ts` (`ChatMsg.sesi_id?`).

**Interfaces:**
- `akses.ts`: `bolehAksesSesiStaf(userClient: SupabaseClient, sesiId: string, fallback: () => boolean): Promise<boolean>` (RPC `boleh_chat_sesi`; objek belum ada → `fallback()`; galat lain → false).
- `riwayat.ts`: `muatRiwayatPercakapan(admin, jangkar: {pengunjung_id: string; layanan_id: string}, opsi: {sebelum?: string; limit?: number}): Promise<{ messages: ChatMsg[]; adaLebih: boolean }>` (embed `chat_sesi!inner(pengunjung_id, layanan_id)`, urut `created_at` turun, `limit` default 100 maks 200, mengembalikan urutan naik, kolom `sesi_id` ikut).
- `GET ?sesi_id=&riwayat=1[&sebelum=<iso>][&limit=]` → `{ messages, status, ada_lebih, sesi_terbuka_id }`; tanpa `riwayat` tetap `{ messages, status }` (satu sesi). Cabang staf POST: sesudah syarat memegang sesi, tidak berubah. Cabang pengunjung POST: sesudah insert, bila status `eskalasi`, panggil RPC `chat_minta_petugas(p_eksplisit: false)` dengan klien JWT pengguna (galat apa pun ditelan + dicatat; tidak menggagalkan pengiriman).

- [ ] **Step 1:** Tes: FO biasa + sesi tertutup milik FO lain → RPC false → 403; RPC belum ada → aturan TS lama; pengunjung mengakses riwayat sesinya sendiri → pesan lintas sesi urut naik dengan `sesi_id`; `sebelum` membatasi; `adaLebih` benar bila baris > limit; pengunjung lain → 403; POST pengunjung di sesi `eskalasi` memanggil RPC implisit satu kali, gagalnya tidak mengubah 201; draft: petugas layanan lain 403, RPC false 403. FAIL → implementasi → PASS. Commit.

### Task 7: Halaman pengunjung `/chat`: daftar percakapan, riwayat, sesi malas, luar jam

**Files:** Create `src/app/chat/DaftarPercakapan.tsx` (+ tes), `src/app/chat/daftar.module.css`; Modify `src/app/chat/page.tsx`, tes `page.error.test.tsx`, `page.label.test.tsx`, `page.penutup.test.tsx`, `page.hari-tanpa-layanan.test.tsx` (diganti `page.luar-jam.test.tsx`), `chat.rls.test.tsx` (hanya bila terdampak); Create `src/app/chat/page.percakapan.test.tsx`.

**Interfaces:** `DaftarPercakapan({ items, onBuka, onBaru, memuat, galat, onCobaLagi })`. Page: tampilan `memuat | daftar | baru | percakapan`; daftar dari RPC `chat_percakapan_saya` (galat/tidak ada → `select chat_sesi` + `dariBarisSesi`); daftar kosong → langsung formulir lama ("Mulai Sesi Chat"); `?layanan=` membuka percakapan yang ada atau memilih Layanan di formulir; membuka percakapan memuat `GET /api/chat/messages?sesi_id=<sesi_terakhir>&riwayat=1` (tombol "Muat pesan sebelumnya" bila `ada_lebih`); `sesiId` boleh null: kirim pesan memanggil `pastikanSesi()` (insert `chat_sesi` bila sesi null/`selesai`); spanduk luar jam dari `GET /api/chat/status`; tombol "Hubungkan ke Petugas" memanggil `POST /api/chat/petugas` (409 `MIGRASI_BELUM_DITERAPKAN` → kirim pesan lama ke AI); pesan `penutup_survei` ditampilkan lewat `bersihkanPenutup` sebagai catatan "Sesi selesai" (tanpa judul survei); pesan `minta_petugas_luar_jam` tampil sebagai pesan sistem; localStorage `lmh_chat_sesi_id`/`lmh_chat_layanan_id` tidak dipakai lagi.

- [ ] **Step 1:** Tes baru `page.percakapan.test.tsx`: dua percakapan tampil di daftar dengan pratinjau + penanda "Belum dibaca" (pengirim terakhir bot, lebih baru dari `localStorage`), membuka satu memuat riwayat dari route dengan dua `sesi_id` dan menampilkan keduanya urut; sesi terakhir `selesai` + kirim pesan → insert `chat_sesi` baru lalu POST pesan dengan `sesi_id` baru; insert gagal → pesan berstatus "Gagal terkirim" + "Kirim ulang"; layanan diarsipkan → composer nonaktif dengan alasan; RPC daftar tak ada → daftar dari `select chat_sesi`; daftar kosong → formulir; `?layanan=` untuk layanan yang sudah punya percakapan membukanya. `page.luar-jam.test.tsx`: status tutup → spanduk memuat nama Layanan dan "Senin, 2 November 2026 pukul 08.00 WIB", bot tetap dipanggil, tombol "Hubungkan ke Petugas" ada; klik → POST petugas → teks `Mohon menunggu respon dari petugas; petugas akan menjawab pada jam kerja.` tampil dan tombol hilang; status buka → tidak ada spanduk; Layanan tanpa bot di luar jam → composer aktif (bukan diblok). `page.penutup.test.tsx`: tanpa kata "survei" dan tanpa "tautan". Tes lama yang bergantung pada pemulihan `localStorage` diubah menjadi pembukaan dari daftar. FAIL → implementasi → PASS. Commit.

### Task 8: Halaman admin `/admin/chat`: riwayat percakapan + lingkup

**Files:** Modify `src/app/admin/chat/page.tsx` (+ `page.aksi.test.tsx`, `page.takeover.test.tsx` bila terdampak); Create `src/app/admin/chat/page.riwayat.test.tsx`.

**Interfaces:** `loadMessages({ riwayat?: boolean, sebelum?: string })`: pemilihan sesi memuat `…&riwayat=1`; poll/Realtime hanya sesi terpilih (tanpa `riwayat`); pembatas `role="separator"` "Sesi <tanggal WIB>" saat `sesi_id` berganti (pesan tanpa `sesi_id` = sesi terpilih); tombol "Muat riwayat sebelumnya" bila `ada_lebih`; pesan penutup lewat `bersihkanPenutup`; `useFallbackPoll(fetchSessions, rt, { fastMs: 15000, slowMs: 60000 })`.

- [ ] **Step 1:** Tes: memilih sesi memanggil route dengan `riwayat=1` dan menampilkan dua pembatas sesi; poll berikutnya tanpa `riwayat`; `ada_lebih` memunculkan tombol dan mengambil `sebelum`; pesan penutup lama tak menampilkan kalimat survei; `slowMs` 60000. FAIL → implementasi → PASS. Commit.

### Task 9: Dokumen + gate

**Files:** `docs/MIGRATIONS.md` (bagian Fase 5: urutan sesudah 202610270001, 0002, 202610280001, 202610290001, 0002, 202610300001, 0002 → 202610310001 → 202610310002, perilaku bila belum diterapkan, daftar periksa pemilik: email terverifikasi petugas, uji luar jam, uji FO biasa tak bisa membuka chat orang lain, rollback), `docs/STATUS.md`, `CLAUDE.md` (peta kode chat), `GLOSSARY.md` (**Percakapan**), `docs/analysis/04-RBAC-MATRIX.md` (§9 lingkup chat; celah chat Fase 3 ditutup), `docs/KEBIJAKAN_PDP.md` hanya bila perlu (isi email tanpa PII).

- [ ] **Step 1:** Gate: `npm run lint`, `npm run typecheck`, `npm test` (WalkinPanel.test.tsx flaky di full run: ulang sendiri), `npm run build`, `node scripts/gen-migration-manifest.mjs --check`. Baca diff, pindai secret. Commit.

## Self-review

- Spec §8: percakapan per Layanan + daftar + riwayat (Task 1/3/6/7), sesi per kunjungan tetap (K2, Task 7), riwayat petugas (Task 6/8, K3/K4), luar jam bot + email hanya saat diminta + teks tunggu (Task 2/4/5/7, K5–K9), Q24 (Task 2/7/8, K11), celah Fase 3 (Task 1, C1–C3, C6–C8), Koordinator ambil alih ditunda (K15), lampiran/survei di luar cakupan.
- Spec §4.4: satu fungsi jadwal (`chat_layanan_status` di atas `is_layanan_buka_jadwal`, bot memakainya); batas diketahui K5.
- Tipe konsisten: `StatusLayananChat`, `PercakapanRingkas`, `ChatMsg.sesi_id` dipakai Task 3/5/6/7/8 sesuai definisi Task 3/6.
- `chat_selesai_khusus`, `rekap_pelayanan_inti`, `chat_ambil`, `chat_teruskan` tidak diganti; test pin menjaga ketergantungan kanal Live Chat.

## Catatan pelaksanaan (penyimpangan kecil dari rencana)

- `muatStatusJadwal` (RPC saja, null bila tak ada) dipisah dari `muatStatusLayananChat` (RPC + kalender global lama): `/api/chat/ai` memakai versi pertama agar tanpa migrasi bot tetap memakai `muatKalender` lama persis (semua tes lama utuh).
- `menitWIB()` ditambahkan di `src/lib/time.ts` (jam WIB untuk cadangan kalender global).
- Perkakas uji bersama halaman pengunjung: `src/app/chat/chat.test-utils.ts`; `page.hari-tanpa-layanan.test.tsx` diganti `page.luar-jam.test.tsx` dan `page.percakapan.test.tsx`; `chat.test-utils.ts` hanya diimpor tes.
- Halaman pengunjung: persetujuan PDP hanya pada percakapan pertama per Layanan (K12); keadaan awal menampilkan "Memuat percakapan..." sampai login/daftar diketahui (SSR tidak lagi memuat formulir); `localStorage` `lmh_chat_sesi_id`/`lmh_chat_layanan_id` tidak dipakai lagi.
- Admin: pemuatan riwayat memakai nomor urut sendiri (`riwayatSeq`) agar poll sesi terpilih yang berjalan bersamaan tidak membuangnya.
- Migrasi: 0001/0002 memuat tes kontrak statis saja (SQL tidak dieksekusi: tidak ada database lokal); `chat_selesai` dan `tutup_chat_tertinggal` disalin dari sumber lewat skrip dan dijaga tes anti-drift.

## Perbaikan review akhir (migrasi `202610310003`, `202610310001`/`0002` diubah di tempat karena belum diterapkan)

- **A1** riwayat lintas sesi staf: `chat_boleh_riwayat` (admin, FO Koordinator, petugas Layanan jangkar yang Koordinator/penangan kini) menentukan klien service-role; staf lain memuat dengan klien berJWT (RLS per sesi). Menutup jalur `chat_teruskan` dan jendela operasional FO. Revisi K4.
- **A2** UPDATE `chat_sesi` pemilik-saja (0001; satu-satunya UPDATE staf langsung = route `/api/chat/ai` service-role) + trigger `chat_sesi_jaga_rpc` menolak penggantian `pengunjung_id` di luar RPC (0003).
- **A3** `chat_minta_petugas`: tolak JWT anonim (`LOGIN_GOOGLE`), sesi tanpa pesan pengunjung (`PESAN_WAJIB`), dedup email per percakapan + hari buka berikutnya + penerima (bukan per sesi). Route `/api/chat/petugas` menolak anonim.
- **A4** K5 dibalik (lihat tabel); UI staf (`/admin/chat`, `useNavBadges`) memakai status per Layanan.
- **B** `kunjungan_operasional` (salinan Fase 3 + satu blok): kunjungan `online` dengan penanganan terbuka selalu operasional, jadi identitas chat yang dieskalasi Jumat tetap terbaca Senin.
