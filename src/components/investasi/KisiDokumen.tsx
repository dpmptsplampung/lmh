import type { DokumenPublik } from '@/lib/investasi/dokumen';
import KartuDokumen from './KartuDokumen';
import styles from './dokumen.module.css';

/** Kisi kartu dokumen: 1 sampai 5 kartu ditata khusus, selebihnya 3 kolom; (`data-jumlah`), tanpa kolom kosong di desktop. */
export default function KisiDokumen({ dokumen, label }: { dokumen: DokumenPublik[]; label: string }) {
  return (
    <ul className={styles.kisi} data-jumlah={dokumen.length <= 5 ? dokumen.length : 'banyak'} aria-label={label}>
      {dokumen.map(d => <li key={d.id}><KartuDokumen dokumen={d} /></li>)}
    </ul>
  );
}
