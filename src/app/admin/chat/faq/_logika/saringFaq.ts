// Penyaringan, paginasi, dan nilai awal dialog pada halaman Kelola FAQ (refaktor G8, tugas 8.1): fungsi MURNI.
import type { OpsiFaqLayanan } from '@/lib/faq-scope';
import { UMUM_KEY, type FAQ } from '@/components/admin/faq/types';

export const UKURAN_HALAMAN = 20;

export type FilterStatus = 'semua' | 'aktif' | 'nonaktif';

export const FILTER_STATUS: ReadonlyArray<{ nilai: FilterStatus; label: string }> = [
  { nilai: 'semua', label: 'Semua' },
  { nilai: 'aktif', label: 'Aktif' },
  { nilai: 'nonaktif', label: 'Nonaktif' },
];

export interface FilterFaqNilai {
  cari: string;
  status: FilterStatus;
  /** '' = semua cakupan; UMUM_KEY = FAQ umum; selain itu id layanan. */
  cakupan: string;
}

/** Pencarian + status + cakupan di sisi klien (lingkup sudah dibatasi saat memuat). */
export function saringFaq(daftar: readonly FAQ[], f: FilterFaqNilai): FAQ[] {
  const kata = f.cari.trim().toLowerCase();
  return daftar.filter((x) => {
    if (f.status === 'aktif' && !x.aktif) return false;
    if (f.status === 'nonaktif' && x.aktif) return false;
    if (f.cakupan === UMUM_KEY && x.layanan_id !== null) return false;
    if (f.cakupan && f.cakupan !== UMUM_KEY && x.layanan_id !== f.cakupan) return false;
    if (kata && !`${x.pertanyaan} ${x.jawaban}`.toLowerCase().includes(kata)) return false;
    return true;
  });
}

export function adaFilterAktif(f: FilterFaqNilai): boolean {
  return f.cari.trim() !== '' || f.status !== 'semua' || f.cakupan !== '';
}

/** Halaman (berbasis 0) dijepit ke rentang yang ada, lalu dipotong. */
export function potongHalaman<T>(daftar: readonly T[], halaman: number): { halaman: number; isi: T[] } {
  const aman = Math.min(halaman, Math.max(0, Math.ceil(daftar.length / UKURAN_HALAMAN) - 1));
  return { halaman: aman, isi: daftar.slice(aman * UKURAN_HALAMAN, (aman + 1) * UKURAN_HALAMAN) };
}

/** Cakupan awal dialog Tambah: filter cakupan bila boleh dikelola, selain itu opsi pertama ('' bila tak ada opsi). */
export function kunciAwalTambah(filterCakupan: string, opsi: readonly OpsiFaqLayanan[]): string {
  if (filterCakupan && opsi.some((o) => (o.id ?? UMUM_KEY) === filterCakupan)) return filterCakupan;
  return opsi[0] ? (opsi[0].id ?? UMUM_KEY) : '';
}
