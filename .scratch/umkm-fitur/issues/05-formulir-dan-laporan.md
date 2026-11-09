# 05 formulir dan laporan

Status: ready-for-agent
Wave: G2
Blocked by: 01, 07

## What

Short contact form (umkm_kirim_pesan_kontak), profile or photo report, shared quiet rate guard (check_anon_rate pattern), both added to the officer task list.

## Requirements

K-A-05, K-A-06, K-NF-10

## Tests

U-01 (report part), U-07 in `docs/umkm/MIGRASI-RILIS-UJI.md`.

## Detail (PM, 2026-11-09)

Migration `202611090003_umkm_pesan_laporan.sql`. Ticket 07 text ships in the same or an earlier commit than the form.

**Tables.** `umkm_pesan_kontak` per `docs/umkm/SISTEM.md` section 3, with an optional private keyword. `umkm_laporan`: profile, optional photo, one reason, optional note, status, handler, version, times. Reasons: `penipuan`, `nomor_tampil`, `data_salah`, `foto_tidak_pantas`, `lainnya`. RLS on, no direct grants to anon, authenticated, or `service_role`.

**Public RPCs.** `umkm_kirim_pesan_kontak` and `umkm_laporkan` return an opaque receipt id and echo no submitted text. Callable with a session, including anonymous sign-in: the page signs in anonymously when there is no session, as existing visitor flows do. Idempotent by operation key with no PII in retry data. These fields are private and exempt from the contact check.

**Shared rate guard.** One function for every public write, `check_anon_rate` pattern, on the existing `public.anon_rate_limit` table, which `prune_anon_rate_limit` already cleans. The per-caller limit applies per action, so likes in ticket 08 keep their own limit. `check_anon_rate` returns true when `auth.uid()` is null, so the guard rejects a null uid. New anonymous ids are cheap, so it also applies a per-action ceiling across all callers. Limits are internal constants, never shown. Over the limit: 429 with retry information.

**Report entry.** `Laporkan` sits on the profile page only, because a report needs a profile. The catalog page offers only the contact form. A contact message naming a profile that is not published stores no profile and returns the same receipt, so the form cannot reveal whether a profile exists.

**Officer list.** `umkm_daftar_tugas` now mixes `profil`, `pesan`, `laporan`, discriminated by `jenis`. The old uuid-cursor signature may be dropped and replaced by this migration. Urgent first, then oldest receipt, at most 20, from indexed sources before LIMIT. Urgent means `umkm_profil.mendesak` or an open `penipuan` or `nomor_tampil` report, because a number shown in public is a leak. A fraud report does not set `mendesak`; ticket 06 does that.

**Officer actions.** Detail, take over (same label, no timer), and one click to finish:

- Message: "Tandai sudah dibalas" sets `ditangani` and the first reply time. The screen shows the sender's contact, a `wa.me` link for the officer's own WhatsApp, and the copyable Phase A reply text from `docs/umkm/ALUR-DAN-PERAN.md` section 8.
- Report: "Selesai". Linked to the profile so the officer can correct or hide it in one step.

Any active reviewer may read them. FO and admin without the flag get no contents. No form or report content in logs, audit, or `umkm_riwayat`.

The 180-day retention job is ticket 09.

## Comments

2026-11-09: kode formulir, laporan, dan antrean campuran serta perbaikan tinjauan selesai, gate lulus. Formulir belum boleh dibuka sebelum pembersihan tiket 09 berjalan. Belum di-commit, menunggu persetujuan pemilik; migrasi belum diterapkan. Lihat `.scratch/umkm-fitur/PROGRES.md`.
