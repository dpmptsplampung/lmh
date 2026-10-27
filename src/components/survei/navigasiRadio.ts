// Pembantu bersama SkalaSpak dan SegmenSkm (kelompok radio ala ARIA): arti `event.detail` pada klik dan navigasi panah.
import type { KeyboardEvent } from 'react';

/**
 * `event.detail` pada klik: 0 = keyboard atau pembaca layar (pilih saja, lanjut lewat tombol Lanjut),
 * 1 = ketukan/klik pointer (boleh auto-lanjut), >= 2 = ketukan kedua beruntun pada titik yang sama.
 * Ketukan kedua biasanya jatuh pada soal langkah BERIKUTNYA (halaman sudah pindah) dan salah menjawabnya, jadi diabaikan
 * (`null`). Pemilih yang sengaja mengganti jawaban mengetuk kotak lain, sehingga hitungan klik kembali ke 1.
 */
export function otomatisDariKlik(detail: number): boolean | null {
  if (detail >= 2) return null;
  return detail > 0;
}

/**
 * Pola radiogroup ARIA: panah/Home/End memindahkan fokus sekaligus memilih (tanpa auto-lanjut).
 * `urutan` = nilai opsi sesuai urutan tampil; `posisi` = indeks opsi yang sedang fokus.
 */
export function tanganiPanahRadio(
  e: KeyboardEvent<HTMLElement>,
  urutan: readonly number[],
  posisi: number,
  pilih: (nilai: number, otomatis: boolean) => void,
): void {
  let tujuan: number;
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      tujuan = (posisi + 1) % urutan.length;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      tujuan = (posisi - 1 + urutan.length) % urutan.length;
      break;
    case 'Home':
      tujuan = 0;
      break;
    case 'End':
      tujuan = urutan.length - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  pilih(urutan[tujuan], false);
  e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[tujuan]?.focus();
}
