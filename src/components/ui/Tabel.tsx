import type { Key, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BISA_DIFOKUS } from './fokus';
import Skeleton from './Skeleton';
import styles from './Tabel.module.css';

export interface KolomTabel<T> {
  kunci: string;
  judul: ReactNode;
  /** Label teks untuk mode kartu di HP bila `judul` bukan string. */
  labelHp?: string;
  /** Isi sel; bawaan: baris[kunci]. */
  render?: (baris: T, indeks: number) => ReactNode;
  /** Rata kanan + tabular-nums. */
  angka?: boolean;
  /** Kolom ini adalah kepala baris (<th scope="row">). Satu kolom saja. */
  judulBaris?: boolean;
  /** Mode kartu di HP: `utama` = judul kartu (tanpa label), `aksi` = baris aksi di dasar kartu (tanpa label). */
  peran?: 'utama' | 'aksi';
  /** Lebar kolom (CSS), mis. "120px". */
  lebar?: string;
  /** Sembunyikan kolom di layar sempit mode kartu. */
  sembunyiDiHp?: boolean;
}

export interface TabelProps<T> {
  kolom: KolomTabel<T>[];
  baris: T[];
  /** Nama properti atau fungsi penghasil kunci unik baris. */
  kunciBaris: keyof T | ((baris: T, indeks: number) => Key);
  /** Teks caption (wajib; dipakai juga sebagai nama wilayah gulir). */
  caption: string;
  /** Tampilkan caption secara visual (bawaan: tersembunyi, tetap terbaca pembaca layar). */
  captionTampil?: boolean;
  /** Dirender bila `baris` kosong dan tidak `memuat` (mis. <StatusKosong> atau <CatatanKeadaan>). */
  kosong?: ReactNode;
  memuat?: boolean;
  padat?: boolean;
  /**
   * Di bawah 640px setiap baris menjadi kartu (A14). Satu sumber data dan satu daftar aksi:
   * markup tabel yang sama, hanya tampilannya yang berubah, jadi tes dan pembaca layar tidak bercabang.
   */
  kartuDiHp?: boolean;
  /** Dipanggil untuk menambah kelas pada <tr> (mis. baris terpilih). */
  kelasBaris?: (baris: T, indeks: number) => string | undefined;
  className?: string;
}

// Tabel data. <table> asli dengan caption, <th scope>, dan pembungkus gulir yang bisa difokus (region).
export default function Tabel<T>({
  kolom,
  baris,
  kunciBaris,
  caption,
  captionTampil = false,
  kosong,
  memuat = false,
  padat = false,
  kartuDiHp = false,
  kelasBaris,
  className,
}: TabelProps<T>) {
  if (memuat) {
    return (
      <div className={cn(styles.bungkus, className)} aria-busy="true">
        <Skeleton bentuk="baris" jumlah={5} label={`Memuat ${caption}`} />
      </div>
    );
  }
  if (baris.length === 0 && kosong) {
    return <div className={className}>{kosong}</div>;
  }

  const ambilKunci = (b: T, i: number): Key =>
    typeof kunciBaris === 'function' ? kunciBaris(b, i) : (b[kunciBaris] as unknown as Key);

  return (
    <div
      className={cn(styles.bungkus, kartuDiHp && styles.kartuDiHp, className)}
      role="region"
      aria-label={caption}
      {...BISA_DIFOKUS}
    >
      <table className={cn(styles.tabel, padat && styles.padat)}>
        <caption className={captionTampil ? styles.captionTampil : 'sr-only'}>{caption}</caption>
        <thead>
          <tr>
            {kolom.map((k) => (
              <th
                key={k.kunci}
                scope="col"
                className={cn(k.angka && styles.angka, k.sembunyiDiHp && styles.sembunyiDiHp)}
                style={k.lebar ? { width: k.lebar } : undefined}
              >
                {k.judul}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {baris.map((b, i) => (
            <tr key={ambilKunci(b, i)} className={kelasBaris?.(b, i)}>
              {kolom.map((k) => {
                const isi = k.render ? k.render(b, i) : (b as Record<string, ReactNode>)[k.kunci];
                const label = k.labelHp ?? (typeof k.judul === 'string' ? k.judul : undefined);
                const kelas = cn(
                  k.angka && styles.angka,
                  k.peran === 'utama' && styles.peranUtama,
                  k.peran === 'aksi' && styles.peranAksi,
                  k.sembunyiDiHp && styles.sembunyiDiHp,
                );
                return k.judulBaris ? (
                  <th key={k.kunci} scope="row" className={cn(kelas, styles.kepalaBaris)} data-label={label}>
                    {isi}
                  </th>
                ) : (
                  <td key={k.kunci} className={kelas} data-label={k.peran ? undefined : label}>
                    {isi}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
