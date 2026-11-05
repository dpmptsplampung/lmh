import { BISA_DIFOKUS } from '../fokus';
import { formatAngka } from '../format';
import type { TabelGrafik } from './tipe';
import styles from './TabelCadangan.module.css';

export interface TabelCadanganProps {
  caption: string;
  tabel: TabelGrafik;
  className?: string;
}

// Padanan teks sebuah grafik (WCAG 1.1.1): tabel biasa dengan caption dan <th scope>. Tampil lewat
// menu "Lihat sebagai tabel" pada PanelGrafik; angka diformat id-ID.
export default function TabelCadangan({ caption, tabel }: TabelCadanganProps) {
  return (
    <div className={styles.bungkus} role="region" aria-label={caption} {...BISA_DIFOKUS}>
      <table className={styles.tabel}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {tabel.kolom.map((k, i) => (
              <th key={k.kunci} scope="col" className={i === 0 ? undefined : styles.angka}>
                {k.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabel.baris.map((b, i) => (
            <tr key={i}>
              {tabel.kolom.map((k, j) => {
                const v = b[k.kunci];
                const teks = typeof v === 'number' ? formatAngka(v) : (v ?? '-');
                return j === 0 ? (
                  <th key={k.kunci} scope="row">
                    {teks}
                  </th>
                ) : (
                  <td key={k.kunci} className={styles.angka}>
                    {teks}
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
