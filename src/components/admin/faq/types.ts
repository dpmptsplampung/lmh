// Bentuk data FAQ yang dipakai halaman Kelola FAQ dan dialog-dialognya.

export interface FAQ {
  id: string;
  layanan_id: string | null; // null = FAQ umum (semua layanan)
  pertanyaan: string;
  jawaban: string;
  dasar_hukum?: string | null;
  aktif: boolean;
  urutan: number;
  updated_at?: string | null;
}

/** Nilai <option>/radio untuk FAQ umum (layanan_id NULL); id layanan sungguhan adalah UUID sehingga tak bisa bentrok. */
export const UMUM_KEY = '__umum__';

export interface IsianFaq {
  /** UMUM_KEY atau id layanan. Diabaikan saat mengubah FAQ (cakupan tidak berubah). */
  kunci: string;
  pertanyaan: string;
  jawaban: string;
  dasarHukum: string;
  urutan: number;
  /** Petugas sudah mencentang pernyataan tanggung jawab. */
  pernyataan: boolean;
}
