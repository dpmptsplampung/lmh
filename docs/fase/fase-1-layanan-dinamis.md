# Fase 1: Layanan dinamis

Catatan Fase 1 (Instansi, website terkait, arsip layanan, jadwal tunggal per layanan), dipindah utuh dari `CLAUDE.md` pada 2026-11-13. Rujukan: [spesifikasi](../superpowers/specs/2026-10-26-layanan-dinamis-design.md), [GLOSSARY.md](../../GLOSSARY.md), [docs/adr/](../adr/), status migrasi di [docs/MIGRATIONS.md](../MIGRATIONS.md).

**Layanan dinamis (Fase 1, migrasi `202610270001`/`0002`, belum diterapkan):** admin menambah/mengarsipkan layanan dan mengelola Instansi + website terkait di `/admin/layanan` (view publik `v_layanan_publik`). **Sumber kebenaran jadwal = `jadwal_standby` + `hari_libur`** (halaman `/admin/settings/jadwal` menulis keduanya; layanan baru otomatis dapat jadwal default Senin–Jumat 08:00–15:30; jam tutup per layanan ≤ `jam_tutup_layanan()` 16:00). Tabel `layanan_jadwal`/`layanan_libur` tidak lagi dibaca/ditulis aplikasi (dibiarkan, data lama utuh). `is_layanan_buka_jadwal` menolak layanan terarsip dan `hari_libur`. Konteks: `GLOSSARY.md`, `docs/adr/`, spesifikasi `docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md`.

## Catatan refaktor 2026-11-13

- Frasa "belum diterapkan" di atas adalah keadaan saat teks ditulis. `docs/MIGRATIONS.md` masih memberi judul "BELUM DITERAPKAN" untuk `202610270001`/`0002`, tetapi sebagian judul di sana terbukti tertinggal (lihat `CLAUDE.md` bagian "Database & migrasi"). Periksa dulu sebelum mengandalkan statusnya.
- Data layanan publik (`v_layanan_publik`) kini dibaca di server lewat `src/lib/data/publik-server.ts` (`muatLayananPublik`, cache 60 detik, tag `publik-layanan`). Setelah menyimpan, `/admin/layanan` memanggil `segarkanPublik` (`src/lib/data/klien/segarkanPublik.ts` -> `POST /api/admin/revalidasi`) untuk tag layanan dan beranda.
- Daftar ringkas layanan untuk layar staf: `muatLayananRingkas` di `src/lib/data/referensi.ts` (kolom `KOLOM_LAYANAN_RINGKAS`), dipakai lewat `src/lib/data/klien/useReferensi.ts`.
- G3 hanya mengubah tampilan (`Tombol`, token); tidak ada berkas fase ini yang berpindah.
