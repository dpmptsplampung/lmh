'use client';

import { PERTANYAAN_SPAK, type KunciSpak } from '@/lib/survei/pertanyaan';
import styles from './SpakPanel.module.css';

/** Satu baris `ringkasan_spak` (rata-rata dapat berupa string numerik dari PostgREST). */
export interface SpakRow {
  layanan_id: string | null;
  unit: string;
  nama: string;
  responden: number;
  p1: number | string | null;
  p2: number | string | null;
  p3: number | string | null;
  p4: number | string | null;
  p5: number | string | null;
}

interface SpakPanelProps {
  rows: SpakRow[];
  periodLabel: string;
}

const KOSONG = '—';

function angka(v: number | string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(v: number | null): string {
  return v === null ? KOSONG : v.toFixed(1);
}

/** Rata-rata tertimbang jumlah responden; baris tanpa responden atau tanpa nilai tidak ikut. */
function rataSemuaUnit(rows: SpakRow[], kunci: KunciSpak): number | null {
  let bobot = 0;
  let jumlah = 0;
  for (const r of rows) {
    const nilai = angka(r[kunci]);
    if (nilai === null || r.responden <= 0) continue;
    bobot += r.responden;
    jumlah += nilai * r.responden;
  }
  return bobot > 0 ? jumlah / bobot : null;
}

export default function SpakPanel({ rows, periodLabel }: SpakPanelProps) {
  const totalResponden = rows.reduce((s, r) => s + (r.responden ?? 0), 0);

  return (
    <section className={styles.panel} aria-label="Rata-rata SPAK per unit">
      <h3 className={styles.title}>Rata-rata SPAK per Unit</h3>
      <p className={styles.subtitle}>
        {periodLabel}: skala 1 (sangat tidak setuju) sampai 6 (sangat setuju); nilai lebih tinggi lebih baik.
      </p>

      <ol className={styles.legend}>
        {PERTANYAAN_SPAK.map((p) => (
          <li key={p.kunci}>
            <strong>{p.kunci.toUpperCase()}</strong> {p.teks}
          </li>
        ))}
      </ol>

      {rows.length === 0 ? (
        <p className={styles.empty}>Belum ada data SPAK pada periode ini.</p>
      ) : (
        <div className={styles.wrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Unit</th>
                <th scope="col">Responden</th>
                {PERTANYAAN_SPAK.map((p) => (
                  <th key={p.kunci} scope="col" title={p.teks}>
                    {p.kunci.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.unit}:${r.layanan_id ?? r.nama}`}>
                  <td className={styles.nama}>{r.nama}</td>
                  <td>{r.responden}</td>
                  {PERTANYAAN_SPAK.map((p) => (
                    <td key={p.kunci}>{fmt(angka(r[p.kunci]))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className={styles.nama}>Semua unit</td>
                <td>{totalResponden}</td>
                {PERTANYAAN_SPAK.map((p) => (
                  <td key={p.kunci}>{fmt(rataSemuaUnit(rows, p.kunci))}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
