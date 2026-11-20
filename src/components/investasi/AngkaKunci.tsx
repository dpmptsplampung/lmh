import { formatNilaiRingkas, formatPayback, formatPersen } from '@/lib/investasi/format';
import { formatLuas } from './label';
import styles from './investasi.module.css';

export type SumberAngkaKunci = {
  nilai_investasi: number | null;
  mata_uang: 'IDR' | 'USD';
  irr_persen: number | null;
  npv_nilai: number | null;
  payback_bulan: number | null;
  luas_ha: number | null;
};

/** Angka kunci proyek. Nilai kosong tidak ditampilkan; tanpa satu pun angka, komponen tidak merender apa-apa. */
export default function AngkaKunci({ data }: { data: SumberAngkaKunci }) {
  const butir: { label: string; nilai: string }[] = [];
  if (data.nilai_investasi !== null) butir.push({ label: 'Nilai investasi', nilai: formatNilaiRingkas(data.nilai_investasi, data.mata_uang) });
  if (data.irr_persen !== null) butir.push({ label: 'IRR', nilai: formatPersen(data.irr_persen) });
  if (data.npv_nilai !== null) butir.push({ label: 'NPV', nilai: formatNilaiRingkas(data.npv_nilai, data.mata_uang) });
  if (data.payback_bulan !== null) butir.push({ label: 'Balik modal', nilai: formatPayback(data.payback_bulan) });
  const luas = formatLuas(data.luas_ha);
  if (luas) butir.push({ label: 'Luas lahan', nilai: luas });
  if (!butir.length) return null;
  return (
    <dl className={styles.angkaKunci}>
      {butir.map(b => (
        <div key={b.label} className={styles.angkaButir}>
          <dt>{b.label}</dt>
          <dd>{b.nilai}</dd>
        </div>
      ))}
    </dl>
  );
}
