'use client';

// Perilaku fokus dialog modal yang aksesibel (WCAG 2.4.3 / 2.1.2, pola dialog ARIA):
//  - saat dibuka, fokus pindah ke dalam dialog (elemen `data-autofocus`, selain itu isian formulir pertama, selain itu
//    elemen fokus pertama, selain itu wadah);
//  - Tab / Shift+Tab berputar di dalam dialog (focus trap);
//  - Escape memanggil `onEscape` (pemanggil memutuskan menutup / meminta konfirmasi);
//  - saat ditutup, fokus dikembalikan ke elemen pemicu yang aktif sebelum dialog dibuka.
// Bila `wadah` adalah elemen <dialog> yang belum terbuka, hook membukanya dengan showModal() SESUDAH mencatat pemicu
// (showModal memindahkan fokus sendiri, jadi urutannya penting) dan sebelum memilih fokus awal.
// Dipakai dialog antrean (alihkan / kembalikan / selesai eskalasi) dan wizard pendataan.
import { useEffect, useRef, type RefObject } from 'react';

const SELEKTOR_FOKUS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Pemicu terakhir yang diklik. Safari/Firefox macOS tidak memberi fokus pada tombol saat diklik (activeElement = body),
// jadi klik dilacak sendiri agar fokus tetap bisa dikembalikan ke tombol pemicu saat dialog ditutup.
let terakhirDiklik: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target;
      const tombol = t instanceof Element ? t.closest('button, a[href], [role="button"]') : null;
      terakhirDiklik = tombol instanceof HTMLElement ? tombol : null;
    },
    true,
  );
}

// Tumpukan dialog aktif (yang terbuka paling akhir ada di ujung). Hanya dialog teratas yang menanggapi Escape dan Tab;
// tanpa ini satu Esc menutup semua dialog bertumpuk (mis. formulir minat di atas penampil dokumen).
const tumpukan: Array<RefObject<HTMLElement | null>> = [];

function elemenFokus(wadah: HTMLElement): HTMLElement[] {
  return Array.from(wadah.querySelectorAll<HTMLElement>(SELEKTOR_FOKUS)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  );
}

export function useDialogFokus(
  aktif: boolean,
  wadah: RefObject<HTMLElement | null>,
  onEscape: () => void,
): void {
  // Selalu memakai handler terbaru tanpa memasang ulang listener (hindari kehilangan fokus tiap render).
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  });

  // Pemicu dicatat sekali per pembukaan. Efek yang dijalankan ulang (StrictMode dev) tidak boleh menggantinya dengan
  // elemen di dalam dialog sendiri, yang hilang saat dialog ditutup.
  const pemicuRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aktif) {
      pemicuRef.current = null;
      return;
    }
    const el = wadah.current;
    if (!pemicuRef.current) {
      const sedangFokus = document.activeElement;
      const calon =
        sedangFokus instanceof HTMLElement && sedangFokus !== document.body ? sedangFokus : terakhirDiklik;
      if (calon && !(el && el.contains(calon))) pemicuRef.current = calon;
    }
    tumpukan.push(wadah);
    let dibukaNative = false;
    if (el instanceof HTMLDialogElement && !el.open && typeof el.showModal === 'function') {
      el.showModal();
      dibukaNative = true;
    }
    if (el && (dibukaNative || !el.contains(document.activeElement))) {
      // Prioritas: penanda eksplisit, lalu isian formulir pertama (bukan tombol Tutup di header), lalu elemen fokus pertama.
      const awal =
        el.querySelector<HTMLElement>('[data-autofocus]') ??
        el.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])') ??
        elemenFokus(el)[0] ??
        el;
      awal.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (tumpukan[tumpukan.length - 1] !== wadah) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        escapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const dlg = wadah.current;
      if (!dlg) return;
      const daftar = elemenFokus(dlg);
      if (daftar.length === 0) {
        e.preventDefault();
        dlg.focus();
        return;
      }
      const pertama = daftar[0];
      const terakhir = daftar[daftar.length - 1];
      const aktifEl = document.activeElement;
      if (!dlg.contains(aktifEl)) {
        e.preventDefault();
        pertama.focus();
      } else if (e.shiftKey && (aktifEl === pertama || aktifEl === dlg)) {
        e.preventDefault();
        terakhir.focus();
      } else if (!e.shiftKey && aktifEl === terakhir) {
        e.preventDefault();
        pertama.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = tumpukan.lastIndexOf(wadah);
      if (i >= 0) tumpukan.splice(i, 1);
      const pemicu = pemicuRef.current;
      if (pemicu && pemicu.isConnected) pemicu.focus();
    };
  }, [aktif, wadah]);
}
