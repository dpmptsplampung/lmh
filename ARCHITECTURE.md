# Architecture: Lampung Maju Hub

> Dokumen teknis pendamping `PRD.md`. Untuk dibaca coding agent sebelum eksekusi.

---

## 1. Tech Stack
- **Backend/DB:** Supabase (Postgres, Auth, Storage, Edge Functions)
- **Hosting/Frontend:** Vercel (Next.js)

## 2. Prinsip Desain

1. **RLS-first** untuk data yang punya role jelas (petugas/admin) — pola existing `get_my_role()` / `get_my_layanan_id()` (`security definer`, hindari infinite recursion) tetap dipakai.
2. **Edge Function** untuk kasus yang *tidak fit* pola RLS standar — khususnya edit-token UMKM (dijelaskan di §5). RLS Supabase dirancang memvalidasi role dari JWT pengguna yang login; token arbitrer di URL tidak bisa divalidasi aman lewat RLS policy biasa.
3. **Public read tanpa auth** untuk konten yang memang publik (listing UMKM `published`, dokumen Investment Gallery `aktif`).
4. Dua kelompok data (§2.1 & §2.2 PRD) **tidak saling terhubung** — tidak ada foreign key antara `kunjungan` dan `listing_umkm`/`investment_documents`.

---

## 3. Model Data

### 3.1 Kelompok Layanan Konsultatif

| Tabel | Kolom kunci | Catatan |
|---|---|---|
| `layanan` | `id`, `nama`, `chatbot_aktif` (bool) | Hanya 3 baris: Helpdesk OSS, Sertifikasi Halal, CS BPJS |
| `petugas` | `id`, `layanan_id`, akun individual | RLS: dibatasi ke `layanan_id` sendiri |
| `kunjungan` | `id`, `nama`, `keperluan`, `layanan_id`, `status` (`menunggu`/`selesai`), timestamp masuk/selesai | Dropdown `layanan_id` hanya 3 layanan konsultatif |
| `kehadiran_layanan` | akun shared per instansi mitra, nama piket (teks bebas), jam hadir/pulang | Buku P4 digital |
| `chat_sesi` | `layanan_id` (selector), `kontak_pengunjung` (opsional) | |
| `chat_pesan` | isi pesan, sesi terkait | |
| `faq_knowledge_base` | `layanan_id`, konten FAQ | Per-layanan, bukan field `kategori` bebas teks |

### 3.2 Kelompok Modul Publik Independen

**`listing_umkm`**
| Kolom | Catatan |
|---|---|
| `nama_umkm`, `kategori_kebutuhan` (enum terstruktur, bukan teks bebas), `deskripsi`, `foto_produk` | Konten utama |
| `kontak_nama`, `kontak_hp`, `kontak_email` | Dipakai juga untuk verifikasi saat UMKM edit |
| `edit_token` | Unik per listing, dibuat otomatis saat staff submit pertama kali |
| `status` | `draft` / `pending_review` / `published` / `nonaktif` / `expired` |
| `dibuat_oleh` | id staff |
| Snapshot versi disetujui | Simpan versi terakhir yang disetujui, tetap tayang selama edit UMKM masih `pending_review` |

**`investment_documents`**
| Kolom | Catatan |
|---|---|
| `judul`, `kategori`, `urutan_tampil` | Metadata |
| `file_path` | Private bucket, bukan public URL |
| `status` | `aktif` / `nonaktif` |

---

## 4. RLS & Role Strategy

- Existing pattern (`get_my_role()`, `get_my_layanan_id()`) dipertahankan untuk petugas/admin.
- **Anon role:**
  - `SELECT` diizinkan pada `listing_umkm` (hanya `status = 'published'`) dan `investment_documents` (hanya `status = 'aktif'`)
  - `INSERT`-only (tanpa `SELECT`) pada `kunjungan` dan `chat_sesi`, direkomendasikan lewat Supabase Anonymous Sign-In — **belum diimplementasikan, perlu dibangun di Fase 1**
- **UMKM edit-token TIDAK divalidasi lewat RLS row policy langsung** — lihat §5.

---

## 5. Alur Edit-Token UMKM (Wajib Edge Function)

RLS policy tidak bisa dengan aman mencocokkan "token di URL == kolom `edit_token` di baris ini" karena request datang dari klien anonim tanpa JWT yang membawa klaim token tersebut. Alur yang benar:

1. Klien memanggil **Edge Function** dengan `edit_token` + field yang diubah.
2. Edge Function memvalidasi token secara server-side (pakai **service role key**, bypass RLS), cek token cocok dengan baris & status listing masih boleh diedit.
3. Jika valid: tulis update, paksa `status = 'pending_review'`, simpan versi lama sebagai snapshot yang tetap tayang.
4. Staff review & approve lewat dashboard admin (RLS role admin normal).

> Ini bukan detail kecil — karena Matchmaking UMKM publik ke seluruh internet, token yang tertebak/bocor bisa dieksploitasi siapa saja. **Wajib ada sebelum fitur ini live**, bukan ditambahkan belakangan.

---

## 6. Investment Gallery — Mekanisme Kunci

- PDF disimpan di **private storage bucket** (bukan public URL).
- Saat dibuka: server menerbitkan **signed URL berumur pendek** ke halaman yang sudah **di-render sebagai gambar** (bukan file PDF asli yang di-embed) — mencegah devtools browser menemukan link ke file PDF utuh.
- **Keputusan implementasi yang perlu diambil:** konversi PDF → gambar per halaman dilakukan **sekali saat upload** (direkomendasikan — lebih murah) atau on-the-fly setiap dibuka? Perlu diputuskan sebelum coding Fase 4.
- Klik kanan & shortcut print/save di-disable di level UI.
- **Batasan yang diterima secara sadar:** screenshot/screen recording tidak bisa dicegah oleh mekanisme apa pun di web. Karena diputuskan tanpa watermark/identitas pengunjung, kebocoran (bila terjadi) tidak bisa dilacak sumbernya. Ini bukan bug untuk "diperbaiki" nanti.

---

## 7. Live Chat Architecture

- `chat_sesi.layanan_id` = selector layanan tujuan.
- Bot hanya aktif untuk layanan dengan `chatbot_aktif = true`, mengambil dari `faq_knowledge_base` yang difilter `layanan_id`.
- Logika fallback:
  - Layanan belum punya KB aktif → langsung eskalasi ke live chat manusia
  - Layanan punya KB aktif tapi bot tidak yakin/tidak ketemu jawaban → eskalasi ke live chat manusia
- Live chat semi-real-time: chat tanpa petugas online tetap masuk antrian tanpa batas waktu, tidak ada SLA.
- `kontak_pengunjung` opsional dikumpulkan di awal sesi untuk follow up manual bila jawaban telat.

---

## 8. Actor & Permission Matrix (ringkas teknis)

| Role | `kunjungan` | `chat_sesi`/`chat_pesan` | `listing_umkm` | `investment_documents` |
|---|---|---|---|---|
| Anon (publik) | Insert-only | Insert-only | Select (published saja) | Select (aktif saja) |
| Petugas | Select/Update (layanan sendiri) | Select/Update (layanan sendiri) | — | — |
| UMKM (edit-token) | — | — | Update via Edge Function saja (bukan RLS langsung) | — |
| Admin | Full akses | Full akses | Full akses + approve `pending_review` | Full akses (upload/nonaktifkan) |

---

## 9. Non-Goals Eksplisit (Level Arsitektur)

- ❌ Integrasi WhatsApp Business API
- ❌ Sistem tiket nomor cetak / layar TV panggilan nomor
- ❌ DRM penuh untuk PDF Investment Gallery (tidak mungkin dicapai di web; hanya deterrence)
- ❌ Sistem login/akun formal untuk UMKM (edit-token dipakai sebagai gantinya)
- ❌ Integrasi nyata ke sistem OSS nasional/BPJS/Kemenag

---

## 10. Keputusan Teknis yang Masih Terbuka

- Timing implementasi Supabase Anonymous Sign-In (disarankan di Fase 1, karena dibutuhkan untuk insert publik)
- Pipeline konversi PDF→gambar: at-upload vs on-the-fly (§6)
- Jumlah & provisioning akun admin
- Durasi retensi data personal (menunggu koordinasi bagian arsip/hukum — lihat PRD §7)
