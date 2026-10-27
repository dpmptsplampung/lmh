# Identitas pengunjung satu kesatuan (2026-10-27)

Keputusan pemilik; migrasi `202611010003` (aturan) dan `202611010004` (backfill). Belum diterapkan.

## Masalah
`kunjungan` diisi FO (email opsional: banyak pengunjung enggan memberi email ke FO). Petugas layanan melengkapi data di formulir
`pelayanan_oss`/`pelayanan_perizinan` atau Pendataan Khusus, tetapi hasilnya tidak kembali ke `kunjungan`. Akibatnya baris FO di
rekap, saran pengunjung lama, dan email survei (membaca `kunjungan.email`) tetap kosong; FO tak bisa membaca hasil tiket yang
sudah selesai (Fase 3); email formulir boleh "Tidak berlaku".

## Struktur data (setelah perubahan)
```
kunjungan  = DATA INDUK (nama, kontak_hp, email, asal_instansi, kategori, keperluan)   diisi FO, dilengkapi layanan
 ├─ penanganan tahap FO       (hasil dieskalasi)
 ├─ penanganan tahap Layanan  (+ tiket_antrean)  ── pelayanan_oss / pelayanan_perizinan  (formulir, SELESAI -> email NYATA wajib)
 │                                                └─ pendataan_khusus_jawaban            (layanan non-OSS)
 └─ tulis balik identitas formulir/Khusus -> kunjungan (sebelum status selesai; audit_log)
```

## Keputusan
| # | Keputusan | Alasan / biaya bila keliru |
|---|---|---|
| 1 | Nilai terbaru menang (menimpa), hanya kolom yang berubah, dicatat `audit_log` (nilai lama/baru) | Sama dengan Fase 4. Bila keliru: koreksi dari `audit_log` |
| 2 | Nilai pengganti ("Tidak berlaku", "-", "Belum ada", ...) dan nilai tak valid TIDAK ditulis balik | Email survei tidak boleh terkirim ke "Tidak berlaku" |
| 3 | Email NYATA wajib saat tiket layanan selesai (trigger `tiket_antrean`, semua jalur); selesai di FO tanpa eskalasi bebas | Aturan pemilik. Klien lama yang mengirim "Tidak berlaku" ditolak: deploy bersama migrasi |
| 4 | Email akun pengunjung (Google/reservasi) dihitung sebagai email yang ada | Pengunjung login tak perlu mengetik ulang |
| 5 | FO pencatat (`kunjungan.dibuat_oleh`) membaca tahap, formulir, Khusus kunjungannya, read-only; FO lain tidak | Melonggarkan "data per orang" Fase 3 hanya untuk pendaftar kunjungan itu; Rekap tidak berubah |
| 6 | Backfill data lama = migrasi terpisah, hanya mengisi kolom kosong, jejak per kunjungan, rollback tersedia | Mengubah data nyata: hanya pemilik yang menerapkan |
| 7 | Kolom `[OSS] Email` / `[Non OSS] Email` di Rekap dipertahankan | Permintaan pemilik |
| 8 | `layanan_selesai_khusus` 4 argumen diganti 5 argumen (default NULL) | PostgREST tak boleh melihat dua kandidat; klien lama tetap jalan |

## Bukti
- `node scripts/lokal-rantai/skenario-identitas.mjs` (PGlite, seluruh rantai): 46 cek (tolak "Tidak berlaku"/format salah dan rollback penuh, tulis balik, nilai pengganti tidak mengotori, email survei memakai email baru, FO pencatat read-only, backfill + idempoten + rollback, rollback 0003).
- `supabase/migrations/identitas_satu_kesatuan.test.ts` (kontrak statis), `src/lib/types/pelayanan.test.ts`, `SelesaiEskalasiModal.test.tsx`, `penanganan.test.tsx`.

## Tidak dicakup
Live chat (pengunjung login Google selalu punya email); UI ringkasan formulir lengkap untuk FO (FO membaca lewat data induk dan riwayat Penanganan; RLS sudah mengizinkan baca formulir bila UI ditambah); pengecekan di browser.
