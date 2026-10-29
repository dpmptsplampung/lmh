'use client';

import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SKALA_SPAK } from '@/lib/survei/pertanyaan';
import { persen, type RingkasanSpakGlobal } from '@/lib/survei/ringkasan-global';
import { WARNA_BESARAN, WARNA_GRID, WARNA_SKALA_SPAK, fmt1, fmtPersen } from './grafik';
import KartuKpi from './KartuKpi';
import TrenGrafik from './TrenGrafik';
import styles from './HasilGlobal.module.css';

export interface ResponseRateGlobal {
  diundang: number;
  mengisi: number;
  persen: number | null;
}

interface Props {
  data: RingkasanSpakGlobal;
  responseRate: ResponseRateGlobal;
  periodeLabel: string;
}

// SPAK global: seluruh pelayanan digabung. Persentase = bagian JAWABAN (bukan responden); setuju = nilai 5-6, tidak setuju = 1-2.
export default function PanelSpakGlobal({ data, responseRate, periodeLabel }: Props) {
  const adaData = data.responden > 0;

  const setuju = data.butir.map((b) => ({ nama: b.kunci.toUpperCase(), setuju: b.persenSetuju === null ? 0 : Number(b.persenSetuju.toFixed(1)) }));
  const sebaran = data.butir.map((b) => {
    const baris: Record<string, number | string> = { nama: b.kunci.toUpperCase() };
    SKALA_SPAK.forEach((s, i) => {
      baris[`n${s.nilai}`] = Number(((persen(b.distribusi[i], b.jawaban) ?? 0)).toFixed(1));
    });
    return baris;
  });

  return (
    <div>
      <p className={styles.subJudul}>
        {periodeLabel} — seluruh pelayanan digabung. Skala 1 (sangat tidak setuju) sampai 6 (sangat setuju); nilai lebih tinggi lebih baik.
      </p>

      <div className={styles.kpi}>
        <KartuKpi label="Responden" nilai={String(data.responden)} catatan={`${data.jawaban} jawaban`} />
        <KartuKpi label="Indeks SPAK" nilai={fmt1(data.indeks)} satuan="/ 100" catatan="Rata-rata ÷ 6 × 100" />
        <KartuKpi label="Rata-rata" nilai={data.rata === null ? '—' : data.rata.toFixed(2)} satuan="/ 6" />
        <KartuKpi label="Setuju" nilai={fmtPersen(data.persenSetuju)} catatan="Jawaban bernilai 5-6" />
        <KartuKpi label="Tidak setuju" nilai={fmtPersen(data.persenTidakSetuju)} catatan="Jawaban bernilai 1-2" />
        <KartuKpi
          label="Tingkat pengisian"
          nilai={fmtPersen(responseRate.persen)}
          catatan={`${responseRate.mengisi} mengisi dari ${responseRate.diundang} diundang`}
        />
      </div>

      {!adaData ? (
        <p className={styles.kosong}>Belum ada data SPAK pada periode ini.</p>
      ) : (
        <>
          <section className={styles.kartu} aria-label="Persentase setuju per pernyataan">
            <h3 className={styles.judulKartu}>Persentase setuju per pernyataan</h3>
            <p className={styles.subJudul}>Bagian jawaban yang bernilai Setuju atau Sangat Setuju.</p>
            <div className={styles.grafik} role="img" aria-label={`Persentase setuju: ${setuju.map((s) => `${s.nama} ${s.setuju}%`).join(', ')}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={setuju} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }}>
                  <CartesianGrid stroke={WARNA_GRID} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} unit="%" fontSize={12} tickLine={false} />
                  <YAxis type="category" dataKey="nama" fontSize={12} tickLine={false} width={36} />
                  <Tooltip formatter={(v) => [`${v}%`, 'Setuju']} />
                  <Bar dataKey="setuju" name="Setuju" fill={WARNA_BESARAN} radius={[0, 4, 4, 0]} barSize={22}>
                    <LabelList dataKey="setuju" position="right" formatter={(v) => `${v}%`} fontSize={12} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className={styles.kartu} aria-label="Sebaran jawaban per pernyataan">
            <h3 className={styles.judulKartu}>Sebaran jawaban per pernyataan</h3>
            <p className={styles.subJudul}>Persentase jawaban untuk setiap nilai; merah = tidak setuju, abu-abu = netral, hijau = setuju.</p>
            <div className={`${styles.grafik} ${styles.grafikTinggi}`} role="img" aria-label="Sebaran jawaban per nilai 1 sampai 6 untuk setiap pernyataan; angka lengkap ada di tabel di bawah.">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sebaran} layout="vertical" stackOffset="expand" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid stroke={WARNA_GRID} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} fontSize={12} tickLine={false} />
                  <YAxis type="category" dataKey="nama" fontSize={12} tickLine={false} width={36} />
                  <Tooltip formatter={(v, n) => [`${v}%`, String(n)]} />
                  <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
                  {SKALA_SPAK.map((s, i) => (
                    <Bar key={s.nilai} dataKey={`n${s.nilai}`} name={`${s.nilai} ${s.label}`} stackId="sebaran" fill={WARNA_SKALA_SPAK[i]} stroke="#ffffff" strokeWidth={1} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <TrenGrafik judul="Tren Indeks SPAK" namaNilai="Indeks SPAK" tren={data.tren} mode={data.kelompokTren} />

          <section className={styles.kartu} aria-label="Tabel SPAK per pernyataan">
            <h3 className={styles.judulKartu}>Tabel SPAK per pernyataan</h3>
            <div className={styles.tabelBungkus}>
              <table className={styles.tabel}>
                <thead>
                  <tr>
                    <th scope="col">Pernyataan</th>
                    <th scope="col">Jawaban</th>
                    <th scope="col">Rata-rata</th>
                    <th scope="col">Indeks</th>
                    <th scope="col">Setuju</th>
                    <th scope="col">Netral</th>
                    <th scope="col">Tidak setuju</th>
                  </tr>
                </thead>
                <tbody>
                  {data.butir.map((b) => (
                    <tr key={b.kunci}>
                      <td className={styles.kiri}>
                        <strong>{b.kunci.toUpperCase()}</strong> {b.teks}
                      </td>
                      <td>{b.jawaban}</td>
                      <td>{b.rata === null ? '—' : b.rata.toFixed(2)}</td>
                      <td>{fmt1(b.indeks)}</td>
                      <td>{fmtPersen(b.persenSetuju)}</td>
                      <td>{fmtPersen(b.persenNetral)}</td>
                      <td>{fmtPersen(b.persenTidakSetuju)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={styles.kiri}>Seluruh pernyataan</td>
                    <td>{data.jawaban}</td>
                    <td>{data.rata === null ? '—' : data.rata.toFixed(2)}</td>
                    <td>{fmt1(data.indeks)}</td>
                    <td>{fmtPersen(data.persenSetuju)}</td>
                    <td>{fmtPersen(data.persenNetral)}</td>
                    <td>{fmtPersen(data.persenTidakSetuju)}</td>
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
