# Harness verifikasi lokal (PGlite)

Postgres dalam-proses (WASM) untuk menguji PERILAKU migrasi (RLS, RPC, trigger) tanpa DB mana pun:
tidak ada koneksi jaringan, tidak membaca `.env.local`, tidak menyentuh produksi. Dipakai oleh
`skenario-*.mjs` pada rencana survei terpadu Fase A (`docs/superpowers/plans/2026-10-26-survei-terpadu-fase-a.md`).

Ini BUKAN pengganti: test statis SQL (`supabase/migrations/*.test.ts`), `npm run test:rls`, atau dry-run
pemilik pada DB nyata. Harness hanya membuktikan bahwa logika SQL baru benar di atas stub skema.

## Pemasangan (wajib, tidak masuk package.json)

PGlite sengaja TIDAK ditambahkan ke `package.json`/`package-lock.json` (aturan R5). Pasang lokal di root worktree:

```bash
npm i --no-save @electric-sql/pglite
```

- Ulangi setelah setiap `npm ci` atau `npm install` (keduanya menghapus paket yang tidak tercatat).
- Setelah pemasangan, `git status` TIDAK boleh menunjukkan perubahan pada `package.json` atau `package-lock.json`.
  Jangan commit perubahan semacam itu, dan jangan memakai `npm i @electric-sql/pglite` tanpa `--no-save`.
- Bila belum terpasang, `bukaDb()` berhenti dengan pesan yang menjelaskan perintah di atas.

## Menjalankan

```bash
node scripts/lokal/skenario-smoke.mjs
```

Kode keluar 0 bila semua cek lolos, 1 bila ada yang gagal (ringkasan dicetak di akhir). Satu skenario memakai
satu DB baru dan terpisah (`bukaDb()` membuat DB kosong dalam memori tiap panggilan), kira-kira 1-2 detik.

## API (`pglite-harness.mjs`)

| Fungsi | Kegunaan |
|---|---|
| `bukaDb()` | Buka DB PGlite kosong lalu terapkan `pglite-stub.sql`. Panggil `await db.close()` di akhir skenario. |
| `sebagai(db, role, uid, sql, params?)` | Jalankan `sql` sebagai `anon`, `authenticated`, `service_role`, atau `postgres` (superuser lokal, setara pemilik migrasi) dengan `auth.uid() = uid` (`null` = tidak login). Urutan: `RESET ROLE`, `set_config('app.uid')`, `SET ROLE`, jalankan, `RESET ROLE`. Hasil: `{ ok: true, rows }` atau `{ ok: false, pesan, kode }` (`kode` = SQLSTATE, mis. `42501` hak ditolak, `23505` unik). Galat SQL tidak dilempar. Tanpa `params`, `sql` boleh berisi banyak pernyataan (hasil = baris pernyataan terakhir); dengan `params`, hanya satu pernyataan. |
| `terapkanBerkas(db, path)` | Terapkan satu berkas SQL (mis. migrasi) sebagai `postgres`. Melempar `Error` berisi nama berkas bila gagal. |
| `cek(nama, kondisi, detail?)` | Catat satu pemeriksaan. `kondisi` harus tepat `true` (nilai lain dihitung gagal). Proses keluar dengan kode 1 bila ada yang gagal. |

Contoh pola:

```js
import { bukaDb, sebagai, terapkanBerkas, cek } from './pglite-harness.mjs';

const db = await bukaDb();
await terapkanBerkas(db, 'supabase/migrations/202611020001_survei_undangan.sql');
const r = await sebagai(db, 'anon', null, 'SELECT * FROM public.survei_undangan');
cek('anon tidak membaca survei_undangan', r.ok ? r.rows.length === 0 : true, JSON.stringify(r));
await db.close();
```

## Isi dan batas stub (`pglite-stub.sql`)

Ada: role `anon`/`authenticated`/`service_role` (`BYPASSRLS`), `auth.uid()` (dari GUC `app.uid`), pgcrypto di schema
`extensions`, tabel `layanan`, `petugas`, `kunjungan`, `tiket_antrean`, `skm_respons` (baseline + `kunjungan_id`),
`visit(id)` dan `pengunjung(id)` (hanya agar FK terselesaikan), fungsi `staf_saya`, `boleh_layanan`, `peran_saya`,
`boleh_kunjungan`, `kunjungan_layanan_skm`, trigger `selesai_at` kunjungan, RLS + policy `skm_select_staff`.

Harus diingat saat membaca hasil uji:

- `boleh_kunjungan` DISEDERHANAKAN: cabang kunjungan online (join `chat_sesi`, migrasi `202610140009`) dibuang.
- Hak akses meniru default Supabase (tabel/fungsi baru di `public` memberi ALL ke `anon`, `authenticated`,
  `service_role`). Migrasi yang lupa `REVOKE` tampak terbuka di sini, sama seperti di produksi.
- RLS aktif pada semua tabel stub, tetapi policy hanya yang disalin dari produksi (`skm_respons`, `layanan`).
  Tabel stub lain tanpa policy = `anon`/`authenticated` ditolak semua, LEBIH KETAT dari produksi. Jangan memakai
  harness ini untuk membuktikan RLS tabel stub itu sendiri.
- Kolom NOT NULL produksi yang tidak dipakai fitur ini tidak ada (mis. `tiket_antrean.tanggal/nomor/nomor_display`),
  jadi `INSERT` uji tidak perlu mengisinya. `petugas.auth_user_id` tanpa FK ke `auth.users`.
- Trigger `selesai_at` disalin dari produksi: saat status BERUBAH ke status akhir, `selesai_at` dipaksa `now()`
  (nilai yang dikirim diabaikan); selama status tetap, nilai lama dipertahankan. Untuk memundurkan waktu di
  skenario: `INSERT` kunjungan langsung berstatus `selesai` dengan `selesai_at` yang dikehendaki (INSERT memakai
  `COALESCE`), atau, sebagai `postgres`, `ALTER TABLE public.kunjungan DISABLE TRIGGER trg_kunjungan_selesai_at`
  di sekitar `UPDATE`-nya lalu `ENABLE TRIGGER` lagi (UPDATE biasa tidak bisa memundurkannya).
- Tidak ada: `chat_sesi`, `skm_response_rate` dan triggernya, `submit_skm_response`, `get_skm_context`,
  `v_skm_petugas`, `hitung_ikm`. Skenario yang membutuhkannya menambah stub-nya sendiri (di `pglite-stub.sql`
  dengan komentar sumber migrasi) atau menyalin objek aslinya.
