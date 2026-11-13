// Live chat pengunjung (Server Component ber-cache; rencana refaktor 2026-11-11 tugas 6.5). Layanan chat dan FAQ aktif
// dimuat di server lewat pemuat publik (klien anon tanpa cookie, unstable_cache 60 detik) dan dioper sebagai data biasa ke
// pulau klien (ChatKlien.tsx), sehingga muat awal tidak membuat query FAQ/layanan dari browser. Halaman tidak membaca
// sesi/cookies/headers. Parameter ?layanan= dibaca di klien (window.location, bukan useSearchParams), jadi tanpa <Suspense>
// dan halaman tetap statis ber-ISR. Gagal memuat di server = null: klien memuat sendiri, dengan Coba lagi seperti sebelumnya.
import { muatFaqPublik, muatLayananPublik } from '@/lib/data/publik-server';
import ChatKlien from './ChatKlien';
import { layananChatDariEtalase } from './_logika/dataAwal';

// Harus literal (dibaca statis oleh Next); sama dengan REVALIDASI_DETIK di lib/data/publik-server.ts.
export const revalidate = 60;

export default async function PublicChatPage() {
  const [layanan, faq] = await Promise.all([muatLayananPublik(), muatFaqPublik()]);
  return (
    <ChatKlien
      layananAwal={layanan.galat ? null : layananChatDariEtalase(layanan.layanan)}
      // Terpotong (> batas FAQ global) = parsial: null agar klien memuat FAQ per Layanan sendiri.
      faqAwal={faq.galat || faq.terpotong ? null : faq.faq}
    />
  );
}
