# Kontrak Konsol Pengaturan (LLM/gateway + bot) — untuk frontend

Migrasi `202610090003_konsol_pengaturan.sql` (belum diterapkan ke produksi). Semua route `/api/admin/settings/**` = **Admin aktif saja** (401 belum login/nonaktif, 403 bukan Admin), `Cache-Control: no-store`. Kecuali disebut, galat berbentuk `{ error, kode? }`.

## Model
Rantai LLM = daftar entri berurutan (urutan = prioritas) disimpan sebagai **versi** (`draf` -> `aktif` -> `arsip`). Alur layar: sunting **draf** -> **Uji** tiap entri aktif -> **Aktifkan** -> (bila perlu) **Rollback**. Bila belum ada versi aktif, sistem memakai env lama (`sumber_aktif: "env"`). Perubahan berlaku paling lambat ±1 menit (cache 60 dtk).

Entri: `{ id(uuid, dibuat klien), label(unik), tipe: "gemini"|"openai_compat", base_url (wajib utk openai_compat; https, port 443, domain publik), model, rahasia_id|null, aktif, kuota_harian|null, suhu?(0-2), batas_waktu_ms?(1000-60000) }`. `tipe: "gemini"` selalu memakai endpoint resmi (base_url diabaikan).

## Route
| Method + path | Body | Respons |
|---|---|---|
| `GET /api/admin/settings/llm` | — | `{ enkripsi_siap, sumber_aktif:"db"\|"env", aktif, draf, riwayat[], preset[], env_cadangan }`. `aktif`/`draf` = `{ versi, alasan, hasil_uji:{[entry_id]:{ok,http_status,latensi_ms,at}}, diuji_at, dibuat_at, diaktifkan_at, entries[] }`; tiap entry ditambah `punya_kunci:boolean`, `kunci_tersamar:"••••abcd"\|null`. **Kunci tidak pernah dikirim.** |
| `PUT /api/admin/settings/llm` | `{ entries: Entry[], alasan? }` | `{ ok, versi }` — simpan **draf** (menimpa draf yang ada). 400 `details` bila skema salah / base_url ditolak (`details:[{id,error}]`) / `rahasia_id` tak dikenal. Hasil uji dipertahankan hanya untuk entri yang tidak berubah. |
| `POST /api/admin/settings/llm/rahasia` | `{ nama, kunci }` | `{ ok, rahasia_id, kunci_tersamar }`. Write-only; **selalu membuat rahasia baru** -> taruh `rahasia_id` itu di entri lalu `PUT` draf. 503 `kode:"ENKRIPSI_BELUM_DIATUR"` bila env `SETTINGS_ENCRYPTION_KEY` belum diset (tampilkan pesannya). 429 bila >30/jam. |
| `POST /api/admin/settings/llm/test` | `{ entry_id, sumber?: "draf"(default)\|"aktif" }` | `{ ok, http_status\|null, latensi_ms, cuplikan\|null, error\|null, tokens:{masuk,keluar}\|null, curl }`. `curl` memakai `Bearer ••••abcd` (tersamar, salin-tempel). Hasil `draf` disimpan ke draf (syarat aktivasi). 404 entri/draf tak ada; 409 `KUNCI_TAK_TERBACA`; 429 bila >20/jam. |
| `POST /api/admin/settings/llm/versi` | `{ aksi:"aktifkan"\|"rollback", versi, alasan?, tanpa_uji? }` | `{ ok, versi_aktif, berlaku }`. `aktifkan`: draf `versi` jadi aktif; **semua entri aktif harus lulus uji** (409 `BELUM_DIUJI`) kecuali `tanpa_uji:true` + `alasan` >=5 karakter (400 `ALASAN_WAJIB`). `rollback`: `versi` = versi **arsip**; disalin menjadi versi BARU yang aktif, `alasan` wajib. Kode lain: `BUKAN_DRAF`/`BUKAN_ARSIP` 409, `TIDAK_ADA` 404, `TIDAK_ADA_PENYEDIA_AKTIF` 409. |
| `POST /api/admin/settings/bot/coba` | `{ pertanyaan(3-2000), layanan_id }` | Untuk staf aktif mana pun (petugas hanya layanan sendiri, 403). Jalur bot yang sama, **tanpa menyimpan** pesan/sesi/log, tanpa eskalasi. `{ ok, jawaban, sumber[], sumber_dokumen[], eskalasi, reason, penyedia, skor_faq, mode:{tutup,alasan,kerja_berikutnya}, latensi_ms, chatbot_aktif }`; bila bot gagal `{ ok:false, jawaban, reason, operasi }`. Tetap jalan walau `chatbot_aktif=false` (untuk uji sebelum dinyalakan). 30/jam/staf. |

`preset[]` untuk dropdown: Gemini, Groq, OpenRouter, Mistral, "Gateway kustom (kompatibel OpenAI)" (`{id,label,tipe,base_url,model_contoh}`).

## Perubahan perilaku `POST /api/chat/ai` (layar chat pengunjung)
- `layanan.chatbot_aktif=false` ditegakkan server: `200 { ignored:true, reason:"bot_nonaktif", jawaban:null, ... }` (tanpa AI, tanpa pesan bot). Klien cukup menampilkan jalur petugas.
- Respons sukses menambah `sumber_dokumen: [{id,dokumen_id,judul,nomor_pasal,sumber_url}]` (Dokumen Peraturan dari `match_dokumen_layanan`; kosong bila indeks tak ada).
- Nilai `reason` baru: `di_luar_lingkup` (ditolak ramah, `eskalasi:false`), `libur_nasional`, `setelah_jam_tutup` (bot tetap menjawab, `eskalasi:false`). Lama tetap: `weekend_mode`, `greeting`, `no_match`, `embedding_fallback`, `fts_exact`, `ai_error`, `prompt_injection`, `null`.

## Env baru
`SETTINGS_ENCRYPTION_KEY` (32 byte base64, opsional; hanya untuk menyimpan kunci dari layar). `GEMINI_API_KEY` tetap dibutuhkan untuk embedding FAQ/Dokumen walau model chat diganti.
