// Fungsi murni Kotak Masuk Investasi: label, nada, saringan, dan pemetaan galat HTTP. Tanpa I/O dan tanpa React.
import type { NadaLencana } from '@/components/ui/Lencana';
import type { MinatRingkas } from '@/lib/data/investasi';
import { STATUS_MINAT } from '@/lib/investasi/konstanta';

export type StatusMinat = (typeof STATUS_MINAT)[number];
export type KanalMinat = MinatRingkas['kanal'];
export type SaringanJenis = 'semua' | KanalMinat;
export type SaringanStatus = 'semua' | StatusMinat;

export const UKURAN_HALAMAN_KOTAK_MASUK = 25;
export const OPSI_STATUS: readonly StatusMinat[] = STATUS_MINAT;

export const LABEL_STATUS: Record<StatusMinat, string> = {
  baru: 'Baru',
  dihubungi: 'Dihubungi',
  berlanjut: 'Berlanjut',
  ditolak: 'Ditolak',
  selesai: 'Selesai',
};

export const LABEL_JENIS: Record<KanalMinat, string> = { ipro: 'IPRO', dokumen: 'Dokumen' };

export function adalahStatusMinat(nilai: string): nilai is StatusMinat {
  return (STATUS_MINAT as readonly string[]).includes(nilai);
}

export function labelStatus(status: string): string {
  return adalahStatusMinat(status) ? LABEL_STATUS[status] : status;
}

export function nadaStatus(status: string): NadaLencana {
  if (status === 'baru') return 'info';
  if (status === 'ditolak') return 'bahaya';
  if (status === 'selesai') return 'sukses';
  return 'netral';
}

/** Judul konteks (proyek IPRO atau dokumen) yang ditanyakan pengirim; null bila konteks sudah dihapus. */
export function judulKonteks(baris: Pick<MinatRingkas, 'kanal' | 'ipro_proyek' | 'investment_documents'>): string | null {
  const judul = baris.kanal === 'ipro' ? baris.ipro_proyek?.judul : baris.investment_documents?.judul;
  return judul ?? null;
}

/** Satu alamat biasa; data lama yang tidak sah tetap hanya ditampilkan sebagai teks. */
export function tautanEmail(email: string): string | null {
  const pola = /^[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
  return email.length <= 254 && !/\s/.test(email) && pola.test(email) ? `mailto:${encodeURIComponent(email)}` : null;
}

/** Subjek dan tautan `mailto:` untuk tombol "Balas lewat email". */
export function tautanBalas(email: string, konteks: string | null): string | null {
  const penerima = tautanEmail(email);
  if (!penerima) return null;
  const subjek = konteks ? `Tanggapan atas minat Anda: ${konteks}` : 'Tanggapan atas minat investasi Anda';
  return `${penerima}?subject=${encodeURIComponent(subjek)}`;
}

export type GalatUbahStatus = { kode: string; pesan: string; konflik: boolean };

/** Memetakan badan galat route `PATCH /api/investasi/lead/[id]` ({ error: { code, message } }). */
export function bacaGalatUbahStatus(badan: unknown, statusHttp: number): GalatUbahStatus {
  const galat = badan && typeof badan === 'object' && 'error' in badan ? (badan as { error: unknown }).error : null;
  const kode = galat && typeof galat === 'object' && typeof (galat as { code?: unknown }).code === 'string'
    ? (galat as { code: string }).code
    : statusHttp === 409 ? 'KONFLIK_VERSI' : 'GAGAL_INTERNAL';
  if (kode === 'KONFLIK_VERSI') {
    return { kode, konflik: true, pesan: 'Data telah berubah oleh pengguna lain. Muat ulang pesan ini sebelum mengubah status.' };
  }
  const pesan = galat && typeof galat === 'object' && typeof (galat as { message?: unknown }).message === 'string'
    ? (galat as { message: string }).message
    : 'Status belum dapat diperbarui. Silakan coba kembali.';
  return { kode, pesan, konflik: false };
}
