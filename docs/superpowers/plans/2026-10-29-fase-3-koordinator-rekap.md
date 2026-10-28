# Fase 3 — Koordinator, Akses Data per Orang, Ambil Alih Pendataan, Rekap Terpadu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Penanda Koordinator pada akun FO/Petugas Layanan; data pelayanan hanya terlihat sesuai lingkup §6.1 di setiap jalur baca; Koordinator dapat mengambil alih pendataan yang berjalan di unitnya; satu halaman Rekap (Rekap Harian, Data Pelayanan, Kinerja Petugas) dengan satu definisi "dilayani".

**Architecture:** Dua migrasi forward. `202610290001` menambah kolom `petugas.koordinator`, helper lingkup (`staf_lingkup`, `boleh_data_pelayanan`, `kunjungan_operasional`), mengganti isi helper RLS `boleh_penanganan`/`boleh_kunjungan` dan policy baca `pelayanan_oss`/`pelayanan_perizinan`/`rekap_harian_layanan` (membalik `202610140013`), tabel `ambil_alih_pendataan`, RPC ambil alih + pemberitahuan. `202610290002` menambah RPC rekap SECURITY DEFINER (`rekap_data_pelayanan`, `rekap_harian_terpadu`, `rekap_kinerja_petugas`, `lingkup_data_saya`) yang menegakkan lingkup **ketat** sendiri (tanpa jendela operasional). Aplikasi membaca rekap hanya lewat RPC itu dari route `api/admin/rekap/terpadu[/export]`; route rekap lama dihapus. Sebelum migrasi diterapkan: route rekap menjawab 409 `MIGRASI_BELUM_DITERAPKAN`, fitur lain turun ke perilaku lama.

**Tech Stack:** Next.js 16 App Router (`redirect` dari `next/navigation` di server component, pola `src/app/admin/fo/daftar/page.tsx`), React 19, Supabase Postgres + RLS, zod 4, ExcelJS, Vitest (`--pool=vmForks`), CSS Modules.

**Spec:** [`docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md`](../specs/2026-10-26-layanan-dinamis-design.md) §2 (B1–B5) dan §6. ADR [0003](../../adr/0003-koordinator-dan-akses-data-per-orang.md).

## Global Constraints

- **B1:** data lama tidak diubah/dihapus. Boleh: kolom/tabel/fungsi/policy baru, `CREATE OR REPLACE FUNCTION`, `DROP POLICY`+`CREATE POLICY`. Dilarang: `DELETE`, `TRUNCATE`, `DROP TABLE/COLUMN`, `UPDATE` nilai lama (kecuali di dalam RPC yang memang mengubah status operasional, pola `admin_ambil_alih`). `rekap_harian_layanan`, `laporan_snapshot` tetap ada.
- **B2:** migrasi `202610290001_koordinator_akses_data.sql`, `202610290002_rekap_terpadu.sql`, masing-masing + test kontrak statis, sha256 di `MANIFEST.json` (`node scripts/gen-migration-manifest.mjs`), entri `FORWARD_MIGRATION_FILES`. Policy tulis admin `TO authenticated`; tidak ada `FOR ALL` tanpa `TO`. Setiap `SECURITY DEFINER` memakai `SET search_path = pg_catalog, public`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, dan memeriksa peran/penanda/unit pemanggil sendiri.
- **B3:** role tetap `admin`, `front_office`, `petugas`. Koordinator = `petugas.koordinator boolean NOT NULL DEFAULT false`.
- **B4:** "hari ini" SQL = `(pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date`; klien `src/lib/time.ts`.
- Lingkup data (§6.1): admin semua; FO+Koordinator semua; FO biasa hanya tahap yang ia tangani (`penangan_id` = dirinya); Petugas+Koordinator semua data Layanannya (tahap `layanan` dengan `layanan_id` = layanannya) + miliknya; Petugas biasa hanya miliknya.
- **Dilayani** (satu definisi): `penanganan.status = 'selesai'` KECUALI tahap Layanan dengan hasil `dikembalikan` (tahap FO `dieskalasi` tetap dihitung untuk unit Front Office), tanggal = `kunjungan.tanggal`; tiket lama tanpa tahap: `tiket_antrean.status = 'selesai'`, `waktu_selesai` terisi (tutup otomatis tidak dihitung), dan Pendataan (bila ada) bukan draf. `batal`, `menunggu`, `berjalan`, draf tidak dihitung. Kanal: `saluran = 'chat'` → `live_chat`, selain itu `tatap_muka`.
- **Dilarang:** menerapkan migrasi, `npm run test:rls`, `node scripts/apply-migration.mjs`, koneksi DB nyata, push.
- Teks UI Indonesia, CSS Modules, aksesibel (label, `role="alert"`, tabel ber-`<caption>`/`scope`).

## Inventaris jalur baca (wajib ditegakkan)

| # | Jalur | Data | Penegakan sesudah Fase 3 | Test |
|---|---|---|---|---|
| R1 | RLS `penanganan_staf_select` → `boleh_penanganan` | tahap FO/layanan | admin; `boleh_data_pelayanan`; selain itu hanya **operasional** = pekerjaan terbuka (tahap `menunggu/berjalan`, atau kunjungan `menunggu/dilayani` bertanggal >= kemarin WIB, atau `terjadwal` bertanggal hari ini) dengan aturan lama (FO semua, petugas layanannya+konteks); yang sudah ditutup, termasuk hari ini, hanya dalam lingkup data | `koordinator_akses_data.test.ts` |
| R2 | RLS `kunjungan_staff_select` → `boleh_kunjungan` | identitas pengunjung | admin; FO Koordinator semua; Petugas Koordinator kunjungan ber-tiket/tahap/chat di layanannya; milik sendiri (dibuat_oleh, tahap, tiket, Pendataan); selain itu operasional + aturan lama | idem |
| R3 | RLS `oss_read_staff`/`perizinan_read_staff` → `boleh_baca_pendataan` (juga view `v_rekap_pelayanan_*`, `security_invoker`) | Pendataan Khusus | admin; FO Koordinator; Petugas Koordinator tiket layanannya; pendata/pemegang/penangan = dirinya; selain itu hanya tiket TERBUKA (`menunggu/dipanggil/dilayani`, tanggal >= kemarin) + `boleh_tiket` | idem |
| R4b | RLS `visit_select_own` (arsip `visit`, baca saja) | kunjungan lama | pengunjung miliknya; staf hanya admin + Koordinator unit (`boleh_rekap_lama`; `visit` tanpa kolom penangan). Sebelumnya `boleh_layanan` = semua FO | idem |
| R4 | RLS `rekap_harian_staff_read` | agregat lama | admin; FO Koordinator; Petugas Koordinator layanannya | idem |
| R5 | RLS `ambil_alih_pendataan_select` | catatan ambil alih | admin, pemegang lama, pemegang baru | idem |
| R6 | RPC `rekap_data_pelayanan`, `rekap_harian_terpadu`, `rekap_kinerja_petugas` | rekap | lingkup **ketat** dihitung di fungsi dasar internal `rekap_pelayanan_inti` (tanpa GRANT ke klien) dari `staf_lingkup()`, didorong ke tiap cabang; non-staf = kosong; Harian/Kinerja = agregat SQL dalam satu jsonb; Data = halaman maks 1000 + keyset | `rekap_terpadu.test.ts` |
| R7 | RPC `lingkup_data_saya` | identitas lingkup | hanya baris pemanggil | idem |
| R8 | `GET /api/admin/rekap/terpadu` (klien pengguna, bukan service-role) | rekap | memanggil R6/R7; 401 bila bukan staf aktif; 409 `MIGRASI_BELUM_DITERAPKAN` | `terpadu.test.ts` |
| R9 | `GET /api/admin/rekap/terpadu/export` (klien pengguna; service-role HANYA untuk `audit_log`) | Excel | sama dengan R8 | `export.test.ts` |
| R10 | `api/admin/pelayanan/[tiketId]` GET/PATCH | Pendataan satu tiket | RLS R2/R3 (klien pengguna) + `boleh_sunting_pendataan` untuk tulis | `route.test.ts` |
| R11 | `GET /api/admin/rekap/performa` | agregat tahap | tetap admin saja | (ada) |
| R12 | Route rekap lama `export`, `tickets`, `penanganan[/export]`, `rollup`, `layanan-options` | — | **dihapus** (halaman lama dilebur) | test dihapus |
| R13 | Halaman operasional (antrian, kotak masuk, penanganan FO, kunjungan, dashboard, chat, `pengunjung-lama`) | via RLS R1–R3 | jendela operasional; riwayat hari lalu hanya sesuai lingkup | — |

## Keputusan pelaksana

| # | Keputusan | Biaya bila keliru |
|---|---|---|
| K1 | **Jendela operasional = pekerjaan TERBUKA saja** (direvisi setelah review keamanan; versi "hari ini" ditolak karena bertentangan dengan §6.1): tahap `menunggu/berjalan`; kunjungan `menunggu/dilayani` bertanggal >= kemarin (WIB); reservasi `terjadwal` hanya bertanggal **hari ini** (FO meng-check-in reservasi pada harinya; reservasi hari lain tidak terlihat FO biasa); tiket `menunggu/dipanggil/dilayani` bertanggal >= kemarin. Yang sudah ditutup (termasuk hari ini) hanya dalam lingkup §6.1. Riwayat Penanganan FO hari ini: FO biasa hanya miliknya. Rekap/Excel: lingkup ketat. | Layar operasional (Antrian, dasbor) tidak lagi menampilkan nama pengunjung tiket rekan yang sudah selesai; reservasi esok hari tidak terlihat FO biasa. |
| K2 | "Pelayanan" = satu tahap `penanganan` (FO atau layanan) + tiket lama tanpa tahap. Satu kunjungan yang lewat FO lalu layanan = 2 pelayanan (satu di unit Front Office, satu di Layanan). | Angka total ≠ jumlah kunjungan; bila pemilik ingin per kunjungan, ubah agregasi `rekap_harian_terpadu`. |
| K3 | (Diputuskan lead) Tahap FO `selesai` dengan hasil apa pun (termasuk `dieskalasi`) dihitung untuk unit Front Office; tahap **Layanan** dengan hasil `dikembalikan` **tidak** dihitung (pengunjung dikembalikan ke FO, belum dilayani Layanan). Berlaku untuk ketiga bagian dan Excel (satu fungsi dasar). | Satu syarat di `rekap_pelayanan_inti`. |
| K4 | Kanal `live_chat` bila `saluran = 'chat'` (termasuk chat yang diambil FO), selain itu `tatap_muka`. Model data sudah membedakan; tidak ada kolom baru. | Hanya label. |
| K5 | Data Pelayanan hanya memuat pelayanan **dilayani** (berjalan/batal/draf tidak tampil). Kolom: Pendataan Umum (nama, HP, email, asal instansi, kategori, keperluan, topik, catatan) + kolom formulir OSS/Non OSS **hanya bila satu Layanan ber-formulir dipilih**. Kolom tambahan Fase 4 ditempel lewat `kolomDataPelayanan(formType, tambahan)`. | Pekerjaan yang masih berjalan tidak terlihat di rekap (tetap di halaman operasional). |
| K6 | Kinerja Petugas tampil untuk semua akun, isinya mengikuti lingkup: biasa hanya dirinya, Koordinator unitnya, admin semua. Halaman `Performa Pelayanan` (admin) tetap. | Bila biasa tidak boleh melihat kinerja sendiri, sembunyikan bagian untuk non-Koordinator. |
| K7 | Ambil alih Petugas Layanan = tiket `dilayani` milik petugas lain di layanan yang sama (RPC `koordinator_ambil_alih_tiket`). Ambil alih FO = tahap FO `berjalan` milik FO lain, **bukan chat** (`koordinator_ambil_alih_fo`; chat ditunda ke Fase 5, galat `KANAL_CHAT`). Pemegang lama harus satu unit (petugas layanan sama / FO), selain itu `BUKAN_SATU_UNIT`. Alasan wajib 5–500 karakter. | Koordinator tidak bisa mengambil alih chat atau tiket yang dipegang Admin. |
| K8 | "Petugas semula tetap bisa menyunting" = pemegang lama tetap boleh **menyimpan draf** Pendataan tiket itu selama tiket masih `dilayani` (policy RLS + API), tetapi hanya Koordinator yang **menyelesaikan** (pelayanan tercatat atas nama Koordinator karena `layanan_selesai` mengisi `petugas_id` = penyelesai). **Tahap FO tidak punya draf: setelah diambil alih, FO semula TIDAK dapat menyunting apa pun**; hanya Koordinator yang menutupnya (topik + catatan diisi saat menutup). | Bila pemegang lama juga harus bisa menyelesaikan, `layanan_selesai` perlu diubah (migrasi). |
| K9 | Pemberitahuan: `queue_notifikasi` web push ke pemegang lama + kartu "Pendataan Anda diambil alih" di halaman Antrian dan Penanganan FO (dari `ambil_alih_pendataan`, tombol "Mengerti" = `ambil_alih_tandai_dilihat`). | Tanpa push terdaftar, petugas hanya melihat kartu saat membuka halaman. |
| K10 | Penanda Koordinator diatur di `/admin/petugas` lewat tombol per baris (bukan di form ubah), hanya untuk role FO/Petugas; role diubah menjadi Admin → penanda dicabut otomatis. Perubahan tercatat `audit_log` (`akun_koordinator`). | Hanya tata letak. |
| K11 | Sebelum `202610290002` diterapkan, halaman Rekap menampilkan pemberitahuan "Rekap terpadu tersedia setelah migrasi diterapkan" (409 dari API); tidak ada fallback ke rekap lama. **Deploy dan migrasi WAJIB dalam satu jendela** (`docs/MIGRATIONS.md`). | Rekap kosong selama jeda deploy → migrasi. |
| K12 | Rekap Harian: baris per tanggal × unit (Front Office atau nama Layanan) dengan kolom Tatap muka, Live chat, Jumlah; urut tanggal terbaru. Rentang maksimal 366 hari (`RENTANG_TIDAK_VALID`). Excel hanya untuk Data Pelayanan (spec). | Unduhan Rekap Harian bisa ditambah belakangan. |
| K13 | `/admin/rekap-fo` → redirect `/admin/rekap?unit=fo`; entri nav "Rekap Front Office" disembunyikan (`hidden`, `tampilSebagai: '/admin/rekap'`); menu "Rekap Harian" berganti label "Rekap". Route API rekap lama dan komponen `RekapLayananTable`, `RekapPenangananTable`, `RekapTiketDetailPanel` dihapus. | Tautan API lama 404 (tidak dipakai di luar halaman yang dilebur). |
| K14 | Saran pengunjung lama di walk-in FO (`src/lib/fo/pengunjung-lama.ts`) untuk FO biasa kini hanya menemukan kunjungan hari ini/miliknya (RLS R2). Pencarian lintas FO dibangun Fase 6 lewat RPC tersamar. | FO biasa sementara mengetik ulang data pengunjung lama. |
| K15 | Dasbor `/admin` dan halaman Kunjungan untuk FO biasa: data hari lalu hanya miliknya (RLS R2). | Grafik 7 hari FO biasa tidak mencerminkan seluruh kantor. |
| K16 | Scan QR: karena jendela FO hanya memuat reservasi hari ini, ditambah RPC `fo_status_qr(token)` (FO/Admin aktif, SECURITY DEFINER, hanya KATEGORI status tanpa PII): `tanggal_lain` -> "Reservasi Tanggal Lain", `tidak_berlaku` (no_show/batal/lewat) -> "QR Sudah Hangus", `sudah_diproses` -> "Sudah Diproses", lainnya/RPC belum ada -> "Tidak Ditemukan ... atau tidak berlaku hari ini". | FO dapat mengetahui bahwa sebuah token adalah reservasi (tanpa identitas); bila tidak diinginkan, cabut GRANT RPC. |
| K17 | Pencabutan penanda Koordinator dilakukan pemicu DB `trg_petugas_cabut_koordinator` (BEFORE UPDATE OF role, layanan_id) dalam UPDATE yang sama; API hanya membaca keadaan sebelum tulis untuk audit `koordinator_dicabut` dan menolak (500, tanpa tulis) bila pembacaan gagal selain kolom hilang. | Admin harus menandai ulang setelah memindahkan akun. |

## Review Focus

1. **Bocor lewat jalur operasional ke rekap** — FO biasa membuka Rekap untuk hari ini: hanya tahapnya sendiri. Pin: test kontrak `rekap_data_pelayanan` tidak memanggil `boleh_penanganan`/`kunjungan_operasional` dan memuat empat cabang lingkup; test route memastikan rekap hanya lewat RPC.
2. **Admin/Koordinator nonaktif** — `staf_lingkup()` hanya akun `aktif = true`; akun nonaktif melihat kosong. Pin: test kontrak `WHERE … aktif = true`.
3. **Koordinator mengambil alih tiketnya sendiri / tiket selesai / layanan lain** — idempoten `sudah_milik_anda`, `INVALID_STATUS`, `FORBIDDEN`. Pin: test kontrak kode galat.
4. **Migrasi belum diterapkan** — Antrian, Penanganan FO, Kelola Petugas, wizard Pendataan tetap jalan (penanda = false, sunting = pemilik saja); Rekap 409. Pin: test route + `objekBelumAda`.
5. **Pemegang lama menyimpan draf setelah diambil alih** — PATCH diterima, POST (selesaikan) ditolak `BUKAN_PEMILIK`. Pin: test route pelayanan.

---

### Task 1: Migrasi 202610290001 — Koordinator, lingkup data, ambil alih

**Files:** Create `supabase/migrations/202610290001_koordinator_akses_data.sql`, `supabase/migrations/koordinator_akses_data.test.ts`; Modify `MANIFEST.json`, `migration-test-utils.ts`.

**Interfaces (DB):**
- `petugas.koordinator boolean NOT NULL DEFAULT false`.
- `staf_lingkup() RETURNS TABLE(id uuid, role text, layanan_id uuid, koordinator boolean)` (aktif saja).
- `boleh_data_pelayanan(p_peran_tahap text, p_layanan uuid, p_penangan uuid) RETURNS boolean`.
- `kunjungan_operasional(p_kunjungan uuid) RETURNS boolean` (tanggal = hari ini WIB atau status `terjadwal|menunggu|dilayani`).
- `boleh_penanganan(uuid,text,uuid,uuid,text)`, `boleh_kunjungan(uuid)` (signature sama), `boleh_baca_pendataan(p_tiket uuid, p_petugas uuid)`, `boleh_rekap_lama(p_layanan uuid)`, `boleh_sunting_pendataan(p_tiket_id uuid)`.
- Tabel `ambil_alih_pendataan(id, peran_tahap, kunjungan_id, tiket_id, layanan_id, penanganan_lama_id, penanganan_baru_id, pemegang_lama, pemegang_baru, alasan, dilihat_at, created_at)`.
- RPC `koordinator_ambil_alih_tiket(p_tiket_id uuid, p_alasan text) → jsonb {ok, sudah_milik_anda, pemilik_lama, dilayani_oleh, ambil_alih_id}`; `koordinator_ambil_alih_fo(p_penanganan_id uuid, p_alasan text) → jsonb {ok, sudah_milik_anda, pemilik_lama, penanganan_id, ambil_alih_id}`; `ambil_alih_tandai_dilihat(p_id uuid) → jsonb`. Galat: `FORBIDDEN`, `SESI_TIDAK_SAH`, `ALASAN_WAJIB`, `NOT_FOUND`, `INVALID_STATUS`, `BUKAN_SATU_UNIT`, `KANAL_CHAT`.

- [ ] Tulis test kontrak (aditif; tidak destruktif; helper definer + search_path + revoke; policy baru `TO authenticated`; `boleh_penanganan` cabang FO tidak lagi `RETURN true` tanpa syarat; anti-drift: blok penutupan tahap di `koordinator_ambil_alih_tiket` sama dengan `admin_ambil_alih` 0005 kecuali teks catatan); jalankan → FAIL.
- [ ] Tulis migrasi, manifest, `FORWARD_MIGRATION_FILES`; jalankan test + `manifest.test.ts` → PASS. Commit.

### Task 2: Migrasi 202610290002 — RPC rekap terpadu

**Files:** Create `supabase/migrations/202610290002_rekap_terpadu.sql`, `supabase/migrations/rekap_terpadu.test.ts`.

**Interfaces (DB):** `lingkup_data_saya() → jsonb {petugas_id, role, koordinator, layanan_id, layanan_nama}`; `rekap_data_pelayanan(p_dari date, p_sampai date, p_unit text DEFAULT NULL, p_layanan_id uuid DEFAULT NULL) RETURNS TABLE(pelayanan_id uuid, sumber text, tanggal date, kunjungan_id uuid, tiket_id uuid, nomor_tiket text, unit text, layanan_id uuid, layanan_nama text, kanal text, penangan_id uuid, penangan_nama text, fo_nama text, hasil text, topik text, catatan text, mulai_at timestamptz, selesai_at timestamptz, pengunjung_nama text, pengunjung_hp text, pengunjung_email text, pengunjung_instansi text, pengunjung_kategori text, keperluan text, form_type text, pendataan jsonb)`; `rekap_harian_terpadu(p_dari, p_sampai) RETURNS TABLE(tanggal date, unit text, layanan_id uuid, layanan_nama text, tatap_muka bigint, live_chat bigint, jumlah bigint)`; `rekap_kinerja_petugas(p_dari, p_sampai) RETURNS TABLE(penangan_id uuid, penangan_nama text, unit text, layanan_id uuid, layanan_nama text, jumlah bigint, live_chat bigint, rata_durasi_menit numeric)`. Galat `RENTANG_TIDAK_VALID` (22023).

- [ ] Test kontrak (definisi dilayani, draf tiket lama dikecualikan, empat cabang lingkup, aktif saja lewat `staf_lingkup`, agregat memanggil `rekap_data_pelayanan`, prasyarat 0001) → FAIL; tulis migrasi → PASS. Commit.

### Task 3: Pustaka murni rekap terpadu + galat migrasi

**Files:** Create `src/lib/akses-data/galat.ts` (`objekBelumAda(err: unknown): boolean` untuk `PGRST202|PGRST204|PGRST205|42883|42703|42P01`), `src/lib/akses-data/lingkup.ts` (`LingkupData`, `labelLingkup`, `bolehKoordinatorAmbilAlihTiket`, `bolehKoordinatorAmbilAlihFo`), `src/lib/rekap/terpadu.ts` (zod `rekapTerpaduQuerySchema`, tipe baris, `KOLOM_PENDATAAN_UMUM`, `KOLOM_OSS`, `KOLOM_PERIZINAN`, `kolomDataPelayanan(formType, tambahan?)`, `ringkasHarian`), `src/lib/rekap/excelTerpadu.ts` (`buildDataPelayananWorkbook(rows, kolom, meta)`), test di sebelahnya. TDD.

### Task 4: API rekap terpadu + Excel; hapus route rekap lama

**Files:** Create `src/app/api/admin/rekap/terpadu/route.ts` (`bagian=lingkup|harian|data|kinerja`), `.../terpadu/export/route.ts`, tests. Delete `api/admin/rekap/{export,tickets,penanganan,rollup,layanan-options}`. 401 bukan staf aktif; 422 query; 409 `MIGRASI_BELUM_DITERAPKAN`; 422 `RENTANG_TIDAK_VALID`; export menulis `audit_log` `export_xlsx` entitas `rekap_data_pelayanan`.

### Task 5: Halaman Rekap terpadu + redirect + nav

**Files:** Rewrite `src/app/admin/rekap/page.tsx` + `rekap.module.css` + test; `src/app/admin/rekap-fo/page.tsx` → redirect; `src/lib/admin-nav.ts`; hapus komponen/tes rekap lama. Query `?bagian=&unit=` dibaca saat mount.

### Task 6: Penanda Koordinator di Kelola Petugas

**Files:** `src/app/api/admin/petugas/route.ts` (GET gabung `koordinator`), `src/app/api/admin/petugas/[id]/koordinator/route.ts` (PATCH `{koordinator: boolean}`), `[id]/route.ts` (role→admin mencabut penanda), `src/app/admin/petugas/page.tsx`, `AkunForm.tsx` (`koordinator?: boolean`), tests.

### Task 7: Ambil alih pendataan (UI + API draf)

**Files:** `AmbilAlihTiketModal.tsx` (`mode: 'admin' | 'koordinator_tiket' | 'koordinator_fo'`), `src/components/admin/PemberitahuanAmbilAlih.tsx`, `src/app/admin/antrian/page.tsx`, `src/app/admin/fo/penanganan/page.tsx`, `api/admin/pelayanan/[tiketId]/route.ts` (`boleh_ubah` + PATCH memakai `boleh_sunting_pendataan`, `boleh_selesaikan` baru), `PelayananWizardModal.tsx`, `src/lib/types/pelayanan.ts`, tests.

### Task 8: Dokumen + gate

`docs/MIGRATIONS.md` (urutan: setelah 202610270001, 202610270002, 202610280001; daftar periksa pemilik), `docs/STATUS.md`, `CLAUDE.md`, `docs/analysis/04-RBAC-MATRIX*.md`, `GLOSSARY.md` bila perlu. Gate: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Commit.

## Revisi setelah review keamanan (2026-10-29)

Diterapkan di tempat pada migrasi yang belum pernah diterapkan (`202610290001`, `202610290002`; MANIFEST diperbarui): jendela operasional hanya pekerjaan terbuka (K1 baru); `visit_select_own` dipersempit (R4b); tiket lama tanpa `waktu_selesai` tidak dihitung; Rekap Harian/Kinerja = agregat SQL satu jsonb (tidak terpotong batas baris PostgREST); dasar ringan `rekap_pelayanan_inti` dengan predikat lingkup/unit/layanan di tiap cabang, detail PII/Pendataan hanya untuk halaman, ekspor paging keyset; penanda Koordinator dicabut pada setiap perubahan role/layanan (diaudit); batas rentang DB `>= 366` = aplikasi; `KANAL_CHAT` juga untuk ambil alih tiket; penjaga rollback 0012/0013 memakai penanda 0029 + skrip rollback `docs/rollback-koordinator-akses-data-202610290001.sql` dan `docs/rollback-rekap-terpadu-202610290002.sql`; uji anti-drift cabang petugas `boleh_penanganan`.

### Celah yang diketahui (tidak diperbaiki di Fase 3; dirapatkan Fase 5/6)

- `tiket_antrean` `tiket_staff_select` (tanpa `TO`): staf membaca hitungan/durasi tiket rekan (tanpa PII; operasional antrean).
- `buku_tamu`: semua FO membaca semua tanggal.
- `chat_sesi` / `chat_pesan`: Front Office membaca percakapan lintas Layanan (Fase 5 live chat).

### Diketahui (minor, tanpa perubahan)

- Minor (diketahui, tanpa perubahan): `boleh_penanganan` menampilkan tahap yang sudah ditutup dari kunjungan yang MASIH terbuka kepada semua FO (konteks operasional, mis. alasan pengembalian di Kotak Masuk); `/admin/kunjungan` dan dasbor `/admin` menampilkan data parsial untuk FO biasa (hanya miliknya + pekerjaan terbuka); saran pengunjung lama di walk-in FO hanya menemukan kunjungan milik sendiri/terbuka sampai Fase 6.
