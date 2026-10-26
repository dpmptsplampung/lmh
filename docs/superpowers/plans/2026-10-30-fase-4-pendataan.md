# Fase 4 — Pendataan: Pendataan Umum, Pendataan Khusus Dinamis, Topik OSS/Non OSS, Pendataan Saat Selesai Live Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin menyusun Pendataan Khusus per Layanan (7 jenis isian); petugas mengisinya (bersama Pendataan Umum: topik + catatan) saat menyelesaikan tiket layanan non-OSS/Non OSS dan saat menyelesaikan live chat; OSS/Non OSS tetap formulir tetap + pilihan topik; semuanya muncul di Rekap terpadu Fase 3 (kolom Pendataan Khusus, Excel, kanal Live Chat).

**Architecture:** Dua migrasi forward. `202610300001` = tabel `pendataan_khusus_field` (definisi, aturan "pernah diisi" ditegakkan trigger DB) dan `pendataan_khusus_jawaban` (jawaban per **penanganan** = per pelayanan, kunci `field_id` stabil + salinan label/jenis; RLS baca memakai `boleh_data_pelayanan` Fase 3), fungsi internal validasi/simpan, topik awal "Lainnya" bagi Layanan tanpa topik. `202610300002` = RPC pembungkus `layanan_selesai_khusus` dan `chat_selesai_khusus` yang memanggil `layanan_selesai` / `chat_selesai` apa adanya (tanpa menyalin isinya) lalu menyimpan jawaban dan melengkapi identitas pengunjung chat dalam transaksi yang sama. Rekap: fungsi rekap Fase 3 **tidak diganti**; route rekap membaca definisi + jawaban lewat klien pengguna (RLS = lingkup ketat Fase 3) dan menempelkan kolom lewat hook `kolomDataPelayanan(formType, tambahan)`.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase Postgres + RLS, zod 4, ExcelJS, Vitest (`--pool=vmForks`), CSS Modules.

**Spec:** [`docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md`](../specs/2026-10-26-layanan-dinamis-design.md) §2 (B1–B5), §6 (lingkup akses + rekap terpadu), §7. ADR [0002](../../adr/0002-formulir-oss-dan-non-oss-tetap.md), [0003](../../adr/0003-koordinator-dan-akses-data-per-orang.md). Rencana sebelumnya: [Fase 3](2026-10-29-fase-3-koordinator-rekap.md).

## Global Constraints

- **B1:** tidak ada `DELETE`/`TRUNCATE`/`DROP TABLE|COLUMN`/`UPDATE` nilai lama di migrasi. Boleh: tabel/kolom/baris/fungsi/policy/trigger baru, `CREATE OR REPLACE FUNCTION`. Baris `topik_penanganan` baru ("Lainnya") hanya `INSERT`. Data pendataan OSS/Non OSS lama tetap tampil (topik NULL tampil "(tidak tercatat)").
- **B2:** migrasi `202610300001_pendataan_khusus.sql`, `202610300002_selesai_dengan_pendataan.sql` (+ test kontrak statis masing-masing, sha256 di `MANIFEST.json` lewat `node scripts/gen-migration-manifest.mjs`, entri `FORWARD_MIGRATION_FILES`). Policy tulis admin `TO authenticated`; tidak ada `FOR ALL` tanpa `TO`. Setiap `SECURITY DEFINER` memakai `SET search_path = pg_catalog, public`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, lalu `GRANT EXECUTE … TO authenticated` hanya untuk RPC yang dipanggil klien.
- **B3:** role tetap tiga. **B4:** WIB lewat `src/lib/time.ts`. **B5:** chat login Google (identitas dari profil `pengunjung`).
- Jenis isian (persis spec §7): `teks_singkat`, `teks_panjang`, `angka`, `tanggal`, `pilihan_tunggal`, `pilihan_ganda`, `ya_tidak`; wajib/opsional; **tanpa unggah berkas**.
- Isian yang pernah diisi: label dan urutan boleh diubah, **tidak bisa dihapus** (hanya `tersembunyi` = tidak muncul di formulir baru), **jenis tidak bisa diubah** — ditegakkan di DB (trigger), bukan hanya UI.
- Pendataan Khusus **tidak menanyakan ulang identitas** (UI Admin memberi petunjuk; identitas = Pendataan Umum).
- Lingkup baca jawaban = persis Fase 3 (`boleh_data_pelayanan`): admin semua; FO+Koordinator semua; Petugas+Koordinator tahap `layanan` di Layanannya; selain itu hanya penangan = dirinya. Tanpa jendela operasional.
- Sebelum migrasi diterapkan: aplikasi tidak error — fitur Khusus/identitas chat tersembunyi, alur lama (`layanan_selesai`, `chat_selesai`) tetap; route Admin Khusus menjawab 409 `MIGRASI_BELUM_DITERAPKAN`.
- **Dilarang:** menerapkan migrasi, `npm run test:rls`, `node scripts/apply-migration.mjs`, koneksi DB nyata, push.
- UI Indonesia, CSS Modules, aksesibel (label terhubung, penanda wajib, `role="alert"`).

## Inventaris jalur baca (wajib ditegakkan)

| # | Jalur | Data | Penegakan | Test |
|---|---|---|---|---|
| P1 | RLS `pendataan_khusus_jawaban_select` → `boleh_baca_khusus(penanganan_id)` → `boleh_data_pelayanan` | jawaban Pendataan Khusus | admin; FO Koordinator; Petugas Koordinator tahap layanannya; penangan = dirinya. Tanpa INSERT/UPDATE/DELETE untuk `authenticated` (tulis hanya lewat fungsi definer) | `pendataan_khusus.test.ts` |
| P2 | RLS `pendataan_khusus_field_select` | definisi isian (bukan data pengunjung) | staf aktif (`peran_saya()` admin/petugas/front_office); tulis admin saja | idem |
| P3 | Rekap `data` + ekspor Excel (`lampirkanKhusus`) | jawaban untuk baris halaman | klien pengguna membaca `pendataan_khusus_jawaban` (P1) hanya untuk `pelayanan_id` yang sudah lolos `rekap_data_pelayanan` (lingkup ketat); service-role tidak dipakai | `terpadu.test.ts`, `export.test.ts` |
| P4 | `layanan_selesai_khusus`, `chat_selesai_khusus` | tulis jawaban + identitas | memanggil `layanan_selesai`/`chat_selesai` lebih dulu (peran, sesi, kepemilikan ditegakkan di sana); galat sesudahnya membatalkan seluruh transaksi | `selesai_dengan_pendataan.test.ts` |
| P5 | Identitas pengunjung chat (`kunjungan`) | PII | hanya ditulis `chat_selesai_khusus` oleh pemilik tahap; dibaca via RLS `boleh_kunjungan` (Fase 3) | idem |
| P6 | `GET /api/admin/layanan/[id]/pendataan-khusus` | definisi | `requireAdmin` | `pendataan-khusus.route.test.ts` |
| P7 | Rekap Harian / Kinerja | agregat | **tidak berubah**: chat selesai = tahap `penanganan` `saluran='chat'` → kanal `live_chat` (Fase 3, satu definisi "dilayani") | `selesai_dengan_pendataan.test.ts` (pin) |

## Keputusan pelaksana

| # | Keputusan (spec diam tentang perilaku terlihat) | Biaya bila keliru |
|---|---|---|
| K1 | **Sumber topik = `topik_penanganan` per Layanan yang sudah ada** (dikelola Admin di `/admin/topik`; FO memakai topik FO `layanan_id IS NULL`). Layanan tanpa satu pun topik (semua Layanan baru Fase 1) otomatis diberi topik "Lainnya" (backfill + trigger Layanan baru) agar petugas tidak buntu di `TOPIK_WAJIB`. | Admin melihat satu topik tambahan "Lainnya"; ganti nama/nonaktifkan lewat `/admin/topik`. |
| K2 | Topik di langkah selesai OSS/Non OSS **wajib di UI bila Layanan punya topik aktif**; **DB tetap opsional** (kontrak 202610140015, klien lama). Ini menggantikan keputusan CEO 2026-10-15 "tanpa topik" sesuai Q46. | Klien yang memanggil API langsung dapat menyelesaikan tanpa topik (tampil "(tidak tercatat)"); mewajibkan di DB = mengganti `layanan_selesai` (migrasi baru + anti-drift). |
| K3 | Pendataan Khusus **tidak berlaku bagi Layanan ber-formulir tetap** (`layanan.form_pendataan` terisi). Trigger menolak menambah isian untuk Layanan itu (`LAYANAN_FORMULIR_TETAP`); UI Admin menyembunyikannya. | Admin yang ingin menambah isian di OSS/Non OSS harus minta perubahan kode (ADR 0002). |
| K4 | Jawaban disimpan **hanya saat menyelesaikan** (tanpa draf) dan terikat ke **tahap penanganan** (= satu pelayanan). Tiket lama tanpa tahap tidak punya Pendataan Khusus. Setelah tersimpan jawaban **tidak dapat diubah** (tanpa koreksi di Fase 4). | Salah ketik tidak bisa dikoreksi lewat UI; perlu fitur koreksi (fase lanjut). |
| K5 | Pilihan (`opsi`) = daftar teks 2–20 butir (maks 100 karakter, unik). Jawaban menyimpan **teks pilihan** yang dipilih; mengubah/menghapus butir opsi tidak mengubah jawaban lama. | Header/opsi baru tidak otomatis memetakan ulang jawaban lama. |
| K6 | Batas: label 2–100; teks singkat ≤200; teks panjang ≤2000; angka bilangan berhingga |nilai| ≤ 1e12; tanggal `YYYY-MM-DD` valid; maksimal 40 isian per Layanan. | Mengubah batas = migrasi. |
| K7 | **Identitas chat:** diisi dari profil saat kunjungan chat dibuat; saat selesai petugas boleh melengkapi/mengoreksi nama, HP, email, asal instansi, kategori, keperluan (kosong = tidak diubah; format sama dengan walk-in FO; semuanya opsional). Profil `pengunjung` tidak diubah; `audit_log` mencatat **nama field** yang berubah (bukan nilainya). | Petugas dapat menimpa data profil di kunjungan itu; bila tidak diinginkan, jadikan baca-saja. |
| K8 | **Chat diselesaikan oleh FO (tahap `fo`)** = Pendataan Umum saja (identitas + topik FO + catatan ≤200); Pendataan Khusus hanya untuk tahap `layanan` (FO tidak punya Layanan). Mengirim jawaban Khusus pada tahap FO ditolak `KHUSUS_TIDAK_BERLAKU`. | Chat Layanan X yang ditutup FO tidak punya Khusus; FO sebaiknya meneruskan dulu. |
| K9 | Rekap: kolom Khusus hanya muncul **bila satu Layanan dipilih**; isian tersembunyi **hanya bila pernah diisi**; header memakai label **saat ini** (salinan label tersimpan di DB); ya/tidak → "Ya"/"Tidak"; pilihan ganda digabung "; "; tanggal berformat Indonesia. | Setelah label diubah, header ekspor berganti nama untuk data lama juga. |
| K10 | Kanal Live Chat tidak butuh kolom baru: tahap chat yang selesai sudah `saluran='chat'` → `live_chat` di fungsi rekap Fase 3 (K4 Fase 3). Fase 4 melengkapi isinya (identitas, topik, Khusus). | — |
| K11 | Urutan isian diatur lewat `PUT …/pendataan-khusus` `{urutan: uuid[]}` (bukan seret-lepas). | Hanya UX pengurutan. |
| K12 | Admin yang menyelesaikan tiket/chat mengikuti aturan sama (wajib Khusus). | — |

## Review Focus

1. **Mengubah jenis / menghapus isian yang pernah diisi lewat API langsung** (bukan UI) → ditolak trigger DB (`JENIS_TERKUNCI`, `SUDAH_DIISI`); Admin balapan dengan petugas yang sedang menyimpan → validasi memakai `FOR SHARE` pada baris isian. Test: kontrak migrasi + route 409.
2. **Petugas biasa/Koordinator Layanan lain membaca jawaban** → hanya lewat `boleh_data_pelayanan`; tidak ada GRANT tulis ke `authenticated`. Test kontrak.
3. **Isian wajib kosong / spasi / array kosong / angka berupa string / pilihan di luar opsi / kunci tak dikenal** → `KHUSUS_WAJIB`/`KHUSUS_TIDAK_VALID`, tidak ada jawaban parsial tersimpan. Test: `jawaban.test.ts` + kontrak.
4. **Chat ditutup tahap FO dengan jawaban Khusus; tiket lama tanpa tahap** → `KHUSUS_TIDAK_BERLAKU` / diabaikan tanpa galat. Test kontrak.
5. **Migrasi belum diterapkan** → modal selesai, dialog chat, rekap, route Admin tidak error. Test komponen + route.
6. **Isian tersembunyi** tidak muncul di formulir baru tetapi kolomnya tetap ada di rekap bila pernah diisi. Test `kolomKhusus`.

---

### Task 1: Migrasi 202610300001 — definisi dan jawaban Pendataan Khusus

**Files:** Create `supabase/migrations/202610300001_pendataan_khusus.sql`, `supabase/migrations/pendataan_khusus.test.ts`; Modify `supabase/migrations/MANIFEST.json`, `migration-test-utils.ts`.

**Interfaces (DB):**
- `pendataan_khusus_field(id uuid pk, layanan_id uuid NOT NULL → layanan ON DELETE CASCADE, label text, jenis text, wajib boolean, opsi jsonb, urut integer, tersembunyi boolean, pernah_diisi boolean, created_at, updated_at)`.
- `pendataan_khusus_jawaban(id uuid pk, penanganan_id uuid → penanganan ON DELETE RESTRICT, field_id uuid → field ON DELETE RESTRICT, nilai jsonb, label_snapshot text, jenis_snapshot text, diisi_oleh uuid, created_at; UNIQUE(penanganan_id, field_id))`.
- `boleh_baca_khusus(p_penanganan uuid) → boolean`; `pendataan_khusus_validasi(p_layanan uuid, p_jawaban jsonb) → jsonb` (array `{field_id,label,jenis,nilai}`); `pendataan_khusus_simpan(p_penanganan uuid, p_layanan uuid, p_jawaban jsonb, p_oleh uuid) → integer` (internal, tanpa GRANT klien).
- Galat (awal pesan, ERRCODE 22023 kecuali dicatat): `LAYANAN_FORMULIR_TETAP`, `OPSI_TIDAK_VALID`, `ISIAN_TERLALU_BANYAK`, `JENIS_TERKUNCI` (23514), `SUDAH_DIISI` (23503), `LAYANAN_TETAP` (layanan_id tak boleh berubah), `KHUSUS_WAJIB`, `KHUSUS_TIDAK_VALID` (DETAIL = id isian).

- [ ] **Step 1:** Tulis `pendataan_khusus.test.ts` (kontrak statis; `// @vitest-environment node`): aditif (tanpa DELETE/TRUNCATE/DROP TABLE|COLUMN/UPDATE kolom lama di luar fungsi definer; satu-satunya `UPDATE` di luar fungsi adalah tidak ada); `CHECK jenis IN` ketujuh jenis tepat; trigger `BEFORE UPDATE` menolak ubah `jenis` bila `OLD.pernah_diisi` dan menolak ubah `layanan_id`; trigger `BEFORE DELETE` menolak bila `pernah_diisi` atau ada jawaban; `AFTER INSERT` jawaban menandai `pernah_diisi`; FK jawaban `ON DELETE RESTRICT`; policy tulis `TO authenticated` memakai `peran_saya() = 'admin'`, tidak ada `FOR ALL`; `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT SELECT` saja pada jawaban; policy select jawaban memanggil `boleh_baca_khusus`, yang memanggil `boleh_data_pelayanan(p.peran_tahap, p.layanan_id, p.penangan_id)`; validasi memakai `FOR SHARE`, menolak kunci tak dikenal, memeriksa ketujuh jenis, wajib; topik awal "Lainnya" lewat `INSERT … WHERE NOT EXISTS` + trigger `AFTER INSERT ON layanan`; prasyarat `to_regprocedure('public.boleh_data_pelayanan(text,uuid,uuid)')`; terdaftar tepat sesudah `202610290002`. Jalankan → FAIL.
- [ ] **Step 2:** Tulis migrasi (komentar kepala: isi, galat, syarat/urutan, penerapan pemilik, klien aman sebelum migrasi, idempoten, rollback tidak disediakan karena aditif). Generate manifest, tambah `FORWARD_MIGRATION_FILES`. Jalankan `npx vitest run --pool=vmForks supabase/migrations` → PASS.
- [ ] **Step 3:** Commit.

### Task 2: Migrasi 202610300002 — selesai dengan Pendataan (tiket + chat)

**Files:** Create `supabase/migrations/202610300002_selesai_dengan_pendataan.sql`, `supabase/migrations/selesai_dengan_pendataan.test.ts`; Modify `MANIFEST.json`, `migration-test-utils.ts`.

**Interfaces (DB):**
- `layanan_selesai_khusus(p_tiket_id uuid, p_topik_id uuid, p_catatan text, p_khusus jsonb DEFAULT NULL) → jsonb` = hasil `layanan_selesai` + `khusus_tersimpan integer`.
- `chat_selesai_khusus(p_sesi_id uuid, p_topik_id uuid, p_catatan text, p_khusus jsonb DEFAULT NULL, p_identitas jsonb DEFAULT NULL) → jsonb` = hasil `chat_selesai` + `khusus_tersimpan`, `identitas_diubah text[]`.
- `pendataan_identitas_validasi(p jsonb) → jsonb` (internal). Kunci diizinkan: `nama`, `kontak_hp`, `email`, `asal_instansi`, `kategori`, `keperluan`; aturan = `fo_mulai_kunjungan` 202610140015 (nama 3–100 huruf; HP kanonik `^08[1-9][0-9]{7,10}$`; email regex ≤254; instansi 3–120; kategori ∈ Umum|UMKM|Investor|Instansi; keperluan 10–500). Galat `DATA_TIDAK_VALID` (DETAIL = kunci). Tambahan `KHUSUS_TIDAK_BERLAKU`.

- [ ] **Step 1:** Test kontrak: kedua RPC `VOLATILE SECURITY DEFINER SET search_path`, `GRANT EXECUTE … TO authenticated` saja; **anti-drift: tidak menyalin isi** — masing-masing memanggil `public.layanan_selesai(`/`public.chat_selesai(` dan tidak memuat `UPDATE public.penanganan`/`UPDATE public.tiket_antrean`; pemanggilan `layanan_selesai` dengan `NULL::text, NULL::jsonb`; simpan hanya bila `penanganan_id` ada; chat: tahap `fo` + jawaban tak kosong → `KHUSUS_TIDAK_BERLAKU`; `audit_log` mencatat nama field; `UPDATE public.kunjungan` hanya kolom identitas + `updated_at`; pin: `rekap_pelayanan_inti` (0002 Fase 3) masih memuat `p.saluran = 'chat' THEN 'live_chat'` (chat selesai tetap terhitung). Jalankan → FAIL.
- [ ] **Step 2:** Tulis migrasi + manifest + daftar. PASS. Commit.

### Task 3: Pustaka Pendataan Khusus (murni)

**Files:** Create `src/lib/pendataan-khusus/{jenis.ts,schemas.ts,jawaban.ts,galat.ts}` + tes `jawaban.test.ts`, `schemas.test.ts`, `galat.test.ts`.

**Interfaces (Produces):**
- `jenis.ts`: `JENIS_KHUSUS` (tuple), `type JenisKhusus`, `LABEL_JENIS: Record<JenisKhusus,string>`, `jenisButuhOpsi(j)`, `interface FieldKhusus {id; layanan_id; label; jenis; wajib; opsi: string[]; urut; tersembunyi; pernah_diisi}`, `type NilaiKhusus = string | number | boolean | string[]`, konstanta batas (K6).
- `schemas.ts`: `fieldBaruSchema` (label, jenis, wajib?, opsi?), `fieldUbahSchema` (label?, wajib?, opsi?, tersembunyi?; `.strict()`), `urutanSchema` (`{urutan: uuid[]}`); aturan opsi (2–20, unik, ≤100, hanya untuk pilihan_*).
- `jawaban.ts`: `validasiJawabanKhusus(fields: FieldKhusus[], mentah: Record<string, unknown>): { galat: Record<string,string>; payload: Record<string, NilaiKhusus> }` (kosong opsional dilewati; wajib kosong → pesan "wajib diisi"; semantik = fungsi DB); `formatNilaiKhusus(f: Pick<FieldKhusus,'jenis'>, nilai: unknown): string | number | null` (K9).
- `galat.ts`: `kodeGalatKhusus(e: unknown): KodeGalatKhusus | null`, `PESAN_GALAT_KHUSUS`.

- [ ] **Step 1:** Tes: wajib teks spasi → galat; angka dari string ditolak; `pilihan_ganda` kosong wajib → galat, di luar opsi → galat; `ya_tidak` `false` dianggap terisi; tanggal `2026-02-30` ditolak; payload hanya memuat yang terisi dan teks di-trim; `formatNilaiKhusus` (Ya/Tidak, "; ", tanggal id-ID); skema ubah menolak `jenis` dan kunci asing; opsi duplikat ditolak. FAIL → implementasi → PASS. Commit.

### Task 4: API Admin Pendataan Khusus

**Files:** Create `src/app/api/admin/layanan/[id]/pendataan-khusus/route.ts` (GET daftar, POST tambah, PUT urutan), `.../pendataan-khusus/[fieldId]/route.ts` (PATCH, DELETE), `pendataan-khusus.route.test.ts`.

**Interfaces:** semua `requireAdmin()`; klien pengguna (RLS admin). GET → `{ form_tetap: boolean, isian: FieldKhusus[] }`. POST 201 `{ isian }`. PATCH body `fieldUbahSchema`. Galat: 409 `JENIS_TERKUNCI`/`SUDAH_DIISI`/`LAYANAN_FORMULIR_TETAP` (pesan Indonesia); 409 `MIGRASI_BELUM_DITERAPKAN` (`objekBelumAda`, `src/lib/akses-data/galat.ts`); 422 validasi; 404.

- [ ] **Step 1:** Tes route: bukan admin → 403; body tak valid → 422; PATCH `jenis` ditolak 422 (skema) dan galat DB `JENIS_TERKUNCI` dipetakan 409; DELETE isian terisi → 409 `SUDAH_DIISI`; tabel belum ada → 409 `MIGRASI_BELUM_DITERAPKAN`; Layanan ber-formulir → 409. FAIL → implementasi (urutan `urut` = indeks) → PASS. Commit.

### Task 5: Halaman Admin Pendataan Khusus

**Files:** Create `src/app/admin/layanan/[id]/pendataan/page.tsx`, `pendataan.module.css`, `PendataanKhususEditor.tsx`, `pendataan.test.tsx`; Modify `src/app/admin/layanan/page.tsx` (tautan "Pendataan Khusus" per baris).

**Interfaces:** `PendataanKhususEditor({ layananId })` memuat GET, menambah/mengubah/menyembunyikan/menghapus/mengurutkan isian lewat Task 4; jenis tidak dapat diubah pada isian `pernah_diisi` (select nonaktif + keterangan), tombol Hapus nonaktif bagi isian terisi (hanya "Sembunyikan"); Layanan `form_tetap` menampilkan keterangan formulir tetap tanpa editor; petunjuk "Identitas pengunjung sudah dicatat Front Office; jangan menanyakannya lagi."

- [ ] **Step 1:** Tes komponen: isian terisi → jenis nonaktif dan Hapus tidak ada; Layanan formulir tetap → tanpa editor; 409 migrasi → pesan jelas; label terhubung dan galat `role="alert"`. FAIL → implementasi → PASS. Commit.

### Task 6: Selesai tiket Layanan non-OSS dengan Pendataan Umum + Khusus

**Files:** Create `src/components/admin/PendataanKhususFields.tsx` (+ `.test.tsx`; berisi `useFieldKhusus(layananId, aktif)` dan komponen `PendataanKhususFields`); Modify `src/components/admin/SelesaiEskalasiModal.tsx` (+ tes), `src/lib/pelayanan.ts` (kode galat `KHUSUS_WAJIB`, `KHUSUS_TIDAK_VALID`, `KHUSUS_TIDAK_BERLAKU`).

**Interfaces:** `useFieldKhusus(layananId: string | null, aktif?: boolean) → { fields: FieldKhusus[]; memuat: boolean; tersedia: boolean }` (`tersedia=false` bila tabel belum ada; `fields` = non-tersembunyi urut `urut`). `PendataanKhususFields({ idDasar, fields, nilai, onNilai, galat, disabled })` merender: teks singkat `input`, panjang `textarea`, angka `input type=number`, tanggal `type=date`, tunggal `select`, ganda `fieldset` checkbox, ya/tidak radio; label + penanda wajib + `role="alert"`.

- [ ] **Step 1:** Tes `SelesaiEskalasiModal`: Layanan tanpa isian → memanggil `layanan_selesai` (tidak berubah); dengan isian → `layanan_selesai_khusus` dengan `p_khusus` berisi hanya jawaban terisi; wajib kosong tidak mengirim dan menandai field; `tersedia=false` → alur lama. FAIL → implementasi → PASS. Commit.

### Task 7: Topik di langkah selesai OSS/Non OSS

**Files:** Modify `src/components/admin/PelayananWizardModal.tsx` (+ `PelayananWizardModal.test.tsx`).

- [ ] **Step 1:** Tes: langkah 3 menampilkan "Topik penanganan" (`useTopikLayanan(initialData.layanan_id)`); bila Layanan punya topik dan belum dipilih → galat `topik_id` di langkah 3 dan tidak POST; terpilih → body POST memuat `topik_id` sedangkan isi formulir tidak berubah; tanpa topik aktif → tidak wajib dan `topik_id` tidak dikirim; baca-saja tidak menampilkan pilihan. FAIL → implementasi (route sudah menerima `topik_id`; tidak ada perubahan route) → PASS. Commit.

### Task 8: Live chat — Pendataan Umum + Khusus saat selesai

**Files:** Modify `src/lib/chat-staf.ts` (tipe aksi `selesaikan` + `khusus?`, `identitas?`, kode galat baru), `src/app/api/chat/sesi/route.ts` (+ `sesi.test.ts`), `src/components/admin/ChatAksiDialog.tsx` (`ChatSelesaiDialog`; + tes `page.aksi.test.tsx` bila perlu). Create `src/components/admin/IdentitasPengunjungFields.tsx` (+ tes).

**Interfaces:** body `selesaikan` menerima `khusus?: Record<string, unknown>` dan `identitas?: {nama?, kontak_hp?, email?, asal_instansi?, kategori?, keperluan?}` (zod `.strict()`); bila salah satunya ada route memanggil `chat_selesai_khusus`, selain itu `chat_selesai` (jalur lama tidak berubah); migrasi belum ada → 409 `MIGRASI_BELUM_DITERAPKAN`. `ChatSelesaiDialog` memuat kunjungan `chat_sesi_id = sesiId` (kolom identitas) untuk prapengisian dan `useFieldKhusus(layananId, peran === 'layanan')`; blok identitas + Khusus hanya tampil bila `tersedia`.

- [ ] **Step 1:** Tes route: tanpa `khusus`/`identitas` → RPC `chat_selesai` (argumen lama); dengan → `chat_selesai_khusus`; `KHUSUS_WAJIB`/`KHUSUS_TIDAK_VALID`/`KHUSUS_TIDAK_BERLAKU`/`DATA_TIDAK_VALID` → 422 dengan kode; objek belum ada → 409. Tes dialog: identitas terprapengisi dari profil; peran `fo` tanpa isian Khusus; Layanan dengan isian wajib memblokir kirim; `tersedia=false` → hanya topik + catatan. FAIL → implementasi → PASS. Commit.

### Task 9: Rekap — kolom Pendataan Khusus + Excel

**Files:** Create `src/lib/rekap/khusus.ts` (+ `khusus.test.ts`), `src/lib/rekap/khususServer.ts`; Modify `src/lib/rekap/terpadu.ts` (`BarisPelayanan.khusus?`), `src/app/api/admin/rekap/terpadu/route.ts`, `.../export/route.ts` (+ tes), `src/app/admin/rekap/page.tsx` (+ tes).

**Interfaces:** `kolomKhusus(fields: FieldKhusus[]): KolomData[]` (kunci `khusus_<id>`, judul label; isian tersembunyi hanya bila `pernah_diisi`; urut `urut` lalu pembuatan); `lampirkanKhusus(rows: BarisPelayanan[], jawaban: Map<string, Record<string, NilaiKhusus>>): BarisPelayanan[]`. Server: `muatFieldKhusus(supabase, layananId): Promise<FieldKhusus[]>`, `muatJawabanKhusus(supabase, pelayananIds: string[]): Promise<Map<…>>` (klien pengguna, potong 100 id per kueri; `objekBelumAda` → kosong). Route `data` menambah `kolom_khusus: FieldKhusus[]` dan `khusus` per baris hanya bila `layanan_id` dipilih dan sumber `penanganan`; export memakai `kolomDataPelayanan(formType, kolomKhusus(fields))`. Halaman: `kolomDataPelayanan(form_type, kolomKhusus(kolom_khusus))`.

- [ ] **Step 1:** Tes: `kolomKhusus` menyembunyikan tersembunyi-tak-terisi, menyertakan tersembunyi-terisi; format sel per jenis; `lampirkanKhusus` tak mengubah baris tanpa jawaban; route `data` tanpa `layanan_id` → tanpa kolom Khusus dan tanpa kueri jawaban; dengan `layanan_id` → kueri memakai klien pengguna (bukan service-role) dengan `penanganan_id IN (pelayanan_id baris)`; tabel belum ada → rekap tetap 200 tanpa kolom; Excel memuat kolom Khusus. FAIL → implementasi → PASS. Commit.

### Task 10: Dokumen + gate

**Files:** `docs/MIGRATIONS.md` (urutan sesudah 202610270001, 0002, 202610280001, 202610290001, 0002 → 202610300001 → 202610300002; daftar periksa pemilik), `docs/STATUS.md`, `CLAUDE.md` (peta kode), `GLOSSARY.md` (pertajam Pendataan Umum/Khusus bila perlu), `docs/analysis/04-RBAC-MATRIX*.md` bila memuat tabel hak per tabel.

- [ ] **Step 1:** Gate: `npm run lint`, `npm run typecheck`, `npm test` (WalkinPanel.test.tsx flaky di full run: ulang sendiri), `npm run build`, `node scripts/gen-migration-manifest.mjs --check`. Baca diff, pindai secret. Commit.

## Self-review

- Spec §7: Umum (Task 6/7/8: topik + catatan semua Layanan; identitas FO + chat), Khusus (Task 1/4/5/6/8), OSS/Non OSS tetap + topik (Task 7), Layanan lain di alur selesai (Task 6), Live chat + kanal (Task 2 pin P7/8), rekap + Excel (Task 9). Spec §6 lingkup: P1/P3.
- Tipe konsisten: `FieldKhusus`, `NilaiKhusus`, `useFieldKhusus` dipakai Task 6/8/9 sesuai definisi Task 3/6.
- Tidak ada tugas yang mengganti `layanan_selesai`, `chat_selesai`, `rekap_pelayanan_inti`, `rekap_data_pelayanan` (tanpa anti-drift salinan); test pin menjaga ketergantungan.

## Catatan pelaksanaan (penyimpangan kecil dari rencana)

- Editor Admin berada di `src/components/admin/layanan/PendataanKhususEditor.tsx` (halaman `src/app/admin/layanan/[id]/pendataan/page.tsx` tipis); tombol "Pendataan Khusus" di tabel Kelola Layanan hanya untuk Layanan tanpa formulir tetap.
- Kode galat Khusus ada di `src/lib/pendataan-khusus/galat.ts` (bukan `src/lib/pelayanan.ts`); identitas chat: `src/lib/pendataan-khusus/identitas.ts` + `components/admin/IdentitasPengunjungFields.tsx`; `susunJawabanMentah` (string formulir -> jawaban bertipe) ditambahkan di `jawaban.ts`.
- K9 header kolom rekap diberi awalan `[Khusus] ` (selaras `[OSS]`/`[Non OSS]`) agar tidak bentrok dengan kolom Pendataan Umum.
- Jawaban rekap dibaca per 100 id dengan paging 1000 baris (batas PostgREST); galat selain "tabel belum ada" menjadi 500 (bukan kolom kosong diam-diam).
- Tes tambahan: `PelayananWizardModal.topik.test.tsx`, `ChatSelesaiDialog.khusus.test.tsx`, `src/app/api/admin/rekap/terpadu/khusus.route.test.ts`, `PendataanKhususFields.test.tsx`, `SelesaiEskalasiModal.test.tsx`.
