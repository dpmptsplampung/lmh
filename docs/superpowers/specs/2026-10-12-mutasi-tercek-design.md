# Rancangan: Mutasi Supabase yang Selalu Dicek (Menutup "Notifikasi Sukses Palsu")

- Tanggal: 2026-10-12
- Status: **Rancangan hasil brainstorm dengan CEO** — belum ada implementasi
- Asal: audit [`AUDIT-2026-10-12-MENYELURUH.md`](../../audit/AUDIT-2026-10-12-MENYELURUH.md) temuan **T2a, T2b, T2c, T2d**. Pelacak: [`AUDIT-2026-10-12-TRACKER.md`](../../audit/AUDIT-2026-10-12-TRACKER.md).
- Hubungan dengan spec lain: alur FO ([`2026-10-12-alur-fo-eskalasi-design.md`](2026-10-12-alur-fo-eskalasi-design.md)) memakai pola yang sama untuk semua RPC mutasi; spec ini bisa dikerjakan **lebih dulu dan terpisah**.

## 1. Masalah

supabase-js **tidak melempar** error. Kegagalan kembali sebagai `{ error }`, dan penolakan RLS pada `UPDATE`/`DELETE` menghasilkan **0 baris terdampak tanpa error** (untuk `INSERT`, pelanggaran `WITH CHECK` menghasilkan error `42501`). Kode yang langsung memanggil `toast('berhasil')` setelah `await` tanpa memeriksa hasil melapor sukses palsu. Tidak ada `.throwOnError()` di seluruh `src/`.

| ID | Lokasi | Dampak |
|---|---|---|
| T2a | `src/app/admin/chat/faq/page.tsx:118-141, 259-276, 312-318` | Dropdown layanan tidak di-scope sesuai RLS `faq_petugas_all` (`layanan_id = get_my_layanan_id()`); petugas mengedit/menghapus FAQ layanan lain → ditolak diam-diam → toast sukses |
| T2b | `src/app/me/notifications/page.tsx:102-111` | Hasil `upsert` `push_subscriptions` tak dibaca; toggle "aktif" permanen walau server tak menyimpan langganan → pengunjung tidak menerima notifikasi |
| T2c | `src/app/admin/dokumen/page.tsx:111-113` | `error` tak dibaca; gangguan jaringan = toast sukses, bot RAG tetap mengutip dokumen yang dicabut |
| T2d | ±15 mutasi lain: `admin/antrian/page.tsx:213-221,245-253`, `admin/scan/page.tsx:204-211`, `admin/umkm/page.tsx:188-196`, jadwal, dll. | Laten: peran yang bisa membuka halaman = peran yang diizinkan RLS, jadi belum terlihat |

Pola benar yang sudah ada: toggle `chatbot_aktif` di `faq/page.tsx:195-204` (`.select('id')` + cek `error` + cek jumlah baris).

## 2. Keputusan CEO (mengikat)

| # | Keputusan |
|---|---|
| K1 | **Petugas layanan hanya mengelola FAQ layanannya sendiri; admin semua layanan.** Dropdown hanya menampilkan layanan yang boleh diedit. |
| K2 | **FAQ umum (tanpa layanan) dikelola Front Office** (dan admin). |
| K3 | **Dokumen peraturan (RAG) hanya admin.** (Sudah ditegakkan di DB dan navigasi; yang kurang hanya penanganan error.) |
| K4 | Aturan lint untuk mutasi **memblokir build**, dan seluruh titik lama diperbaiki **dalam paket yang sama** (bukan bertahap). |

## 3. Rancangan

### 3.1 Helper bersama `src/lib/supabase/mutate.ts`

Membungkus query supabase-js dan **melempar** bila ada masalah, sehingga pola benar jadi satu baris dan tidak bergantung pada ingatan:

```ts
// Selalu menambahkan pemeriksaan; query harus memakai .select('id') agar baris terdampak terlihat.
const baris = await mutasiWajibBaris(
  supabase.from('faq_knowledge_base').update({ ... }).eq('id', id).select('id'),
);
```

- `mutasiWajibBaris(query)` — untuk `UPDATE`/`DELETE`: melempar `MutasiError` bila `error` ada **atau** 0 baris. Kode: `jaringan | ditolak | tidak_ada_baris | database`.
- `mutasiInsert(query)` — untuk `INSERT`/`UPSERT`: melempar bila `error` ada; mengembalikan baris bila diminta `.select()`.
- `MutasiError` membawa pesan Indonesia siap tampil (mis. "Anda tidak berwenang mengubah data ini atau data sudah tidak ada") dan kode untuk logging (`logServerEvent` di sisi server).
- Dipakai juga di route handler (service role) — perilaku supabase-js sama.

### 3.2 Perbaikan per kasus

**T2a — FAQ**
- Daftar layanan di-scope: admin → semua layanan **+ opsi "Umum"**; petugas → hanya `layanan_id` miliknya; front office → hanya "Umum". Satu sumber kebenaran: fungsi `layananFaqBolehDikelola(role, petugas)` di `src/lib/` yang diuji unit, selaras dengan RLS.
- Edit/hapus memakai `mutasiWajibBaris`. Toast sukses hanya setelah baris terdampak terbukti; bila `ditolak/tidak_ada_baris` tampil pesan jelas dan daftar dimuat ulang.
- Setelah edit konten, `embedding` di-null-kan seperti sekarang (perilaku dipertahankan).

**T2b — Push**
- `upsert` dibungkus `mutasiInsert`. Bila gagal: **batalkan langganan browser** (`sub.unsubscribe()`), toggle dikembalikan ke mati, pesan "Gagal mengaktifkan notifikasi, coba lagi".
- Jalur nonaktif juga memeriksa hasil `delete` (bila server gagal menghapus tetapi browser sudah `unsubscribe`, tampilkan status sesungguhnya).

**T2c — Dokumen**
- `handleCabut` memakai `mutasiWajibBaris` + penanganan error; toast sukses hanya setelah terbukti; `loadDocs()` dipanggil di jalur sukses **dan** gagal. Tidak ada perubahan hak akses (sudah admin-only).

**T2d — ±15 mutasi lain**
- Inventaris lengkap dibuat lebih dulu dengan pencarian `.update(`, `.delete(`, `.upsert(`, `.insert(` pada rantai `.from(` di `src/` (page + route + lib). Setiap titik dikonversi ke helper; titik yang sengaja tidak mengecek (jika ada) diberi komentar alasan dan pengecualian lint yang tercatat.

### 3.3 FAQ umum (butuh migrasi + perubahan RAG)

Kondisi sekarang: `faq_knowledge_base.layanan_id` **`NOT NULL`**; `match_faq_teks` memfilter `layanan_id = p_layanan` persis; `match_faq(…, p_layanan_id)` memfilter layanan bila diberikan.

Migrasi baru (forward, + test kontrak statis, + rollback di `docs/`):
1. `ALTER TABLE faq_knowledge_base ALTER COLUMN layanan_id DROP NOT NULL` — NULL = FAQ umum. (Alternatif "layanan semu Umum" ditolak: mencemari daftar layanan publik, antrean, jadwal, rekap.)
2. Policy baru **`faq_fo_umum`**: `FOR ALL TO authenticated USING (layanan_id IS NULL AND get_my_role() = 'front_office') WITH CHECK (layanan_id IS NULL AND get_my_role() = 'front_office')`. Policy `faq_admin_all` (admin semua) dan `faq_public_read` (aktif = true) tetap; `faq_petugas_all` tetap membatasi petugas ke layanannya (NULL tidak cocok → petugas tidak bisa menyentuh FAQ umum).
3. `match_faq_teks` dan `match_faq`: kondisi menjadi `layanan_id = p_layanan OR layanan_id IS NULL` (FAQ umum ikut dicari di semua layanan). Peringkat: FAQ layanan diutamakan atas FAQ umum pada skor setara.
4. Verifikasi di kode: `api/chat/ai/route.ts`, `api/admin/faq/embed` (menangani baris `layanan_id` NULL), tampilan FAQ publik di chat (menampilkan FAQ layanan terpilih + umum), trigger audit `trg_audit_faq` (sudah ada, mencakup baris NULL).
5. `src/lib/admin-nav.ts`: **Kelola FAQ** menjadi `['admin', 'petugas', 'front_office']`.

### 3.4 Aturan lint (memblokir)

- Aturan ESLint lokal (plugin kecil di repo, atau `no-restricted-syntax` bila cukup) yang menandai `.update(` / `.delete(` / `.upsert(` / `.insert(` pada rantai `supabase.from(...)` **yang tidak dibungkus** `mutasiWajibBaris`/`mutasiInsert`. Pengecualian hanya dengan komentar `eslint-disable-next-line` + alasan.
- Berlaku untuk `src/**` kecuali berkas helper dan test. Karena `npm run lint` memakai `--max-warnings=0` dan menjadi bagian `npm run verify:baseline` (gerbang dijalankan di lokal, bukan di GitHub), aturan ini memblokir penyelesaian pekerjaan yang melanggar.
- Bagian ini dibuktikan dengan test aturan (kode contoh yang salah harus dilaporkan, yang benar lolos).

## 4. Pengujian

- Unit `mutate.test.ts`: `error` → throw `database`/`jaringan`; 0 baris → `tidak_ada_baris`; baris ada → mengembalikan baris; `INSERT` ditolak → throw.
- Komponen: halaman FAQ — supabase mock mengembalikan `{ error }` dan 0 baris → toast **gagal**, bukan sukses; dropdown petugas hanya berisi layanannya; FO hanya "Umum". Halaman notifikasi — upsert gagal → toggle mati + langganan browser dibatalkan. Halaman dokumen — gagal → toast gagal.
- Kontrak migrasi (`supabase/migrations/*.test.ts`): kolom nullable, policy `faq_fo_umum`, definisi `match_faq*` memuat `OR layanan_id IS NULL`.
- RAG: pertanyaan yang jawabannya hanya ada di FAQ umum tetap ditemukan di layanan mana pun.

## 5. Urutan kerja & gerbang

1. Inventaris mutasi (T2d) + helper + test helper.
2. Konversi T2a/T2b/T2c, lalu sisa mutasi dari inventaris.
3. Migrasi FAQ umum + perubahan RAG + nav.
4. Aturan lint (diaktifkan **setelah** semua titik terkonversi).
5. `npm run verify:baseline`; migrasi ke produksi hanya setelah konfirmasi CEO (`scripts/apply-migration.mjs`), dan hasil di produksi diverifikasi (fungsi `match_faq*` benar, policy ada) sebelum menandai selesai di pelacak.

Model subagent bila dikerjakan paralel: inventaris & konversi mekanis = Haiku 5.5; helper, migrasi, RAG = Sonnet 5.5; review akhir keamanan RLS = Opus 5.5.

## 6. Di luar cakupan

- Perbaikan "toast sukses palsu" yang bukan berasal dari Supabase (mis. `fetch` ke API route: kasus `res.ok` diabaikan di `/umkm` = T6, dibahas terpisah).
- Pemindahan seluruh mutasi klien ke RPC (dilakukan bertahap oleh spec alur FO untuk antrean).

## 7. Risiko & pertanyaan terbuka

1. FAQ umum ikut dicari di semua layanan → bisa mengalahkan FAQ layanan bila ditulis terlalu umum. Mitigasi: urutan prioritas layanan > umum dan kebijakan konten bagi FO.
2. Aturan lint bisa menghasilkan banyak temuan di route handler server yang sah (mis. insert log). Bila terlalu berisik, batasi aturan ke `src/app/**/page.tsx`, `src/components/**`, `src/lib/hooks/**` dulu dan route handler mengikuti pada iterasi kedua (keputusan saat inventaris).
3. Tanggal efektif untuk petugas yang saat ini mungkin sudah punya FAQ lintas layanan: tidak ada karena RLS sudah menolak; tidak perlu migrasi data.
