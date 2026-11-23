// Daftar modal (<dialog> + showModal) yang sedang terbuka, untuk ToastProvider. Dialog modal membuat semua elemen di
// luar subtree-nya inert, jadi toast yang menjadi saudara dialog tidak bisa diklik dan klik tombol tutupnya jatuh ke
// latar. Tiap modal mendaftarkan satu elemen inang kosong di dalam dialognya; ToastProvider memindahkan wadah toast
// ke inang modal paling atas, sehingga toast tetap berada di dalam subtree dialog aktif (bisa diklik, dibaca pembaca
// layar, dan ikut jebakan Tab).
import { useSyncExternalStore } from 'react';

const tumpukan: HTMLElement[] = [];
const pendengar = new Set<() => void>();

function kabari() {
  pendengar.forEach((fn) => fn());
}

/** Daftarkan inang toast milik modal yang baru terbuka. Mengembalikan fungsi pelepas (panggil saat modal ditutup). */
export function daftarkanInangToast(el: HTMLElement): () => void {
  tumpukan.push(el);
  kabari();
  return () => {
    const i = tumpukan.lastIndexOf(el);
    if (i >= 0) tumpukan.splice(i, 1);
    kabari();
  };
}

function langgan(fn: () => void) {
  pendengar.add(fn);
  return () => {
    pendengar.delete(fn);
  };
}

const ambil = () => tumpukan[tumpukan.length - 1] ?? null;
const ambilServer = () => null;

/** Inang modal teratas yang terbuka, atau null bila tidak ada modal. */
export function useInangToast(): HTMLElement | null {
  return useSyncExternalStore(langgan, ambil, ambilServer);
}
