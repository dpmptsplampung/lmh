'use client';

import { useEffect, useRef, type RefObject } from 'react';

// Perilaku dialog modal yang aksesibel (audit T8): fokus berpindah ke dalam dialog saat terbuka,
// Tab/Shift+Tab terkurung di dalamnya (focus trap), Escape menutup (kecuali `dikunci`, mis. saat request
// berjalan), dan fokus dikembalikan ke elemen pemicu saat dialog ditutup. Pola penutupan mengikuti
// AmbilAlihTiketModal dan laci Sidebar.

const SELEKTOR_FOKUS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function daftarFokus(wadah: HTMLElement): HTMLElement[] {
  return Array.from(wadah.querySelectorAll<HTMLElement>(SELEKTOR_FOKUS)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  );
}

interface Opsi {
  /** Dialog sedang terbuka (efek hanya aktif selama true). */
  aktif: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** true = Escape tidak menutup (request berjalan). */
  dikunci?: boolean;
}

export function useDialogA11y({ aktif, dialogRef, onClose, dikunci = false }: Opsi): void {
  // Nilai terbaru disimpan di ref (diperbarui lewat effect, aturan react-hooks/refs) agar efek utama
  // tidak dijalankan ulang (yang akan memindahkan fokus lagi) tiap render.
  const onCloseRef = useRef(onClose);
  const dikunciRef = useRef(dikunci);
  useEffect(() => {
    onCloseRef.current = onClose;
    dikunciRef.current = dikunci;
  });

  useEffect(() => {
    if (!aktif) return;
    const wadah = dialogRef.current;
    const pemicu = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowAwal = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Fokus awal: elemen bertanda data-autofocus, jika tidak ada yang pertama dapat difokus, jika tidak ada dialog itu sendiri.
    if (wadah) {
      const awal = wadah.querySelector<HTMLElement>('[data-autofocus]') ?? daftarFokus(wadah)[0] ?? wadah;
      awal.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!dikunciRef.current) {
          e.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (e.key !== 'Tab' || !wadah) return;
      const fokusable = daftarFokus(wadah);
      if (fokusable.length === 0) {
        e.preventDefault();
        wadah.focus();
        return;
      }
      const pertama = fokusable[0];
      const terakhir = fokusable[fokusable.length - 1];
      const aktifEl = document.activeElement;
      if (e.shiftKey && (aktifEl === pertama || !wadah.contains(aktifEl))) {
        e.preventDefault();
        terakhir.focus();
      } else if (!e.shiftKey && (aktifEl === terakhir || !wadah.contains(aktifEl))) {
        e.preventDefault();
        pertama.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflowAwal;
      // Kembalikan fokus ke pemicu bila masih ada di dokumen.
      if (pemicu && pemicu.isConnected) pemicu.focus();
    };
  }, [aktif, dialogRef]);
}
