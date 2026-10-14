# Rancangan: Fondasi — Dependensi, Proses Migrasi, Error Halaman Publik, Consent

- Tanggal: 2026-10-13
- Status: **Rancangan hasil brainstorm dengan CEO** — belum ada implementasi. Verifikasi produksi V1–V4 **sudah dijalankan** (lihat §3).
- Asal: audit [`AUDIT-2026-10-12-MENYELURUH.md`](../../audit/AUDIT-2026-10-12-MENYELURUH.md): **T10, V1–V5, T11, T6, T7, S1**. Pelacak: [`AUDIT-2026-10-12-TRACKER.md`](../../audit/AUDIT-2026-10-12-TRACKER.md).
- Ketergantungan: bagian S1 memakai helper `mutasiInsert` dari [`2026-10-12-mutasi-tercek-design.md`](2026-10-12-mutasi-tercek-design.md).

## 1. Keputusan CEO (mengikat)

| # | Keputusan |
|---|---|
| K1 | Naikkan `next` ke ≥ 16.3.8 dan `sharp` ke ≥ 0.35.5; `npm ci` agar `node_modules` lokal sinkron dengan lockfile. |
| K2 | Gerbang **lokal** (`npm run verify:baseline`) memblokir advisory **high ke atas** (bukan hanya critical), sesuai klaim `PRODUCTION_READINESS.md`. |
| K2b | **Semua pemeriksaan CI dijalankan di lokal, tidak di GitHub**: tidak menambah atau mengubah workflow GitHub Actions; gerbang baru masuk `verify:baseline`. |
| K3 | Advisory tanpa perbaikan boleh dikecualikan **dengan alasan dan tenggat tertulis**. |
| K4 | Verifikasi produksi read-only (V1–V4) diizinkan. V5 (setting dashboard) diisi CEO. |
| K5 | 20+ migrasi yang tak tercatat dicatat **retroaktif** di dokumen, setelah dibuktikan terpasang di produksi. |
| K6 | Skrip insiden `fix-antrean-broadcast.mjs` **diarsipkan** di `docs/insiden/` (sudah dilakukan; tidak di `scripts/`). |
| K7 | **Staging** = topik terpisah; sementara cukup aturan migrasi (§4) + rollback SQL. |
| K8 | Halaman publik: error muat tampil sebagai **pesan jelas + tombol "Coba lagi"**, bukan keadaan kosong palsu. |
| K9 | Chat: daftar layanan cadangan palsu **dihapus**; ganti pesan error + "Coba lagi". |
| K10 | UMKM publik: perbaikan **minimal saja** (penanganan error); paginasi dan sisanya menunggu fitur matchmaking baru. |
| K11 | Pencatatan `consent_log` di chat dan reservasi **memblokir** proses bila gagal, sama seperti check-in (K-2). |

## 2. T10 — Dependensi

Fakta: `package.json` meminta `next ^16.2.12` dan `sharp ^0.35.3`; lockfile berisi `next 16.3.6`; `node_modules` lokal `16.2.12`. Advisory HIGH: SSRF Image Optimization GHSA-cjq9-62q9-8jv4, cache poisoning ISR (`next`), GHSA-wq5f-xc86-pv6w (`sharp`/librsvg). `ci.yml:46-47` memakai `npm audit --audit-level=critical`. `next.config.ts:36-37` mengaktifkan `remotePatterns`, jadi SSRF image relevan.

Rancangan:
1. Naikkan batas minimum di `package.json` (`next ^16.3.8`, `sharp ^0.35.5`), perbarui lockfile, `npm ci`.
2. **Sebelum menulis kode**, baca catatan rilis dan `node_modules/next/dist/docs/` untuk perubahan 16.2 → 16.3 (aturan AGENTS.md: Next 16 punya breaking changes) dan jalankan `npm run verify:baseline`.
3. Verifikasi runtime: `/api/investment-docs/*` (render PDF → PNG via `canvas`/`pdfjs-dist`/`sharp`) masih bekerja, karena `sharp` dipakai di pipeline watermark.
4. Gerbang lokal `npm run audit:check` (skrip `scripts/check-audit.mjs`) dan masuk ke `verify:baseline`: membaca `npm audit --json`, gagal bila ada advisory high+ di luar allowlist `audit-allow.json` (di root repo, bukan `.github/`) atau tenggatnya lewat. Entri allowlist: `{advisory, alasan, tenggat}`. `.github/workflows/ci.yml` **tidak diubah**.
5. Selaraskan klaim di `docs/PRODUCTION_READINESS.md` dengan kenyataan.
6. Karena pengujian hanya di lokal, tambah gerbang lokal `scripts/check-deps-sync.mjs` (masuk `verify:baseline`): gagal bila versi `next`/`sharp` terpasang di `node_modules` tidak sama dengan `package-lock.json`. Ini menutup masalah "lokal 16.2.12 vs lockfile 16.3.6" yang membuat test/build lokal tidak menguji versi yang dideploy. Dicatat di `docs/TESTING.md`.

## 3. V1–V5 — Verifikasi produksi (hasil 2026-10-13)

Dijalankan dengan skrip read-only (transaksi `READ ONLY`, hanya `SELECT`), tanpa mencetak kredensial.

| ID | Pemeriksaan | Hasil |
|---|---|---|
| V1 | `antrean_broadcast` | **OK** — memakai `realtime.send`, bukan `broadcast_changes` |
| V2 | Publikasi `supabase_realtime` | **OK** — `chat_pesan`, `chat_sesi`, `tiket_antrean`, `visit` |
| V3 | `cron.job` | 15 job; 14 aktif dan **sukses** dalam 7 hari terakhir (`notif_*`, `rollup_rekap_harian_nightly`, `bekukan_jadwal_harian`, dll.). **`absensi_alpa_otomatis` nonaktif** — sengaja dijeda oleh migrasi `202610080001` (rekomendasi F6, lihat `RUNBOOK_RBAC_TAHAP0.md`); sebelum dijeda gagal 336 kali sejak 2026-08-31 |
| V4 | Fungsi `rollup_rekap_harian`, `match_faq_teks`, `setujui_absensi`, `petugas_set_nonaktif` | **OK** — keempatnya ada |
| V5 | Dashboard: API → Max rows; Auth → rate limit login | **Menunggu CEO** (tidak bisa dibaca dari DB) |

**Koreksi audit:** ledger `supabase_migrations.schema_migrations` berisi **13 entri dan berhenti di `202607280005`** (bukan "30 Jul"). Dibanding 57 file di `supabase/migrations/`, **44 file tak tercatat** (bukan 20): `202607290001`–`202607300024` (24), `202608…` (7), `202609…` (4), `202610…` (9). Bukti pemakaian sebenarnya tetap diperiksa per objek (§4.2); keberadaan fungsi hasil migrasi akhir (V1, V4) menunjukkan migrasi tersebut terpasang, hanya tidak tercatat di ledger.

**Keputusan tertunda (baru):** kapan `absensi_alpa_otomatis` diaktifkan lagi. Syaratnya (runbook): absensi benar-benar dipakai. Dicatat di pelacak sebagai B9.

## 4. T11 — Proses migrasi

### 4.1 Aturan (berlaku mulai sekarang)
1. **Dilarang mengedit migrasi yang sudah ada** (termasuk "fix diam-diam"). Perbaikan, termasuk insiden produksi, = migrasi forward baru + test kontrak + rollback SQL di `docs/`.
2. **Dilarang menjalankan skrip ad-hoc ke DB produksi** sebagai perbaikan; satu-satunya jalur = `scripts/apply-migration.mjs` dengan konfirmasi CEO. Skrip insiden lama diarsipkan di `docs/insiden/` (sudah dipindah).
3. Setiap migrasi baru wajib dicatat di `docs/MIGRATIONS.md` dan `docs/analysis/DB-CHANGES.md` **di commit yang sama**.
4. **Penjaga otomatis**: `supabase/migrations/MANIFEST.json` (nama file → SHA-256) + test Vitest yang gagal bila (a) isi file lama berubah, atau (b) file baru belum masuk manifest. Menutup kasus commit `2a7113d` (edit in-place dengan subject tak relevan).
5. Commit yang menyentuh `supabase/migrations/` memakai subject yang menyebut migrasi (konvensi, dicek manual di review).

### 4.2 Pencatatan retroaktif (K5)
1. Skrip read-only `scripts/verify-migration-ledger.mjs` membandingkan 57 file dengan ledger dan memeriksa **objek penanda** tiap migrasi tak tercatat (tabel/kolom/fungsi/policy yang dibuatnya) di produksi → laporan: `terpasang | sebagian | tidak ditemukan`.
2. Hasil dicatat di `docs/analysis/DB-CHANGES.md` (menyambung dari entri 30 Jul) dan `docs/MIGRATIONS.md`; `docs/STATUS.md` diperbarui.
3. **Mengisi ledger DB** (`INSERT` ke `supabase_migrations.schema_migrations`) adalah tulis ke produksi → dilakukan **hanya** setelah laporan (1) bersih dan konfirmasi CEO terpisah; dengan `--dry-run` dulu. Tanpa itu, `supabase db push` di masa depan bisa mencoba menjalankan ulang 44 migrasi.

## 5. T6 + T7 — Error halaman publik (K8–K10)

**T7, chat** (`src/app/chat/page.tsx:257-264,430,457-462`): hapus daftar cadangan `fallback-N` (semua `chatbot_aktif:true`, id palsu). Gagal muat → pesan "Layanan belum dapat dimuat" + tombol **Coba lagi** (memuat ulang daftar), bukan "periksa koneksi internet" saat pengunjung memilih layanan palsu. Terkait S14: FAQ kosong senyap (`:179-187`) ikut diberi pesan error + Coba lagi; blok FAQ hardcoded (klaim "Halal GRATIS", `:188-194`) = kode mati, **dihapus**. Opsional setelah B8 (FAQ umum): saat layanan gagal dimuat, tampilkan FAQ umum bila tersedia.

**T6, UMKM** (`src/app/umkm/page.tsx:107-127,145-164,238-249,566`) — **minimal**:
- Gagal muat listing/match → pesan error + Coba lagi, bukan "Belum ada listing".
- "Tautan edit terkirim" hanya setelah `res.ok`; gagal → pesan gagal.
- Paginasi dan optimasi lain **tidak dikerjakan**: fitur UMKM lama dipensiunkan oleh matchmaking ([`2026-10-08-umkm-matchmaking-design.md`](2026-10-08-umkm-matchmaking-design.md)).

Komponen pesan error + tombol: satu komponen bersama (mis. `components/ErrorRetry`) dengan `role="alert"` agar sekaligus menutup bagian S12 untuk halaman ini.

## 6. S1 — Consent PDP memblokir

Pola acuan: `src/app/checkin/page.tsx:168-181` (K-2, sudah memblokir). Perbaiki:
- `src/app/chat/page.tsx:392-398` dan `src/app/me/reservasi/page.tsx:194-200`: insert `consent_log` diperiksa lewat `mutasiInsert`; gagal → proses **tidak dilanjutkan**, pesan "Persetujuan belum tercatat, coba lagi", tombol Coba lagi. Hapus komentar di reservasi yang mengklaim "konsisten".
- Test: simulasi insert consent gagal → sesi chat / reservasi **tidak** dibuat; sukses → dibuat. Relevan `docs/KEBIJAKAN_PDP.md:51-61`.

## 7. Pengujian & gerbang

- T10: `npm audit --audit-level=high` bersih atau semua pengecualian terdaftar; `verify:baseline`; uji manual pipeline PDF→PNG.
- T11: test manifest (ubah isi file lama → gagal; file baru tanpa manifest → gagal); laporan ledger.
- T6/T7/S1: test komponen dengan mock `{ error }` → tampil pesan + Coba lagi, tidak tampil "kosong"/"sukses"; test consent memblokir.
- Tandai "Selesai" di pelacak hanya dengan bukti (lihat aturan pelacak).

## 8. Urutan kerja

1. T10 (independen, cepat). 2. T11 aturan + manifest + skrip verifikasi ledger. 3. T6/T7 (komponen `ErrorRetry`) dan S1 (setelah helper `mutasiInsert` dari spec mutasi-tercek tersedia). 4. Pencatatan retroaktif + (opsional, konfirmasi CEO) pengisian ledger.

Model subagent: pencarian/inventaris = Haiku 5.5; implementasi komponen & skrip = Sonnet 5.5; review upgrade `next` dan skema ledger = Opus 5.5.
