# Database Migrations

## Baseline Fresh-Only

Direktori `supabase/migrations/` berisi lima migrasi final-state untuk proyek yang belum pernah dideploy:

1. `202607140001_extensions_and_preflight.sql`: ekstensi dan pemeriksaan prasyarat.
2. `202607140002_core_schema.sql`: layanan, akun individual, pengunjung, konten, absensi, dan visit spine.
3. `202607140003_feature_schema.sql`: chat, FAQ/AI, UMKM, investasi, rate limit, audit/consent, SKM, dan notifikasi.
4. `202607140004_security_and_automation.sql`: helper, RLS, storage, dan trigger.
5. `202607140005_views_and_jobs.sql`: public projections, estimasi antrean, dan jadwal `pg_cron`.

Baseline ini menggantikan histori pengembangan `001` sampai `038`. Baseline hanya boleh diterapkan ke database kosong. Git history adalah arsip histori SQL; jangan menyalin migrasi lama kembali ke direktori aktif.

## Apply Dengan CLI

Dengan Supabase CLI `2.107.0`, terapkan seluruh baseline dan production seed ke proyek fresh yang sudah ditautkan dengan satu perintah:

```bash
supabase db push --include-all --include-seed
```

Untuk reset database lokal dan menerapkan migrasi beserta `supabase/seed.sql`:

```bash
supabase db reset
```

Flag `--include-all` dan `--include-seed` diverifikasi melalui `supabase db push --help`. Jangan menempel SQL secara manual di Dashboard atau SQL Editor. CLI menjaga urutan, pencatatan versi, dan hasil yang dapat direproduksi.

## Seed Policy

`supabase/seed.sql` hanya berisi sembilan layanan final dan konfigurasi/konten awal yang aman untuk produksi. File ini tidak membuat akun Auth, kredensial, nomor WhatsApp palsu, maupun data demo.

`supabase/seed-demo.sql` bersifat eksplisit untuk development/staging. Jangan jalankan file tersebut di produksi dan jangan pindahkan isinya ke migrasi atau production seed.

## Setelah Deploy Pertama

Setelah baseline pertama kali diterapkan ke environment mana pun, kelima file baseline bersifat immutable. Semua perubahan schema berikutnya wajib dibuat sebagai forward migration baru dengan timestamp lebih besar. Jangan mengedit, mengganti nama, menghapus, atau squash baseline yang sudah diterapkan.

## Gate 1B (pre-deploy baseline hardening)

Sebelum deploy pertama, baseline diedit in-place (bukan forward migration ke-6) untuk:

- `consent_log_insert_own` ownership binding (`subjek_ref = auth.uid()` atau pengunjung milik user).
- `audit_change()` hanya menyimpan metadata allowlist (id/status/role/timestamps/actor), bukan full row JSON.
- `notifikasi`: kolom `claim_token`, `claimed_at`, `available_at`, `idempotency_key`, status `processing`, partial unique index, plus RPC `claim_notifikasi` / `complete_notifikasi` (EXECUTE hanya `service_role`).

## Forward Migrations

Setelah baseline, perubahan schema dicat sebagai forward migration:

6. `202607200001_p0_security_governance.sql`: hardening P0 — policy `visit_insert_walk_in` mengikat `pengunjung_id` ke pemilik akun, trigger guard kolom staf `chat_sesi`, policy insert `listing_umkm` dibatasi `draft`/`pending_review` untuk petugas, audit eskalasi role petugas, anti-backdate `absensi_petugas` via trigger (plus status `ditolak`), dead-letter notifikasi `retry_count >= 5`, retensi `chat_ai_log` 90 hari via pg_cron 03:30, RPC publik `get_queue_position(p_qr_token uuid)`, dan trigger notifikasi baru (balasan chat petugas, status inquiry UMKM, konfirmasi reservasi).
7. `202607210001_walkin_kontak_dan_layanan_perizinan.sql`: kolom `visit.kontak_hp` (opsional, diisi petugas saat registrasi walk-in) dan baris layanan baru `Layanan Perizinan DPMPTSP Provinsi Lampung` (tipe `konsultatif`, idempotent via `ON CONFLICT (nama) DO NOTHING`).
