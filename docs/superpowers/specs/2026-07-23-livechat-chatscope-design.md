# Chatscope UI & Supabase Broadcast Realtime Integration Design

## 1. Tujuan
Meningkatkan stabilitas dan keandalan sistem Live Chat dengan memigrasikan:
1. **Antarmuka (UI)**: Menggunakan library standar industri `@chatscope/chat-ui-kit-react` agar lebih bersih, responsif, kaya fitur, dan konsisten (baik untuk pengunjung maupun petugas admin).
2. **Sinkronisasi Pesan (Transport)**: Menggantikan interval *polling API* berbasis REST yang rawan *delay/duplicate* dengan **Supabase Broadcast Channels (WebSockets)** untuk real-time instant sub-50ms (bebas dari pemblokiran RLS).

## 2. Persyaratan & Aturan (Constraints)
- **TIDAK mengubah skema database**. Seluruh riwayat obrolan tetap menggunakan tabel `chat_sesi` dan `chat_pesan` yang ada di Supabase PostgreSQL.
- **TIDAK mematikan integrasi Gemini RAG**. Agen AI harus tetap membalas otomatis (sesuai hukum & aturan SOP) selama petugas belum mengambil alih.
- **Hierarki Pengambilalihan Petugas (Takeover Hierarchy) TETAP utuh**:
  - Petugas Spesifik Layanan (P4): Hanya melihat dan bisa mengambil alih sesi untuk layanan mereka (berdasarkan `layanan_id`).
  - Petugas Super/Dinas (misal: Dea, Linda, dsb. dengan role `admin` atau `dinas`): Dapat melihat seluruh antrean sesi dan mengambil alih obrolan *apapun* secara lintas-layanan.

## 3. Arsitektur Solusi (Proposed Design)

### A. Real-Time Data Flow
1. **Saat Mengirim Pesan (POST)**:
   - Pengunjung atau Petugas menekan "Kirim".
   - Klien mengirim `POST /api/chat/messages` dengan `sesi_id`, `pengirim`, dan `isi`.
   - Di Backend (menggunakan *Service Role Key* agar lolos RLS), pesan di-*insert* ke tabel `chat_pesan`.
   - **[BARU]** Backend kemudian memanggil API Supabase: `supabase.channel('chat_room_XXX').send({ type: 'broadcast', event: 'new_message', payload: message_data })`.
2. **Saat Menerima Pesan**:
   - Komponen Frontend (`src/app/chat/page.tsx` & `src/app/admin/chat/page.tsx`) di-mount, mereka melakukan *initial fetch* via `GET /api/chat/messages` untuk me-load *history*.
   - Frontend **subscribe** ke channel `chat_room_XXX`.
   - Jika ada notifikasi `new_message` masuk melalui Broadcast, UI Chatscope langsung menambahkannya ke dalam state pesan yang ditampilkan, **0ms polling**.

### B. UI Chatscope Integration
1. **Pemasangan Library**: `npm install @chatscope/chat-ui-kit-react @chatscope/chat-ui-kit-styles`
2. **Pengunjung (Visitor Chat)**:
   - Seluruh komponen HTML manual `flex-col`, input bar digantikan dengan:
     `<MainContainer>`, `<ChatContainer>`, `<MessageList>`, `<Message>`, dan `<MessageInput>`.
3. **Petugas (Admin Chat)**:
   - Panel di sisi kiri yang menampilkan daftar sesi dipertahankan.
   - Sisi kanan (jendela obrolan) diganti menggunakan `<ChatContainer>` Chatscope.

### C. Mekanisme Hierarki Takeover
- Logika query `fetchSessions` di `admin/chat/page.tsx` saat ini sudah memeriksa `petugas.role`. Jika ia adalah `petugas` standar, query di-filter dengan `eq('layanan_id', petugas.layanan_id)`. Jika bukan, filter tidak dipakai. Logika ini akan **dibiarkan persis sebagaimana adanya** untuk memastikan Dea & Linda tetap bisa masuk ke seluruh ruangan obrolan.

## 4. Rencana Validasi
- **E2E Sync Test**: Menguji kirim pesan dari Visitor ke Admin dan pastikan muncul <1 detik tanpa perlu refresh/polling.
- **Takeover Auth Test**: Memastikan ketika admin mengambil alih, Gemini berhenti dan UI menunjukkan tanda "Status: Aktif".
- **Styling Test**: Memastikan tema Chatscope terintegrasi manis dengan tema sistem yang sudah ada (meng-override CSS variabel bila diperlukan).

---
*Silakan review dokumen desain ini. Jika sudah sesuai dengan visi sistem, kita akan langsung membuat Rencana Implementasi (Implementation Plan).*
