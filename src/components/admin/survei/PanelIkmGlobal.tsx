'use client';

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RingkasanIkmGlobal } from '@/lib/survei/ringkasan-global';
import { persen } from '@/lib/survei/ringkasan-global';
import { WARNA_BESARAN, WARNA_GRID, fmt1, fmtPersen } from './grafik';
import KartuKpi from './KartuKpi';
import TrenGrafik from './TrenGrafik';
import type { ResponseRateGlobal } from './PanelSpakGlobal';
import styles from './HasilGlobal.module.css';

const MUTU: { kode: 'A' | 'B' | 'C' | 'D'; label: string; rentang: string }[] = [
  { kode: 'A', label: 'Sangat Baik', rentang: '88 - 100' },
  { kode: 'B', label: 'Baik', rentang: '76 - 87,99' },
  { kode: 'C', label: 'Kurang Baik', rentang: '60 - 75,99' },
  { kode: 'D', label: 'Tidak Baik', rentang: 'di bawah 60' },
];

interface Props {
  data: RingkasanIkmGlobal;
  responseRate: ResponseRateGlobal;
  periodeLabel: string;
}

// IKM global (PermenPANRB 14/2017): seluruh pelayanan digabung; IKM = rata-rata unsur terisi x 25 (skala 25-100).
export default function PanelIkmGlobal({ data, responseRate, periodeLabel }: Props) {
  const grafik = data.unsur.filter((u) => u.nilai !== null).map((u) => ({ nama: u.kunci.toUpperCase(), nilai: Number((u.nilai as number).toFixed(1)) }));

  return (
    <div>
      <p className={styles.subJudul}>{periodeLabel} — seluruh pelayanan digabung. 9 sampai 11 unsur kepuasan, skala 25-100.</p>

      <div className={styles.kpi}>
        <KartuKpi label="Responden" nilai={String(data.responden)} />
        <KartuKpi label="IKM" nilai={fmt1(data.ikm)} satuan="/ 100" catatan={data.mutuLabel} />
        <KartuKpi
          label="Tingkat pengisian"
          nilai={fmtPersen(responseRate.persen)}
          catatan={`${responseRate.mengisi} mengisi dari ${responseRate.diundang} diundang`}
        />
      </div>

      {data.responden === 0 ? (
        <p className={styles.kosong}>Belum ada data IKM pada periode ini.</p>
      ) : (
        <>
          <section className={styles.kartu} aria-label="Nilai IKM per unsur">
            <h3 className={styles.judulKartu}>Nilai per unsur pelayanan</h3>
            <p className={styles.subJudul}>Rata-rata penilaian pengunjung untuk tiap unsur (skala 25-100). Nama unsur ada di tabel di bawah.</p>
            <div className={`${styles.grafik} ${styles.grafikTinggi}`} role="img" aria-label={`Nilai per unsur: ${grafik.map((g) => `${g.nama} ${g.nilai}`).join(', ')}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={grafik} margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid stroke={WARNA_GRID} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="nama" fontSize={12} tickLine={false} />
                  <YAxis domain={[0, 100]} fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [v as number, 'Nilai']} />
                  <Bar dataKey="nilai" name="Nilai" fill={WARNA_BESARAN} radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="nilai" position="top" fontSize={11} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <TrenGrafik judul="Tren IKM" namaNilai="IKM" tren={data.tren} mode={data.kelompokTren} />

          <section className={styles.kartu} aria-label="Sebaran mutu pelayanan">
            <h3 className={styles.judulKartu}>Sebaran mutu pelayanan</h3>
            <p className={styles.subJudul}>Banyak responden menurut IKM masing-masing.</p>
            <div className={styles.tabelBungkus}>
              <table className={styles.tabel}>
                <thead>
                  <tr>
                    <th scope="col">Mutu</th>
                    <th scope="col">Rentang IKM</th>
                    <th scope="col">Responden</th>
                    <th scope="col">Persen</th>
                  </tr>
                </thead>
                <tbody>
                  {MUTU.map((m) => (
                    <tr key={m.kode}>
                      <td className={styles.kiri}>
                        <strong>{m.kode}</strong> — {m.label}
                      </td>
                      <td>{m.rentang}</td>
                      <td>{data.sebaranMutu[m.kode]}</td>
                      <td>{fmtPersen(persen(data.sebaranMutu[m.kode], data.responden))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.kartu} aria-label="Tabel IKM per unsur">
            <h3 className={styles.judulKartu}>Tabel IKM per unsur</h3>
            <div className={styles.tabelBungkus}>
              <table className={styles.tabel}>
                <thead>
                  <tr>
                    <th scope="col">Unsur</th>
                    <th scope="col">Jawaban</th>
                    <th scope="col">Rata-rata (1-4)</th>
                    <th scope="col">Nilai (25-100)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unsur.map((u) => (
                    <tr key={u.kunci}>
                      <td className={styles.kiri}>
                        <strong>{u.kunci.toUpperCase()}</strong> {u.teks}
                      </td>
                      <td>{u.jawaban}</td>
                      <td>{u.rata === null ? '—' : u.rata.toFixed(2)}</td>
                      <td>{fmt1(u.nilai)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={styles.kiri}>IKM keseluruhan</td>
                    <td>{data.responden}</td>
                    <td>—</td>
                    <td>{fmt1(data.ikm)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
