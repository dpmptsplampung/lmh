'use client';

// Modal halaman antrean (rencana refaktor 2026-11-11 tugas 5.3, SPEC bagian 7): satu state union menggantikan tujuh
// state modal terpisah (ambil alih + mode, alihkan, kembalikan ke FO, selesai eskalasi, koreksi, wizard, QR survei).
//
// Dua lapis dalam SATU state:
// - `utama`: dialog tiket (enam jenis selain surveiQr), saling meniadakan.
// - `qr`: dialog QR Pesan Perilaku, yang dibuka DI ATAS dialog sumber oleh onSuccess-nya. Lapis terpisah karena
//   (a) dialog tiket memanggil `await onSuccess(); onClose()`: onSuccess membuka QR, onClose menutup sumber, dan QR harus
//   tetap terbuka; (b) jalur "tampilan basi" SelesaiEskalasiModal memanggil onSuccess TANPA onClose: dialog sumber tetap
//   terbuka dan QR (spekulatif, menutup sendiri bila tanpa token) tampil di atasnya, sama seperti sebelum refaktor.
// Semua penulisan memakai updater fungsional: penutup yang merupakan closure render lama tetap benar.
import { useCallback, useState } from 'react';
import type { TiketBaris } from '@/lib/data/antrean';

export type JenisModalAntrian =
  | 'ambilAlih' | 'alihkan' | 'kembalikanKeFo' | 'selesaiEskalasi' | 'koreksi' | 'wizard' | 'surveiQr';

export type ModalAntrian = null | { jenis: JenisModalAntrian; tiket: TiketBaris };

interface KeadaanModal {
  utama: ModalAntrian;
  qr: ModalAntrian;
}

const AWAL: KeadaanModal = { utama: null, qr: null };

/**
 * @param sumberQr daftar tiket yang sedang dimuat (tabel lalu panel), dicari berurutan oleh `bukaQrTiket`.
 */
export function useModalAntrian(sumberQr: ReadonlyArray<readonly TiketBaris[]>) {
  const [keadaan, setKeadaan] = useState<KeadaanModal>(AWAL);

  const buka = useCallback((jenis: JenisModalAntrian, tiket: TiketBaris) => {
    setKeadaan((k) => {
      if (jenis !== 'surveiQr') return { ...k, utama: { jenis, tiket } };
      // QR kunjungan yang sama sudah tampil: state tetap (dialog tidak dipasang/dimuat ulang).
      if (k.qr && k.qr.tiket.kunjungan_id === tiket.kunjungan_id) return k;
      return { ...k, qr: { jenis, tiket } };
    });
  }, []);

  /** Menutup modal berjenis `jenis` HANYA bila yang terbuka masih berjenis itu. */
  const tutup = useCallback((jenis: JenisModalAntrian) => {
    setKeadaan((k) => {
      if (jenis === 'surveiQr') return k.qr ? { ...k, qr: null } : k;
      return k.utama?.jenis === jenis ? { ...k, utama: null } : k;
    });
  }, []);

  /**
   * Setelah tiket diselesaikan: buka QR secara spekulatif untuk kunjungan tiket itu (dicari di daftar yang dimuat);
   * dialog QR menutup sendiri bila kunjungan belum selesai sehingga tidak ada QR yang salah tampil.
   */
  const bukaQrTiket = (tiketId: string | null) => {
    let baris: TiketBaris | undefined;
    for (const daftar of sumberQr) {
      baris = daftar.find((a) => a.id === tiketId);
      if (baris) break;
    }
    if (baris?.kunjungan_id) buka('surveiQr', baris);
  };

  return { utama: keadaan.utama, qr: keadaan.qr, buka, tutup, bukaQrTiket };
}
