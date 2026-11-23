// Helper interaksi papan ketik dan gulir yang dipakai bersama banyak komponen.

interface KejadianKunci {
  key: string;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}

/**
 * true bila papan ketik sedang menyusun teks lewat IME (mis. aksara CJK). Enter pada saat itu hanya memilih
 * kandidat, jadi tidak boleh dianggap perintah kirim. `keyCode === 229` = cadangan untuk Safari, yang mengirim
 * keydown Enter sesudah compositionend dengan isComposing false.
 */
export function sedangMenyusun(e: KejadianKunci): boolean {
  return e.nativeEvent?.isComposing === true || e.keyCode === 229 || e.nativeEvent?.keyCode === 229;
}

/** true hanya untuk Enter yang disengaja (bukan Enter pemilih kandidat IME). */
export function enterTanpaKomposisi(e: KejadianKunci): boolean {
  return e.key === 'Enter' && !sedangMenyusun(e);
}

/** Perilaku gulir terprogram yang menghormati preferensi gerak: opsi JS `smooth` mengalahkan CSS `scroll-behavior`. */
export function perilakuGulir(): ScrollBehavior {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'auto';
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
