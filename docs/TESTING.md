# Testing

## What runs in CI

| Layer | Command | Scope |
|---|---|---|
| Lint | `npm run lint` | ESLint, max-warnings=0 |
| Types | `npm run typecheck` | `tsc --noEmit` |
| Unit / contract | `npm test` | Vitest + jsdom: components, API helpers, static migration SQL contracts |
| Build | `npm run build` | Next.js production build with placeholder public env |

CI workflow: `.github/workflows/ci.yml` (Node from `.nvmrc` = 22).  
Docker and Supabase local are **not** required for CI.

## Gerbang lokal (otoritatif)

Tidak ada CI GitHub yang menjadi gerbang. Keputusan CEO: semua pemeriksaan dijalankan **lokal** dengan satu perintah.
`.github/workflows/ci.yml` **dibiarkan apa adanya** (tidak diubah): ia tidak menjalankan `deps:check`/`audit:check` dan
audit-nya hanya memblok advisory `critical` (`npm audit --audit-level=critical`) — jangan dijadikan acuan "high+".

```bash
npm run verify:baseline
```

Urutan (berhenti di langkah pertama yang gagal):

| # | Perintah | Yang diperiksa |
|---|---|---|
| 1 | `npm run deps:check` | Versi `next`, `sharp`, `eslint-config-next` di `node_modules` sama dengan `package-lock.json` (`scripts/check-deps-sync.mjs`). Gagal bila beda atau tidak terpasang -> jalankan `npm ci`. |
| 2 | `npm run audit:check` | `npm audit --json`: advisory **high/critical** memblok, kecuali tercatat di `audit-allow.json` dan belum lewat tenggat (`scripts/check-audit.mjs`). Moderate/low hanya dihitung di ringkasan. |
| 3 | `npm run lint` | ESLint, `--max-warnings=0` |
| 4 | `npm run typecheck` | `tsc --noEmit` |
| 5 | `npm test` | Vitest (termasuk test kedua skrip gerbang di atas) |
| 6 | `npm run build` | Build produksi Next.js |

**Audit (`audit:check`) — kode keluar:** 0 lolos; 1 pelanggaran kebijakan; 2 audit tidak dapat dijalankan/dibaca
(mis. tanpa internet/registry npm tidak terjangkau, atau `audit-allow.json` bukan JSON). Tanpa hasil audit yang sah gerbang
**gagal**, bukan lolos. Langkah ini butuh koneksi ke registry npm.

**Menambah pengecualian audit.** Hanya untuk advisory high+ yang belum punya perbaikan layak. Tambahkan entri di
`audit-allow.json` (root repo):

```json
{
  "pengecualian": [
    { "id": "GHSA-xxxx-xxxx-xxxx", "alasan": "...", "tenggat": "YYYY-MM-DD" }
  ]
}
```

- `id`: ID GHSA advisory **akar** (lihat URL advisory di keluaran `npm audit`/`npm run audit:check`), bukan nama paket turunannya.
  Satu advisory akar menutup seluruh rantai paket yang terdampak.
- `alasan`: wajib, jujur dan dapat diperiksa — apakah rantai dev-only atau masuk produksi (`npm ls <paket> --omit=dev`),
  perbaikan apa yang ditawarkan npm dan mengapa tidak layak, kapan dikaji ulang.
- `tenggat`: tanggal kaji ulang (YYYY-MM-DD, kalender WIB). Pengecualian berlaku sampai tanggal itu (inklusif); sehari
  sesudahnya gerbang gagal lagi sampai dikaji ulang (perbarui dependensi, atau perpanjang tenggat dengan alasan baru).
- Berkas cacat (alasan kosong, tenggat tidak valid, id ganda) membuat gerbang gagal. Entri yang tidak lagi dipakai dicetak
  sebagai PERINGATAN "basi" (tidak menggagalkan) — hapus entrinya.
- Entri saat ini: tidak ada (daftar kosong sejak 2026-10-26). Entri lama `GHSA-vfj7-8cjw-p6xm` (braces) dihapus karena
  rantainya tidak lagi dilaporkan `npm audit`.

**Hook pre-push.** `.githooks/pre-push` menjalankan `npm run verify:baseline`; bila gagal, push dibatalkan. Aktifkan sekali per
clone:

```bash
git config core.hooksPath .githooks
```

Hook hanya dilewati bila push murni menghapus ref remote. Berkas hook harus berakhiran baris LF (bukan CRLF) agar `sh` dapat
menjalankannya. Bila hook gagal, perbaiki penyebabnya lalu jalankan ulang `npm run verify:baseline` sampai hijau.

**Aturan ESLint `lmh/mutasi-tercek` (memblokir; bagian langkah 3).** Mencegah "sukses palsu" pada mutasi Supabase
(audit T2): supabase-js tidak melempar, dan penolakan RLS pada UPDATE/DELETE = 0 baris tanpa error. Aturan lokal ada di
`eslint-rules/mutasi-tercek.mjs`, dipasang di `eslint.config.mjs` untuk `src/**/*.{ts,tsx}` (kecuali `*.test.*`,
`src/test/**`, dan `src/lib/supabase/mutate.ts`). Yang ditandai (hanya rantai berakar `.from(...)`; `Map.delete`,
`hash.update`, Storage, dll. tidak):

| Kode | Wajib | Helper (`src/lib/supabase/mutate.ts`) |
|---|---|---|
| `.update(...)` / `.delete(...)` | argumen langsung helper; rantai harus berakhir `.select('id')` | `mutasiWajibBaris` bila 0 baris = gagal (penolakan RLS diam-diam, kasus umum). `mutasiBolehKosong` hanya untuk operasi yang SENGAJA idempoten (hapus baris yang mungkin sudah tak ada) -- beri komentar alasannya. |
| `.insert(...)` / `.upsert(...)` | hasil dikonsumsi: bungkus `mutasiInsert`, atau `const { error } = await ...` (`error` harus ada di destructuring), atau ditugaskan utuh/di-return/`.then(` | `mutasiInsert` |
| `.rpc(...)` | idem insert (dibuang atau destructuring tanpa `error` = pelanggaran, termasuk RPC baca) | `mutasiInsert` untuk RPC yang berefek |

Pengecualian sah (mis. best-effort yang disengaja) wajib beralasan; disable tanpa alasan dilaporkan oleh aturan itu sendiri:

```ts
// eslint-disable-next-line lmh/mutasi-tercek -- best-effort: log tidak boleh menggagalkan respons
await supabase.from('audit_log').insert({ ... });
```

Tidak terdeteksi secara statis: query builder yang dilewatkan antar fungsi atau dibungkus fungsi buatan sendiri, `from(...)` dari
parameter fungsi yang di-update di tempat lain, dan error yang dibaca tetapi diabaikan. Test aturan:
`src/test/eslint-mutasi-tercek.test.ts` (RuleTester + `ESLint#lintText` terhadap `eslint.config.mjs`).

Test kedua skrip gerbang: `src/test/check-audit.test.ts` dan `src/test/check-deps-sync.test.ts` (di `src/test/` karena
`vitest.config.ts` hanya mengambil `src/**` dan `supabase/migrations/**`).

## Coverage

```bash
npm run test:coverage
```

- Provider: `@vitest/coverage-v8`
- Soft thresholds: lines/functions/branches/statements **40%** (report only; raise later)
- Output: `coverage/` (gitignored)

## Smoke (running server)

```bash
# Skip network if BASE_URL unset (exit 0)
npm run smoke

# Against local or staging
BASE_URL=http://localhost:3000 npm run smoke
BASE_URL=https://staging.example npm run smoke
```

Hits `/api/health/live` and expects HTTP 200. See `scripts/smoke.mjs`.

## Migration tests

Static/contract tests under `supabase/migrations/*.test.ts` assert baseline file presence, seed policy, and SQL shape. They do **not** execute SQL against a live Postgres.

## Residual (Gate 4 — not automated yet)

| Item | Why residual | Owner path |
|---|---|---|
| **Integration against live Supabase** | Needs project credentials + Docker/CLI for local stack | Staging deploy + human |
| **Docker SQL verify** | Apply 5 baseline migrations via `supabase db push --include-all --include-seed` and smoke DB | Ops with Docker/Supabase CLI |
| **Playwright E2E** | Not added in Gate 4 (avoid half-broken harness). Plan: happy-path checkin, login, admin shell | Follow-up |
| **Lighthouse PWA/A11y** | Formal audit not run | Post-staging |
| **Gallery delete orphans** | Storage cleanup job | Product/ops |

## Local developer loop

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run verify:baseline   # deps:check + audit:check + lint + typecheck + test + build
```
