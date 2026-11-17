// Fungsi murni tab Buku Tamu (tanpa I/O, tanpa React): perapian tampilan, pemeriksaan rentang, dan teks.
import type { FilterBukuTamu, FormatUnduh, TamuBuku } from '@/lib/data/buku-tamu';
import { MAKS_BARIS_EKSPOR } from '@/lib/data/buku-tamu';
import type { PetugasRingkas } from '@/lib/data/referensi';
import { formatHpTampil, normalisasiHp } from '@/lib/fo/walkin';
import { formatTanggal, formatWaktu } from '@/lib/utils';

/** Batas rentang yang diterima API (hari, termasuk kedua ujung). */
export const MAKS_HARI_RENTANG = 366;
const MS_HARI = 86_400_000;

const TANGGAL_SINGKAT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

/** Disimpan sebagai +62...; ditampilkan seperti di Front Office (0812-3456-7890). */
export const hpTampil = (hp: string | null): string => (hp ? formatHpTampil(normalisasiHp(hp)) : '—');

export const jumlahHari = (dari: string, sampai: string): number =>
  Math.round((Date.parse(`${sampai}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / MS_HARI) + 1;

/** Pesan galat rentang bila tidak valid; undefined bila boleh dimuat. */
export function galatRentang(dari: string, sampai: string): string | undefined {
  if (!dari || !sampai) return 'Pilih tanggal awal dan akhir.';
  if (dari > sampai) return 'Tanggal akhir tidak boleh sebelum tanggal awal.';
  if (jumlahHari(dari, sampai) > MAKS_HARI_RENTANG) return `Rentang tanggal paling lama ${MAKS_HARI_RENTANG} hari.`;
  return undefined;
}

export const teksPeriode = (dari: string, sampai: string): string =>
  dari === sampai ? formatTanggal(dari) : `${formatTanggal(dari)} sampai ${formatTanggal(sampai)}`;

export function ringkasanDaftar(total: number, f: FilterBukuTamu): string {
  return `${total} tamu pada ${teksPeriode(f.dari, f.sampai)}${f.q ? ` dengan kata kunci "${f.q}"` : ''}`;
}

export const tanggalMasuk = (t: TamuBuku): string => formatTanggal(t.waktu_masuk, TANGGAL_SINGKAT);
export const jamWIB = (iso: string): string => `${formatWaktu(iso)} WIB`;

/** Jam keluar; bila berbeda hari dengan masuk (jarang), tanggal ikut ditulis. */
export function teksKeluar(t: TamuBuku): string | null {
  if (!t.waktu_keluar) return null;
  const hari = (iso: string) => formatTanggal(iso, TANGGAL_SINGKAT);
  return hari(t.waktu_keluar) === hari(t.waktu_masuk)
    ? jamWIB(t.waktu_keluar)
    : `${hari(t.waktu_keluar)}, ${jamWIB(t.waktu_keluar)}`;
}

/** Pilihan "menemui siapa": hanya petugas aktif, urut nama. */
export function petugasPilihan(daftar: PetugasRingkas[] | null | undefined): { id: string; nama: string }[] {
  return (daftar ?? [])
    .filter((p) => p.aktif && p.nama.trim())
    .map((p) => ({ id: p.id, nama: p.nama.trim() }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}

/** Setelah mencatat tamu baru (waktu masuk = sekarang): filter harus memperlihatkannya, kalau tidak direset ke hari ini. */
export const perluResetKeHariIni = (f: FilterBukuTamu, hariIni: string): boolean =>
  f.dari > hariIni || f.sampai < hariIni || f.q !== '';

export const labelFormat = (f: FormatUnduh): string => (f === 'xlsx' ? 'Excel (XLSX)' : 'CSV');

export const pesanTerpotong = (): string =>
  `Data terpotong ke ${new Intl.NumberFormat('id-ID').format(MAKS_BARIS_EKSPOR)} baris. Persempit rentang tanggal atau pencarian lalu unduh lagi.`;

export const pesanBerhasilUnduh = (f: FormatUnduh): string => `Berkas ${f === 'xlsx' ? 'Excel' : 'CSV'} berhasil diunduh`;
