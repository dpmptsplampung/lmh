# Subagent-Driven Development Progress Ledger

Plan: `docs/superpowers/plans/2026-07-23-live-chat-gemini-plan.md`

## Tasks
- [x] Task 1: Strict Legal Grounding & Gemini Prompt Configuration (commits & tests clean)
- [x] Task 2: Anti-Prompt Injection & Output PII Sanitization (commits & tests clean)
- [x] Task 3: Officer Copilot Draft API (`/api/chat/ai/draft`) (commits & tests clean)
- [x] Task 4: Interactive UX Public Chat (`src/app/chat/page.tsx`) (commits & tests clean)
- [x] Task 5: Admin Panel Copilot Integration & Legal Grounding in FAQ (commits & tests clean)

---

Plan: `docs/superpowers/plans/2026-07-30-wp21-dual-write-implementation.md`

## WP-21 Tasks
- [x] Task 1: Private `buku_tamu` foundation and static contract test (focused 10 tests, independent review clean; no commit requested)
- [x] Task 2: Traceable backfill and atomic dual-write trigger (focused 16 tests, independent review clean; no commit requested)
- [x] Task 3: Guarded production verifier (selftest-wp21.mjs — remediated Phase 3 + Phase 4 PASS; commits & tests clean)
- [x] Task 4: Transition records and controlled production cutover (M15+M16 DITERAPKAN 2026-07-30 13:17 WIB; selftest PASS; 11/11 tests; DB-CHANGES updated)
- [x] Task 5: WP-22 handoff evidence (cutover facts + rollback window recorded; selftest PASS 13:47 WIB; WP-22 boundary set in DB-CHANGES)

## WP-22 + WP-23 Tasks (2026-07-30)
- [x] WP-22: admin/kunjungan/page.tsx → kunjungan + tiket_antrean
- [x] WP-22: admin/page.tsx → kunjungan + tiket_antrean
- [x] WP-22: admin/antrian/page.tsx → tiket_antrean (write masih ke visit)
- [x] WP-22: M16 views migration — v_antrian_loket + get_queue_position → tiket_antrean (applied ✓)
- [x] WP-22: layar-antrian/page.tsx — Realtime subscribe → tiket_antrean
- [x] WP-23: tandai_tidak_terlayani_akhir_hari() + cron 15:35 WIB (applied ✓)
- [x] WP-23: panggil_tiket() + tombol Panggil di antrian page (applied ✓)
- [ ] WP-24: Hentikan penulisan ke visit — DIBLOKIR: butuh ≥2 minggu WP-22 stabil + persetujuan manusia

## WP-25..32 Tasks (2026-07-30)
- [x] WP-25: chat_pesan.jenis_jawaban + 2 index (applied ✓)
- [x] WP-26: site_settings kolom + konten_versi table (applied ✓)
- [x] WP-27: dokumen_peraturan + dokumen_potongan + match_dokumen() (applied ✓)
- [x] WP-28: (depends on WP-27; migration deferred — schema ready for WP-28 code)
- [x] WP-29: layar_token + v_layar_antrian + validate_layar_token() + kode TV + admin layar (applied ✓)
- [x] WP-30: rekap_harian_layanan + laporan_snapshot + rollup_rekap_harian() + cron (applied ✓)
- [x] WP-31: listing_umkm kolom verifikasi + umkm_verifikasi_jejak + expired cron (applied ✓)
- [x] WP-32: jejak_minat_investasi (applied ✓) + /peta-potensi page (wajib login, log jejak)

## Kode Halaman WP-27/30/31/32 (2026-07-30)
- [x] WP-27: admin/dokumen/page.tsx + /api/admin/dokumen/embed (chunking + Gemini embed) ✓
- [x] WP-30: admin/rekap/page.tsx (tabel rekap + manual rollup + CSV export) ✓
- [x] WP-31: umkm_verifikasi_jejak schema siap; UI verifikasi ada di admin/umkm (status update + catatan)
- [x] WP-32: peta-potensi/page.tsx (6 sektor, login gate, jejak logging) ✓
- [x] admin-nav.ts: Rekap Harian + Dokumen Peraturan + Kelola Layar ditambahkan ✓
