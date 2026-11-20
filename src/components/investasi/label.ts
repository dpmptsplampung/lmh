import { formatNilaiRingkas } from '@/lib/investasi/format';
import { SEKTOR_IPRO, SKEMA_IPRO, STATUS_LAHAN, TAHAP_KAJIAN } from '@/lib/investasi/konstanta';

type Daftar = readonly { nilai: string; id: string }[];
const cari = (daftar: Daftar, nilai: string | null) => (nilai ? daftar.find(d => d.nilai === nilai)?.id ?? null : null);

export const labelSektor = (nilai: string) => cari(SEKTOR_IPRO, nilai) ?? nilai;
export const labelTahap = (nilai: string | null) => cari(TAHAP_KAJIAN, nilai);
export const labelSkema = (nilai: string | null) => cari(SKEMA_IPRO, nilai);
export const labelLahan = (nilai: string | null) => cari(STATUS_LAHAN, nilai);

type SumberNilai = {
  sumber: 'ptsp' | 'foila';
  nilai_investasi: number | null;
  mata_uang: 'IDR' | 'USD';
  nilai_teks: string | null;
};

/** Nilai untuk kartu: FOILA memakai label apa adanya (`nilai_teks`), PTSP memakai angka + mata uang tanpa konversi. */
export function teksNilai(k: SumberNilai): string | null {
  if (k.sumber === 'foila' && k.nilai_teks) return k.nilai_teks;
  if (k.nilai_investasi !== null) return formatNilaiRingkas(k.nilai_investasi, k.mata_uang);
  return k.nilai_teks;
}

export function formatLuas(ha: number | null): string | null {
  if (ha === null || !Number.isFinite(ha)) return null;
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(ha)} ha`;
}

/** Tanggal panjang dalam WIB, mis. "20 November 2026". */
export function tanggalPanjangWIB(iso: string): string {
  const tanggal = new Date(iso);
  if (Number.isNaN(tanggal.getTime())) return '';
  return tanggal.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
}
