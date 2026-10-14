'use client';

// Memutar ulang antrean offline Front Office (audit T3a): saat halaman admin dibuka, saat koneksi kembali
// ('online'), dan saat service worker meminta lewat Background Sync (pesan REPLAY_QUEUE; SW MENUNGGU balasan
// ok lewat MessageChannel, tanpa balasan sync dianggap gagal dan dijadwalkan ulang oleh browser).
// Hanya item milik akun yang sedang masuk yang diputar (replay.ts). Tidak menampilkan apa pun selain toast.
import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { replayQueue } from '@/lib/offline/replay';
import { pesanHasilReplay } from '@/lib/offline/tutup';
import { useToast } from '@/components/Toast';

export default function OfflineReplayer() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    let aktif = true;

    // Mengembalikan true bila tidak ada yang tersisa untuk diulang (sukses penuh atau antrean kosong).
    async function putar(): Promise<boolean> {
      try {
        // getSession (lokal, tanpa jaringan): id pemilik hanya dipakai menyaring item; server tetap memverifikasi.
        const { data } = await createClient().auth.getSession();
        const uid = data.session?.user.id;
        if (!uid) return false;
        const r = await replayQueue(uid);
        if (!aktif) return r.failed === 0;
        const pesan = pesanHasilReplay(r);
        if (pesan) toastRef.current(pesan, 'error');
        else if (r.synced > 0) toastRef.current(`${r.synced} pendaftaran walk-in offline berhasil dikirim.`, 'success');
        return r.failed === 0;
      } catch {
        return false; // jaringan/IndexedDB bermasalah: percobaan berikutnya (online / sync / buka halaman)
      }
    }

    void putar();

    const saatOnline = () => void putar();
    window.addEventListener('online', saatOnline);

    const saatPesan = (e: MessageEvent) => {
      if (!e.data || e.data.type !== 'REPLAY_QUEUE') return;
      const port = e.ports?.[0];
      void putar().then((ok) => port?.postMessage({ ok }));
    };
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    sw?.addEventListener('message', saatPesan);

    return () => {
      aktif = false;
      window.removeEventListener('online', saatOnline);
      sw?.removeEventListener('message', saatPesan);
    };
  }, []);

  return null;
}
