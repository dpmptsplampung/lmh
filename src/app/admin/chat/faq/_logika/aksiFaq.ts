// Fungsi murni untuk aksi halaman Kelola FAQ (tanpa I/O, tanpa React): pesan, susunan isian, ringkasan proses massal.
import type { FAQ, IsianFaq } from '@/components/admin/faq/types';

export const PESAN_PROSES_GAGAL = 'Bot belum bisa memproses FAQ ini. Coba lagi beberapa saat lagi.';
export const PESAN_PROSES_GAGAL_SESUDAH_SIMPAN = 'FAQ tersimpan, tetapi belum bisa diproses bot. Coba lagi dari daftar.';

export interface DasarFaq {
  pertanyaan: string;
  jawaban: string;
  dasarHukum: string | null;
  urutan: IsianFaq['urutan'];
}

/** Isian dialog -> nilai yang disimpan (teks dipangkas, dasar hukum kosong menjadi null). */
export function dasarDariIsian(isian: IsianFaq): DasarFaq {
  return {
    pertanyaan: isian.pertanyaan.trim(),
    jawaban: isian.jawaban.trim(),
    dasarHukum: isian.dasarHukum.trim() || null,
    urutan: isian.urutan,
  };
}

/** True bila pertanyaan/jawaban berubah: embedding lama harus dihapus dan FAQ diproses ulang oleh bot. */
export function teksFaqBerubah(faq: Pick<FAQ, 'pertanyaan' | 'jawaban'>, dasar: Pick<DasarFaq, 'pertanyaan' | 'jawaban'>): boolean {
  return dasar.pertanyaan !== faq.pertanyaan || dasar.jawaban !== faq.jawaban;
}

/** Pesan toast hasil "Proses semua" (Admin). */
export function ringkasanProsesMassal({ diproses, gagal, sisa }: { diproses: number; gagal: number; sisa: number }): {
  pesan: string;
  jenis: 'success' | 'error';
} {
  return {
    pesan: `${diproses} FAQ diproses.` + (gagal ? ` ${gagal} belum berhasil, coba lagi.` : '') + (sisa ? ` ${sisa} masih menunggu.` : ''),
    jenis: gagal ? 'error' : 'success',
  };
}

/** Salinan himpunan dengan `id` ditambahkan (state React tidak boleh dimutasi). */
export const himpunanDengan = (asal: ReadonlySet<string>, id: string): Set<string> => new Set(asal).add(id);

/** Salinan himpunan tanpa `id`. */
export function himpunanTanpa(asal: ReadonlySet<string>, id: string): Set<string> {
  const baru = new Set(asal);
  baru.delete(id);
  return baru;
}
