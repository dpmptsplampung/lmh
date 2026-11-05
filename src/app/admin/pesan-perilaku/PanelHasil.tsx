'use client';

import { ClipboardList, Gauge, Users } from 'lucide-react';
import Kartu from '@/components/ui/Kartu';
import KartuStatistik from '@/components/ui/KartuStatistik';
import StatusKosong from '@/components/ui/StatusKosong';
import Tabel from '@/components/ui/Tabel';
import GrafikBatang from '@/components/ui/grafik/GrafikBatang';
import GrafikGaris from '@/components/ui/grafik/GrafikGaris';
import PanelGrafik from '@/components/ui/grafik/PanelGrafik';
import type { BarisData, SeriGrafik } from '@/components/ui/grafik/tipe';
import { RENTANG_MUTU_IKM } from '@/lib/ikm';
import { SKALA_SPAK } from '@/lib/survei/pertanyaan';
import { persen, type RingkasanIkmGlobal, type RingkasanSpakGlobal, type TitikTren } from '@/lib/survei/ringkasan-global';
import { formatTanggal } from '@/lib/utils';
import { fmt1, fmtPersen } from '@/components/admin/survei/grafik';
import styles from './pesanPerilaku.module.css';

interface ResponseRate { diundang: number; mengisi: number; persen: number | null }

function Tren({ judul, tren, mode }: { judul: string; tren: TitikTren[]; mode: 'hari' | 'bulan' }) {
  const data = tren.filter((t) => t.nilai !== null).map((t) => ({
    label: formatTanggal(`${t.periode.length === 7 ? `${t.periode}-01` : t.periode}T00:00:00+07:00`, mode === 'bulan' ? { day: undefined, month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: undefined }),
    nilai: Number(t.nilai!.toFixed(1)), responden: t.responden,
  }));
  return <PanelGrafik judul={judul} meta={mode === 'bulan' ? 'Per bulan' : 'Per hari'}
    tabel={{ kolom: [{ kunci: 'label', label: 'Periode' }, { kunci: 'nilai', label: judul }, { kunci: 'responden', label: 'Responden' }], baris: data }}
    kosong={data.length < 2 ? <StatusKosong ikon={ClipboardList} judul={`Tren muncul setelah ada jawaban pada sedikitnya dua ${mode === 'bulan' ? 'bulan' : 'hari'} berbeda.`} /> : undefined}>
    <GrafikGaris data={data} sumbuX="label" seri={[{ kunci: 'nilai', label: judul, area: true }]} label={judul} />
  </PanelGrafik>;
}

function Pengisian({ data }: { data: ResponseRate }) {
  return <KartuStatistik label="Tingkat pengisian" nilai={fmtPersen(data.persen)} ikon={Users} pembanding={`${data.mengisi} mengisi dari ${data.diundang} diundang`} />;
}

export function PanelIkm({ data, responseRate, periodeLabel }: { data: RingkasanIkmGlobal; responseRate: ResponseRate; periodeLabel: string }) {
  const grafik = data.unsur.filter((u) => u.nilai !== null).map((u) => ({ nama: u.kunci.toUpperCase(), nilai: Number(u.nilai!.toFixed(1)) }));
  const baris = [...data.unsur.map((u) => ({ kunci: u.kunci, unsur: `${u.kunci.toUpperCase()} ${u.teks}`, jawaban: u.jawaban, rata: u.rata === null ? '—' : u.rata.toFixed(2), nilai: fmt1(u.nilai) })),
    { kunci: 'total', unsur: 'IKM keseluruhan', jawaban: data.responden, rata: '—', nilai: fmt1(data.ikm) }];
  return <div className={styles.panel}>
    <p className={styles.keterangan}>{periodeLabel} — seluruh pelayanan digabung. 9 sampai 11 unsur kepuasan, skala 25-100.</p>
    <div className={styles.statistik}>
      <KartuStatistik label="Responden" nilai={data.responden} ikon={Users} />
      <KartuStatistik label="IKM" nilai={fmt1(data.ikm)} ikon={Gauge} pembanding={data.mutuLabel} />
      <Pengisian data={responseRate} />
    </div>
    {data.responden === 0 ? <StatusKosong ikon={ClipboardList} judul="Belum ada data IKM pada periode ini." /> : <>
      <div className={styles.grafikGrid}>
        <PanelGrafik judul="Nilai per unsur pelayanan" meta="Skala 25–100" tabel={{ kolom: [{ kunci: 'nama', label: 'Unsur' }, { kunci: 'nilai', label: 'Nilai' }], baris: grafik }}>
          <GrafikBatang data={grafik} sumbuX="nama" nilai="nilai" labelNilai="Nilai" label="Nilai IKM per unsur" labelAngka="semua" />
        </PanelGrafik>
        <Tren judul="Tren IKM" tren={data.tren} mode={data.kelompokTren} />
      </div>
      <Kartu judul="Sebaran mutu pelayanan">
        <Tabel caption="Sebaran mutu pelayanan" kunciBaris="kode" baris={RENTANG_MUTU_IKM.map((m) => ({ ...m, responden: data.sebaranMutu[m.kode], persen: fmtPersen(persen(data.sebaranMutu[m.kode], data.responden)) }))} kolom={[
          { kunci: 'kode', judul: 'Mutu', render: (m) => `${m.kode} — ${m.label}`, judulBaris: true },
          { kunci: 'rentang', judul: 'Rentang IKM' }, { kunci: 'responden', judul: 'Responden', angka: true }, { kunci: 'persen', judul: 'Persen', angka: true },
        ]} />
      </Kartu>
      <Kartu judul="Tabel IKM per unsur"><Tabel caption="Tabel IKM per unsur" kunciBaris="kunci" baris={baris} kolom={[
        { kunci: 'unsur', judul: 'Unsur', judulBaris: true }, { kunci: 'jawaban', judul: 'Jawaban', angka: true },
        { kunci: 'rata', judul: 'Rata-rata (1-4)', angka: true }, { kunci: 'nilai', judul: 'Nilai (25-100)', angka: true },
      ]} /></Kartu>
    </>}
  </div>;
}

export function PanelSpak({ data, responseRate, periodeLabel }: { data: RingkasanSpakGlobal; responseRate: ResponseRate; periodeLabel: string }) {
  const setuju = data.butir.filter((b) => b.persenSetuju !== null).map((b) => ({ nama: b.kunci.toUpperCase(), setuju: Number(b.persenSetuju!.toFixed(1)) }));
  const sebaran: BarisData[] = data.butir.filter((b) => b.jawaban > 0).map((b) => ({ nama: b.kunci.toUpperCase(), ...Object.fromEntries(SKALA_SPAK.map((s, i) => [`n${s.nilai}`, Number(persen(b.distribusi[i], b.jawaban)!.toFixed(1))])) }));
  const seri: SeriGrafik[] = SKALA_SPAK.map((s, i) => ({ kunci: `n${s.nilai}`, label: `${s.nilai} ${s.label}`, putus: i % 2 === 1, warna: `var(--chart-${i + 1})` }));
  const baris = [...data.butir.map((b) => ({ ...b, teks: `${b.kunci.toUpperCase()} ${b.teks}` })), { ...data, kunci: 'total', teks: 'Seluruh pernyataan' }];
  return <div className={styles.panel}>
    <p className={styles.keterangan}>{periodeLabel} — seluruh pelayanan digabung. Skala 1 (sangat tidak setuju) sampai 6 (sangat setuju); nilai lebih tinggi lebih baik.</p>
    <div className={styles.statistik}>
      <KartuStatistik label="Responden" nilai={data.responden} ikon={Users} pembanding={`${data.jawaban} jawaban`} />
      <KartuStatistik label="Indeks SPAK" nilai={fmt1(data.indeks)} ikon={Gauge} pembanding="Rata-rata ÷ 6 × 100" />
      <KartuStatistik label="Rata-rata" nilai={data.rata === null ? '—' : data.rata.toFixed(2)} pembanding="Skala 1–6" />
      <KartuStatistik label="Setuju" nilai={fmtPersen(data.persenSetuju)} pembanding="Jawaban bernilai 5–6" />
      <KartuStatistik label="Tidak setuju" nilai={fmtPersen(data.persenTidakSetuju)} pembanding="Jawaban bernilai 1–2" />
      <Pengisian data={responseRate} />
    </div>
    {data.responden === 0 ? <StatusKosong ikon={ClipboardList} judul="Belum ada data SPAK pada periode ini." /> : <>
      <div className={styles.grafikGrid}>
        <PanelGrafik judul="Persentase setuju per pernyataan" tabel={{ kolom: [{ kunci: 'nama', label: 'Pernyataan' }, { kunci: 'setuju', label: 'Setuju (%)' }], baris: setuju }}>
          <GrafikBatang data={setuju} sumbuX="nama" nilai="setuju" labelNilai="Setuju" label="Persentase setuju per pernyataan" labelAngka="semua" formatNilai={(n) => `${n}%`} />
        </PanelGrafik>
        <Tren judul="Tren Indeks SPAK" tren={data.tren} mode={data.kelompokTren} />
      </div>
      <PanelGrafik judul="Sebaran jawaban per pernyataan" legenda={seri.map((s) => ({ label: s.label, warna: s.warna!, putus: s.putus }))}
        tabel={{ kolom: [{ kunci: 'nama', label: 'Pernyataan' }, ...seri.map((s) => ({ kunci: s.kunci, label: `${s.label} (%)` }))], baris: sebaran }}>
        <GrafikGaris data={sebaran} sumbuX="nama" seri={seri} label="Sebaran jawaban per nilai 1 sampai 6" formatNilai={(n) => `${n}%`} />
      </PanelGrafik>
      <Kartu judul="Tabel SPAK per pernyataan"><Tabel caption="Tabel SPAK per pernyataan" kunciBaris="kunci" baris={baris} kolom={[
        { kunci: 'teks', judul: 'Pernyataan', judulBaris: true }, { kunci: 'jawaban', judul: 'Jawaban', angka: true },
        { kunci: 'rata', judul: 'Rata-rata', angka: true, render: (b) => b.rata === null ? '—' : b.rata.toFixed(2) },
        { kunci: 'indeks', judul: 'Indeks', angka: true, render: (b) => fmt1(b.indeks) },
        { kunci: 'persenSetuju', judul: 'Setuju', angka: true, render: (b) => fmtPersen(b.persenSetuju) },
        { kunci: 'persenNetral', judul: 'Netral', angka: true, render: (b) => fmtPersen(b.persenNetral) },
        { kunci: 'persenTidakSetuju', judul: 'Tidak setuju', angka: true, render: (b) => fmtPersen(b.persenTidakSetuju) },
      ]} /></Kartu>
    </>}
  </div>;
}
