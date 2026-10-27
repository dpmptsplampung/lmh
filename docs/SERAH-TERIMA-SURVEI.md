# Serah terima: Survei terpadu "Pesan Perilaku" (Fase A)

Ditulis 2026-10-27. Branch `feat/survei-terpadu-a` (worktree `.claude/worktrees/survei-terpadu-a`), dikerjakan sesi "Perbaikan kecil hasil audit LMH" lalu dilanjutkan sesi utama. Konteks proyek yang lebih luas: `docs/SERAH-TERIMA-LAYANAN-DINAMIS.md` (ada di branch `feat/fase-1-fondasi-layanan`).

Rancangan: `docs/superpowers/specs/2026-10-26-survei-terpadu-design.md`. Rencana: `docs/superpowers/plans/2026-10-26-survei-terpadu-fase-a.md`. **Catatan keputusan pelaksana (R1–R15) dan temuan yang ditunda: `docs/superpowers/plans/2026-10-26-survei-terpadu-fase-a-ledger.md`** (salinan dari `.superpowers/sdd/.../progress.md` yang di-ignore Git, jadi tidak ikut ke mesin lain kalau tidak disalin).

Pemilik menamai seluruh fitur (survei + saran + pengaduan) **"Pesan Perilaku"** (R13): teks untuk pengguna memakai nama itu; judul sub-survei SPAK/SKM tetap seperti di spesifikasi.

## Status task

| Task | Commit | Isi |
|---|---|---|
| spesifikasi, rencana | `8f55e9e`, `8abfef7` | Dokumen |
| 1 | `4ee6078`, `c5fdf78` | Harness PGlite untuk verifikasi perilaku DB tanpa produksi (`scripts/lokal`) |
| 2 | `a902a43`, `a78b333` | `survei_undangan`, trigger selesai, QR staf, view status |
| 3 | `1318013` | Jawaban survei 11 unsur, `spak_respons`, ringkasan IKM/SPAK/response rate |
| 4 | `7f4255d` | RPC `get_survei_context`, `kirim_survei` atomik |
| 5 | `d52cc72` | Email/push memakai tautan undangan |
| 6–8 | `ab76ba4`, `a9102a1`, `5fcdb8f` | Konfigurasi pertanyaan (uji golden), logika wizard, `POST /api/survei/kirim` |
| 9 | `19134d7` | Wizard publik `/survei/<token>` |
| 10 | `b490257` | QR staf, lencana status, integrasi antrean FO dan layanan |
| 11 | `3800e89` | Unduhan XLSX untuk Admin dan FO |
| 12 | — | `/admin/skm`: ringkasan IKM baru, tab SPAK, tombol unduh (lihat "Sisa") |
| 13 | — | Dokumentasi dan gate akhir (lihat "Sisa") |

Per-task review dilewati untuk Task 5–13 atas permintaan pemilik (R15); yang tersisa **satu review menyeluruh dan satu gate penuh di akhir**.

## Sisa pekerjaan

1. **Task 12** (rincian di rencana, Task 12): buat `src/components/admin/SpakPanel.tsx`, ubah `src/app/admin/skm/page.tsx` (satu panggilan `ringkasan_ikm` menggantikan loop `hitung_ikm`; tab IKM dan SPAK; tab SPAK dan tombol Unduh hanya untuk Admin/FO) dan `skm.test.tsx`. Test `SpakPanel.test.tsx` sudah ditulis tetapi belum di-commit.
2. **Task 13**: `CLAUDE.md`, `docs/analysis/04-RBAC-MATRIX.md`, `docs/STATUS.md`; jalankan lint, typecheck, test, build.
3. **Satu review menyeluruh** atas seluruh branch (fokus: RPC publik tanpa login, token undangan, pembatasan laju, RLS jawaban).
4. **Nomori ulang migrasi** sebelum digabung. Migrasi survei bernomor `202610270001–0004` bentrok dengan Fase 1 (`202610270001`, `0002`), padahal ledger produksi memakai nomor depan sebagai `version`. Ganti ke nomor setelah `202611010001` (mis. `202611020001–0004`), termasuk nama berkas test, `MANIFEST.json`, `FORWARD_MIGRATION_FILES`, dan rujukan di test (`survei_*.test.ts`, `scripts/lokal`).
5. Gabungkan dengan `feat/fase-1-fondasi-layanan`: branch ini berpangkal pada `main` lama (`49409c4`) dan tidak memuat Fase 1–6.

## Migrasi survei (ditulis, belum diterapkan; setelah dinomori ulang)

`survei_undangan` → `survei_jawaban` → `survei_rpc` → `survei_notifikasi`. Terapkan hanya oleh pemilik: `--atomic --dry-run` dulu.

## Keputusan pemilik yang masih terbuka

- Teks email/push survei masih menyebut "SKM" (hanya tautannya yang diganti); sesuaikan dengan "Pesan Perilaku" sebelum aplikasi pertama dikirim.
- Kapan halaman `/skm` lama dipensiunkan setelah cutover (pada kunjungan yang sudah punya jawaban lama, `kirim_survei` mengembalikan duplikat dan `diisi_pada` tidak terisi).
- `ringkasan_ikm` dapat dibaca petugas, termasuk agregat FO dan tidak terklasifikasi (spesifikasi 7.4 menyebut petugas hanya layanannya; R11 diterima).
- `hitung_ikm` memakai `created_at::date` (zona sesi) sedangkan `ringkasan_*` memakai tanggal WIB: selisih pada 00:00–07:00 WIB.
- Fase berikutnya (di luar Fase A): saran dan pengaduan terhubung.

## Menjalankan di mesin lain

```bash
git fetch origin && git switch feat/survei-terpadu-a
npm ci
npm i --no-save @electric-sql/pglite   # harness DB lokal (R5); jangan masuk package.json
npx vitest run --pool=vmForks src/lib/survei src/app/api/survei src/app/api/admin/survei supabase/migrations
```

Aturan kerja: lihat `AGENTS.md` (tanpa push, tanpa kunci produksi, migrasi hanya diterapkan pemilik).
