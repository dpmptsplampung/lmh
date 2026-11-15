# Fase 5: Live chat per Layanan

Catatan Fase 5 (satu percakapan per Layanan, bot di luar jam, minta petugas, email ke petugas), dipindah utuh dari `CLAUDE.md` pada 2026-11-13. Rujukan: [rencana + keputusan + inventaris jalur baca](../superpowers/plans/2026-10-31-fase-5-live-chat.md), [matriks RBAC](../analysis/04-RBAC-MATRIX.md) §9, status migrasi di [docs/MIGRATIONS.md](../MIGRATIONS.md). Arsitektur bot/RAG umum ada di butir "Chat & bot" pada [peta-kode-rinci.md](peta-kode-rinci.md).

Baris peta halaman (dari tabel "Halaman publik/pengunjung" lama):

| Path | Fungsi | API/DB utama |
|---|---|---|
| `/chat` | daftar percakapan (satu per Layanan) -> percakapan + riwayat + bot/petugas | `api/chat/{ai,messages,sesi,status,petugas}`, `DaftarPercakapan`, RPC `chat_percakapan_saya`, tabel `chat_*` |

**Live chat Fase 5 (migrasi `202610310001`/`0002`/`0003`, belum diterapkan):** percakapan = `(pengunjung_id, layanan_id)` diturunkan dari `chat_sesi` (tanpa tabel/kolom baru; sesi per kunjungan tetap untuk rekap). Lingkup chat staf `boleh_chat_sesi` (admin; FO/Petugas Koordinator; penangan sendiri; sesi terbuka) menutup celah Fase 3 di RLS dan di route (RPC dengan JWT pengguna, `lib/chat/akses.ts`). Luar jam = `chat_layanan_status` (`is_layanan_buka_jadwal` per Layanan = satu sumber kebenaran, gerbang DB chat juga per Layanan; fallback kalender global lama sebelum migrasi); riwayat lintas sesi staf: `chat_boleh_riwayat` (selain itu klien RLS): bot tetap menjawab tanpa eskalasi otomatis (`modeDariStatus` di `lib/llm/bot-waktu.ts`); minta petugas = `chat_minta_petugas` (tombol `POST /api/chat/petugas` atau niat teks `mintaPetugas` di `api/chat/ai`; implisit dari `api/chat/messages` untuk sesi `eskalasi`) -> pesan tunggu + email berdedup (`notifikasi.idempotency_key`) ke petugas ber-`email_notifikasi` terverifikasi. Q24: `chat_selesai` tanpa kalimat survei; `tutup_chat_tertinggal` menunggu hari operasional penuh. Rencana + keputusan + inventaris jalur baca: `docs/superpowers/plans/2026-10-31-fase-5-live-chat.md`; matriks `docs/analysis/04-RBAC-MATRIX.md` §9.

## Catatan refaktor 2026-11-13

- Frasa "belum diterapkan" di atas adalah keadaan saat teks ditulis; status `202610310001`-`0003`: lihat `docs/MIGRATIONS.md` dan `CLAUDE.md` bagian "Database & migrasi".
- `/chat` (G6): `src/app/chat/page.tsx` kini Server Component kecil (`revalidate = 60`) yang memuat layanan dan FAQ lewat `muatLayananPublik`/`muatFaqPublik` (`src/lib/data/publik-server.ts`) lalu mengopernya ke pulau klien `src/app/chat/ChatKlien.tsx`. Logika murni di `_logika/` (`mesinChat.ts`, `turunan.ts`, `dataAwal.ts`), hook di `_hook/` (`useSesiChat`, `usePesan`, `useKirim`, `useStatusLayanan`, `useDaftarPercakapan`, dll.), tampilan di `_bagian/` (`LayarAwal`, `JendelaPercakapan`, `FormPesan`, `BilahAtas`, dll.). Data dan pembungkus `fetch` ke `api/chat/*`: `src/lib/data/chat-pengunjung.ts`. `DaftarPercakapan` = `src/app/chat/DaftarPercakapan.tsx`.
- `/admin/chat` (G7): data `src/lib/data/chat-staf.ts`; izin murni `_logika/izinChat.ts`; hook `useDaftarSesi`, `usePesanSesi`, `useAksiChat`, `useReferensiStaf`; tampilan `_bagian/{PanelDaftar,PanelPercakapan,DialogChat}`.
- `/admin/chat/faq` (G8, `page.tsx` 151 baris): data `src/lib/data/faq.ts`; `_logika/{aksesFaq,saringFaq}.ts`; hook `useFaq`, `useAksesFaq`; tampilan `_bagian/{DaftarFaq,FilterFaq,PanelBotFaq}`. Setelah simpan/hapus/alih status FAQ, cache FAQ publik dibuang (`POST /api/admin/revalidasi`, tag `publik-faq`).
- Route `src/app/api/chat/*`, `src/lib/chat/*`, dan `src/lib/llm/*` tidak diubah oleh refaktor G0-G9.
