# Peta kode rinci (versi CLAUDE.md sebelum 2026-11-13)

Daftar rinci per domain, halaman, API, `lib/`, komponen, dan tabel yang dulu ada di `CLAUDE.md`, dipindah utuh pada 2026-11-13 ketika `CLAUDE.md` dipangkas menjadi peta per folder. Teks di bawah adalah keadaan sebelum refaktor G0-G9 selesai; perubahan yang sudah diperiksa dicatat di bagian akhir. Daftar catatan per fase: [CLAUDE.md](../../CLAUDE.md) bagian "Catatan per fase dan domain", dan berkas lain di folder ini.

## Domain (dari bagian "Arsitektur" lama)

**Domain (halaman di `src/app/*`, API di `src/app/api/*`)**
- Pelayanan/antrean: `checkin`, `admin/{kunjungan,scan,antrian,absensi}`, `layar/[token]` (layar TV bertoken 8 angka; maks 8 kartu per halaman, bergantian 8 detik; pita panggilan dari tabel `panggilan_layar`; layar lama `layar-antrian` dihapus 2026-11-03), `me/reservasi`. Model data "Visit Spine": tabel `kunjungan` + `tiket_antrean` (sumber kebenaran; `visit` lama kini arsip baca-saja: WP-24 = migrasi `202610140007`/`0008` sudah DITERAPKAN ke produksi 2026-10-14 malam bersama 0002-0013, lihat `docs/MIGRATIONS.md` dan `docs/RUNBOOK_FO_ESKALASI.md` §12). Penomoran antrean atomik di DB (RPC/counter), absensi petugas jadi gerbang antrean, jadwal harian dibekukan. Helper: `src/lib/pelayanan.ts`, `lib/types/pelayanan.ts`, `lib/hooks/useRealtimeRefetch.ts` (Supabase Realtime), `components/{WalkinWizard,EstimasiAntrean}`, `components/admin/*Wizard*`.
- Chat & bot: `chat`, `admin/chat/*`, `api/chat/{ai,messages,sesi}`. `api/chat/ai/route.ts` = RAG (FAQ + `dokumen_peraturan` via pgvector 3072-dim & FTS) dengan `lib/gemini.ts`, rantai LLM multi-vendor + circuit breaker + kuota harian di `lib/llm/registry.ts` (env `LLM_CHAT_PROVIDERS` format `provider:model,...`), redaksi PII/deteksi prompt-injection di `lib/pii.ts`, eskalasi otomatis ke petugas. Embedding admin: `api/admin/{faq,dokumen}/embed`.
- Rekap terpadu (Fase 3): `admin/rekap` (tab: Rekap Harian, Helpdesk OSS, Non OSS, Data Pelayanan + Excel, Kinerja Petugas; tab Helpdesk OSS/Non OSS terkunci ke Layanan berformulir `oss`/`perizinan` agar kolom formulir langsung tampil dan hanya muncul bila Layanan itu ada dalam lingkup pengguna; tab Data Pelayanan = Layanan lain (mengirim `tanpa_form=1` -> `rekap_data_pelayanan(..., p_tanpa_form)`, migrasi `202611010005`, belum diterapkan; Harian/Kinerja tetap semua Layanan); `admin/rekap-fo` redirect) -> `api/admin/rekap/terpadu[/export]` -> RPC berlingkup `rekap_data_pelayanan`/`rekap_harian_terpadu`/`rekap_kinerja_petugas` (migrasi `202610290002`); logika di `src/lib/rekap/{terpadu,terpaduServer,excelTerpadu}.ts`. `admin/performa` (Admin) tetap. IKM/SKM: `skm` (tab IKM dan SPAK, RPC `ringkasan_ikm`/`ringkasan_spak`, unduhan `api/admin/survei/export`), `transparansi`, `lib/ikm.ts`. Pengaduan (`pengaduan`, `api/pengaduan`), `standar-pelayanan`, Katalog UMKM (`umkm/katalog`, `api/umkm-katalog`, `api/umkm-pemilik`, admin `umkm-tugas`/`umkm-pengawasan`/`umkm-laporan`; rencana `docs/umkm/`; marketplace lama `/umkm` DIHAPUS 2026-11-10, alamat lama diarahkan di `next.config.ts`, tabel lama tetap di DB), investasi/gallery/`peta-potensi` (PDF di-render jadi PNG ber-watermark: `api/investment-docs/*`, `canvas`/`pdfjs-dist`/`sharp`), konten landing via CMS registry (`lib/site-settings.ts`).
- Notifikasi: trigger DB → `api/notif/{send,retry}` dipanggil cron (header `Authorization: Bearer $CRON_SECRET`); Resend (`lib/email-html.ts`) + web-push (`public/sw-push.js`). PWA offline: `public/sw.js`, `lib/offline/{queue,replay}.ts` (IndexedDB queue + replay check-in).
- Observability: `lib/observability/logger.ts` (`logServerEvent`), tabel error log, `api/health/{live,ready,error}`.

## Peta file lengkap (`src/`)

Pola umum: halaman (`page.tsx`) adalah **client component besar yang berisi logika + query Supabase langsung** (mis. `chat` ~980, `admin/antrian` ~700). Style = `*.module.css` di sebelah halaman, token global di `styles/globals.css`. Komponen bersama sedikit; jarang ada hook/util khusus per halaman. `app/admin/layout.tsx` memasang Sidebar+AdminGuard; `app/me/layout.tsx` untuk dashboard pengunjung; `app/layout.tsx` root (SW register, offline banner, toast).

**Halaman publik/pengunjung** (`src/app/…/page.tsx`)
| Path | Fungsi | API/DB utama |
|---|---|---|
| `/` | etalase: blok tetap (`homepage_blok`, diatur `/admin/settings/landing`) + kartu layanan otomatis + popup `/?layanan=<slug>` | `lib/homepage/{blok,data,status}`, `components/homepage/*`, `v_layanan_publik`, RPC `layanan_status_hari_ini` |
| `/login`, `/auth/callback` | login Google OAuth/magic-link/anon | Supabase Auth |
| `/checkin` | halaman informasi statis (walk-in & scan QR dilakukan Front Office: `/admin/fo/daftar`, `/admin/scan`; `api/checkin` dihapus, RPC `fo_mulai_kunjungan`) | `WalkinWizard` (dipakai FO), `lib/offline/*` |
| `/me`, `/me/reservasi`, `/me/notifications` | dashboard pengunjung | `kunjungan`, `notifikasi` |
| `/chat` | daftar percakapan (satu per Layanan) -> percakapan + riwayat + bot/petugas | `api/chat/{ai,messages,sesi,status,petugas}`, `DaftarPercakapan`, RPC `chat_percakapan_saya`, tabel `chat_*` |
| `/skm` (redirect ke `/`), `/transparansi` | SKM lama DIHAPUS (keputusan pemilik 2026-10-28; ganti Pesan Perilaku); IKM publik | `lib/ikm`, `IkmPanel` |
| `/survei/<token>` | wizard publik **Pesan Perilaku** (SPAK 5 pernyataan + SKM 9-11 unsur; tanpa login, token undangan per kunjungan) | `api/survei/kirim`, `lib/survei/*`, RPC `get_survei_context`/`kirim_survei` (migrasi survei, belum diterapkan) |
| `/pengaduan`, `/pengaduan/lacak` | pengaduan 2 jalur + lacak | `api/pengaduan[/lacak]` |
| `/umkm/katalog`, `/umkm/katalog/[id]` | katalog UMKM publik (kepala/kaki sendiri di `KerangkaKatalog`); `/umkm`, `/umkm/inbox`, `/umkm/edit/*` lama dialihkan ke sini | `api/umkm-katalog/*`, `components/umkm-katalog/*` |
| `/gallery`, `/peta-potensi` | investment gallery (PDF→PNG watermark), peta potensi | `api/investment-docs/*`, `api/investasi/lead` |
| `/standar-pelayanan`, `/kebijakan-privasi`, `/offline` | statis/PWA fallback | — |
| `/layar/[token]` | layar TV antrean (token 8 angka; layanan aktif berjadwal hari ini; urutan dan nama tampil diatur di `/admin/layar`) | `v_layar_antrian`, `layar_token`, `panggilan_layar`, RPC `layanan_status_hari_ini` |

**Admin** (`/admin/*`, akses per role di `lib/admin-nav.ts`): `/admin` dashboard · `kunjungan` · `scan` (QR) · `antrian` (panggil/selesai, `PelayananWizardModal`) · `absensi` · `chat` (+`faq`, `ai-log`) · `umkm-tugas` · `umkm-pengawasan` · `umkm-laporan` · `gallery` · `investasi-leads` · `skm` · `pengaduan` · `petugas` (+`invite`) · `rekap` · `dokumen` (RAG peraturan) · `layar` · `data-governance` · `settings` (+`jadwal`, `landing`).

**API route handlers** (`src/app/api/**/route.ts`, tiap route punya `*.test.ts` di sebelahnya; kebanyakan `force-dynamic`, validasi zod, service-role bila perlu):
- `admin/`: `dokumen/embed`, `faq/embed`, `instansi[/id]`, `layanan[/id[/arsip|/tautan]]` (kelola layanan dinamis, admin saja; galat via `layanan/_galat.ts`), `layar`, `pelayanan/[tiketId]`, `pengaduan`, `petugas/{invite,status,[id]/koordinator}`, `rekap/{terpadu[/export],performa}`
- `chat/`: `ai` (RAG), `ai/draft` (draft balasan untuk petugas), `messages` (+`?riwayat=1` riwayat lintas sesi), `sesi`, `status` (petugas chat tersedia?), `petugas` (minta petugas)
- publik: `skm/submit`, `pengaduan`, `pengaduan/lacak`, `umkm-katalog/*`, `umkm-pemilik/*`, `investasi/lead[/id]`
- `investment-docs/`: `upload`, `[id]`, `page-image`, `public-view`, `signed-url`
- `notif/{send,retry}` (cron, `CRON_SECRET`) · `health/{live,ready,error}` (logika di `health.ts`)

**`src/lib/`** — `time.ts` (WIB) · `constants.ts` (nama layanan & status; nama layanan harus cocok seed DB) · `utils.ts` (format tanggal/durasi, `waLink`, `cn`) · `pelayanan.ts` + `types/pelayanan.ts` (tipe form pendataan OSS/perizinan, akses petugas) · `admin-nav.ts` · `ikm.ts` · `csv.ts` · `pii.ts` · `email-html.ts` · `site-settings.ts` · `gemini.ts` (embedding + prompt RAG) · `llm/registry.ts` · `llm/profil-layanan.ts` (profil layanan untuk prompt bot, termasuk jadwal) + `llm/profil-layanan-server.ts` (pemuat bersama chat & pratinjau admin; select layanan fallback bila kolom baru belum ada) · `layanan/schemas.ts` (zod instansi/layanan/tautan: https saja, batas panjang) · `chat/{normalize,status-layanan,minta-petugas,percakapan,akses,riwayat}.ts` · `hooks/useRealtimeRefetch.ts` · `offline/{queue,replay}.ts` · `observability/logger.ts` · `env/{server,client}.ts` · `supabase/{client,server,service}.ts` · `rekap/{terpadu,terpaduServer,excelTerpadu,schemas,format,exportAll,performa,akses}.ts` · `akses-data/{lingkup,galat}.ts` (penanda Koordinator, label lingkup, deteksi migrasi belum diterapkan).

**`src/components/`** — `WalkinWizard`, `EstimasiAntrean`, `IkmPanel`, `QRCode`, `Toast`, `Pagination`, `OfflineBanner`, `ServiceWorkerRegister`, `ProfileCompletenessGate`; `admin/{AbsensiWizardModal,PelayananWizardModal,AmbilAlihTiketModal,PemberitahuanAmbilAlih}`; `layout/{AdminGuard,Sidebar,PageHeader}`.

**Root `src/`**: `proxy.ts` (middleware), `instrumentation.ts` (validasi env + `onRequestError`), `test/` (setup + test konfigurasi: CSP, service worker, vitest config). Test lintas-cutting lain: `layout.a11y.test.tsx`, `styles/globals.a11y.test.ts`, `chat.rls.test.tsx`, `consent.ownership.test.ts`.

## Peta database (Supabase/Postgres)

Dari 50-an migrasi di `supabase/migrations/` (urutan = nama file). Kelompok tabel:
- Pelayanan: `instansi` (migrasi `202610270001`), `layanan` (+ `instansi_id`, `slug`, `deskripsi`, `urutan`, `konten_sumber_url`, `konten_diperbarui_at`, `diarsipkan_at`), `layanan_tautan` (website terkait), `layanan_{hari,kontak}`, `jadwal_{harian_beku,pengecualian,standby}`, `hari_libur`, `kunjungan`, `tiket_antrean`, `antrean_counter`, `visit` (lama, dual-write), `buku_tamu`, `absensi_petugas`, `pelayanan_{oss,perizinan}`, `pengunjung`, `petugas`, `layar_token`, `rekap_harian_layanan` (lama, tidak dibaca aplikasi lagi), `laporan_snapshot`, `ambil_alih_pendataan` (Fase 3)
- Chat/AI: `chat_sesi`, `chat_pesan`, `chat_ai_log`, `faq_knowledge_base`, `faq_sinonim`, `dokumen_peraturan`, `dokumen_potongan`
- UMKM/investasi: `listing_umkm`, `umkm_inquiry`, `umkm_listing_owner`, `umkm_verifikasi_jejak` (milik marketplace lama yang dihapus dari aplikasi; data tetap), tabel katalog baru `umkm_*` (migrasi `2026110900*`; produk per revisi `umkm_produk`, kolom profil kecamatan/nama_pemilik/bentuk_usaha/tahun_mulai/omzet_rentang/tenaga_kerja_rentang, `umkm_foto.utama`/`produk_urutan` di migrasi `202611100001`-`0003`, belum diterapkan; rencana `docs/superpowers/plans/2026-11-10-umkm-produk-formulir.md`), `investment_documents`, `investasi_lead`, `jejak_minat_investasi`
- Lain: `survei_undangan`, `spak_respons` (survei terpadu, migrasi survei belum diterapkan), `skm_respons`, `skm_response_rate`, `pengaduan`, `pengaduan_riwayat`, `standar_pelayanan`, `notifikasi`, `push_subscriptions`, `landing_content` (tidak dipakai lagi oleh homepage; hanya sumber salinan awal `homepage_blok`), `homepage_blok` (migrasi `202610280001`), `site_settings`, `konten_versi`, `audit_log`, `consent_log`, `error_log`, `anon_rate_limit`
- View: `v_antrian_loket`, `v_layar_antrian`, `v_rekap_pelayanan_{oss,perizinan}`, `v_umkm_public`, `v_umkm_match`
- RPC/fungsi kunci: `terbit_tiket`/`terbit_nomor_antrean`/`generate_nomor_tiket` (nomor antrean atomik), `panggil_tiket`, `finalize_pelayanan`, `catat_absensi`/`catat_pulang`, `check_anon_rate`, `match_faq`/`match_faq_teks`/`match_dokumen` (RAG), `submit_skm_response`/`hitung_ikm`, `buat_pengaduan`/`lacak_pengaduan`, `rollup_rekap_harian`, `validate_layar_token`, `set_user_role_claim` (Auth Hook), `get_my_role`/`is_ptsp_staff` (helper RLS), `queue_notifikasi`/`claim_notifikasi`.
- Job `pg_cron`: `notif_h0_pagi`, `notif_h1_sore`, `notif_eskalasi` + job otomatis lain (alpa otomatis, no-show reservasi, akhir hari, prune, anonimisasi). `vercel.json` kosong — penjadwalan ada di DB.
- Daftar tepat bisa berubah: cek `grep -l <nama> supabase/migrations/*.sql` atau `scripts/introspect-schema.mjs` sebelum mengandalkan daftar ini.

## Catatan refaktor 2026-11-13

Perbedaan yang sudah diperiksa di kode (branch `refaktor/g0-g1-arsitektur-ui`):
- "Pola umum" di atas sudah tidak berlaku untuk halaman yang dipecah (pola `_logika/` + `_hook/` + `_bagian/`): `admin/antrian/page.tsx` 194 baris, `chat/page.tsx` 22, `admin/chat/page.tsx` 138, `admin/chat/faq/page.tsx` 151, `me/reservasi/page.tsx` 80. Token global kini di `src/styles/token.css`, bukan `globals.css`. Komponen bersama ada di `src/components/ui/` (lihat `src/components/ui/README.md`).
- `DaftarPercakapan` = `src/app/chat/DaftarPercakapan.tsx`; test `chat.rls.test.tsx` dan `consent.ownership.test.ts` ada di `src/app/chat/`. `ChatSelesaiDialog` = ekspor di `src/components/admin/ChatAksiDialog.tsx`.
- `lib/hooks/useRealtimeRefetch.ts` kini berlangganan lewat pusat `src/lib/realtime/pusat.ts`.
- `src/app/api/skm/submit` sudah tidak ada.
- Halaman yang tidak ada di daftar di atas: publik `/saran`; pengunjung `/me/usaha`, `/me/usaha/[id]`, `/me/umkm`; admin `buku-tamu`, `dashboard`, `fo/*` (`daftar`, `kotak-masuk`, `penanganan`, `registrasi`), `layanan`, `performa`, `pesan-perilaku`, `profil`, `rekap-fo`, `riwayat`, `saran`, `topik` (sebagian disebut di catatan fase).
- Folder API yang tidak ada di daftar di atas: `api/{absensi,auth,me,saran,storage,survei}` dan `api/admin/{buku-tamu,revalidasi,riwayat,settings,survei,umkm-laporan,umkm-pengawasan,umkm-tugas}`.
- Folder `lib/` yang tidak ada di daftar `src/lib/` di atas: `akun/`, `data/`, `fo/`, `foto/`, `homepage/`, `layar/`, `pendataan-khusus/`, `pengaduan/`, `realtime/`, `settings/`, `storage/`, `survei/`, `umkm/`, `umkm-katalog/`.
- Komponen yang tidak ada di daftar di atas: folder `components/{ui,chat,fo,homepage,survei,umkm,umkm-form,umkm-katalog,umkm-pemilik,umkm-perusahaan}`, `ErrorRetry`, `ChunkErrorRecovery`, dan `layout/{AppBar,IsiHalaman,KartuIdentitas,PerintahCepat,SesiStafGuard,WidgetSidebar}`.
- Status migrasi pada daftar tabel: `202611100001`-`0003` (UMKM) DITERAPKAN 2026-11-10 dan survei `202611020001` pasti sudah ada di produksi (lihat [pesan-perilaku.md](pesan-perilaku.md)); status lain: `docs/MIGRATIONS.md`.
