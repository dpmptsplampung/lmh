// Data awal /chat dari server (rencana refaktor 2026-11-11 tugas 6.5). Server (page.tsx) memuat Layanan dan FAQ publik
// (ber-cache, klien anon) lalu mengoperkannya sebagai props biasa; fungsi murni di sini memetakan bentuk etalase/FAQ publik
// ke bentuk yang dipakai hook chat. Tanpa I/O dan tanpa impor server-only, jadi aman dipakai dari server maupun klien.
import type { FaqChat, LayananChat } from '@/lib/data/chat-pengunjung';
import type { LayananEtalase } from '@/lib/homepage/data';

/**
 * Data awal dari server. `null` = tidak lengkap / gagal dimuat di server: klien memuatnya sendiri (perilaku lama).
 * Daftar kosong yang sah (`[]`) tetap dipakai apa adanya.
 */
export interface DataAwalChat {
  layanan: LayananChat[] | null;
  faq: FaqChat[] | null;
}

/**
 * Layanan yang melayani chat, urut nama: sama dengan kueri klien lama (`v_layanan_publik`, bukan `tipe = modul_publik`,
 * `punya_chat` false dibuang). Kolom `urutan` etalase sengaja tidak dipakai: pilihan chat urut nama.
 */
export function layananChatDariEtalase(daftar: readonly LayananEtalase[]): LayananChat[] {
  return daftar
    .filter((l) => l.tipe !== 'modul_publik' && l.punyaChat)
    .map((l) => ({
      id: l.id,
      nama: l.nama,
      chatbot_aktif: l.chatbotAktif,
      status_tampilan: l.statusTampilan,
      punya_chat: l.punyaChat,
    }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}

/** FAQ Layanan ini + FAQ umum dari daftar FAQ aktif seluruh layanan (urutan server dipertahankan). */
export function faqUntukLayanan(semua: readonly FaqChat[], layananId: string): FaqChat[] {
  return semua.filter((f) => f.layanan_id === layananId || f.layanan_id === null);
}
