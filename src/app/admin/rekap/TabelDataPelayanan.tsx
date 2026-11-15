'use client';

// Tabel Data Pelayanan (Rekap terpadu), dibangun di atas komponen Tabel. Dua tampilan: "Ringkas" (kolom inti, sel dua
// baris, jadi kartu di HP) dan "Semua kolom" (seluruh kolom Excel, tiap sel satu baris dengan title; tetap tabel yang
// bergulir ke samping). Teks bebas tidak pernah membuat baris tinggi; isian lengkap satu pelayanan dibuka lewat tombol
// "Lihat detail" di kolom Aksi (bukan klik baris, supaya bisa dioperasikan papan ketik) pada panel samping. Excel tidak
// terpengaruh: kolom tetap berasal dari kolomDataPelayanan().
import { useState } from 'react';
import Tombol from '@/components/ui/Tombol';
import Lencana from '@/components/ui/Lencana';
import PanelSamping from '@/components/ui/PanelSamping';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import { cn } from '@/lib/utils';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit } from '@/lib/rekap/format';
import { labelHasil, namaUnit, type BarisPelayanan, type KolomData, type NilaiSel } from '@/lib/rekap/terpadu';
import styles from './rekap.module.css';

export type TampilanKolom = 'ringkas' | 'semua';

interface Props {
  rows: BarisPelayanan[];
  /** Seluruh kolom (Umum + formulir + Khusus), sama dengan Excel. */
  kolom: KolomData[];
  tampilan: TampilanKolom;
  /** Pesan satu kalimat bila tidak ada baris (memuat / kosong). */
  keadaan: string | null;
}

const TIDAK_ADA = '—';
const CAPTION = 'Data pelayanan, satu baris per pelayanan';
const teksSel = (v: NilaiSel): string => (v == null || v === '' ? TIDAK_ADA : String(v));
const KUNCI_WAKTU = ['tanggal', 'mulai', 'selesai', 'nomor_tiket'];

/** Waktu satu baris: "09:10–09:25 · 15 mnt"; bagian yang kosong dibuang. */
function ringkasWaktu(r: BarisPelayanan): string {
  const mulai = formatWaktuId(r.mulai_at);
  const selesai = formatWaktuId(r.selesai_at);
  const durasi = hitungDurasiMenit(r.mulai_at, r.selesai_at);
  const rentang = mulai && selesai ? `${mulai}–${selesai}` : mulai || selesai;
  return [rentang, durasi != null ? `${durasi} mnt` : ''].filter(Boolean).join(' · ');
}

const kontak = (r: BarisPelayanan): string => [r.pengunjung_hp, r.pengunjung_email].filter(Boolean).join(' · ');

/** Sel teks satu baris yang dipotong dengan elipsis; isi lengkap ada di title. */
const SelTeks = ({ teks }: { teks: string }) => (
  <span className={styles.teks} title={teks}>
    {teks}
  </span>
);

const kolomRingkas = (): KolomTabel<BarisPelayanan>[] => [
  {
    kunci: 'tanggal',
    judul: 'Tanggal',
    peran: 'utama',
    render: (r) => (
      <span className={cn(styles.sel, styles.utama, styles.waktu)}>
        {r.tanggal ? formatTanggalId(r.tanggal) : TIDAK_ADA}
        {ringkasWaktu(r) && <span className={styles.sub}>{ringkasWaktu(r)}</span>}
      </span>
    ),
  },
  {
    kunci: 'pengunjung',
    judul: 'Pengunjung',
    lebar: '230px',
    render: (r) => (
      <span className={cn(styles.sel, styles.utama, styles.pengunjung)}>
        {r.pengunjung_nama ?? TIDAK_ADA}
        {kontak(r) && (
          <span className={styles.sub} title={kontak(r)}>
            {kontak(r)}
          </span>
        )}
      </span>
    ),
  },
  { kunci: 'unit', judul: 'Unit / Layanan', render: (r) => <SelTeks teks={namaUnit(r)} /> },
  { kunci: 'topik', judul: 'Topik', render: (r) => <SelTeks teks={r.topik ?? '(tidak tercatat)'} /> },
  {
    kunci: 'hasil',
    judul: 'Hasil',
    render: (r) =>
      r.hasil ? (
        <Lencana nada={r.hasil === 'selesai' ? 'sukses' : 'netral'} titik className={styles.hasil}>
          {labelHasil(r.hasil)}
        </Lencana>
      ) : (
        TIDAK_ADA
      ),
  },
  { kunci: 'penangan', judul: 'Petugas', render: (r) => <SelTeks teks={r.penangan_nama ?? TIDAK_ADA} /> },
  { kunci: 'fo', judul: 'Front Office', render: (r) => <SelTeks teks={r.fo_nama ?? TIDAK_ADA} /> },
];

const kolomSemua = (kolom: KolomData[]): KolomTabel<BarisPelayanan>[] =>
  kolom.map((k) => ({
    kunci: k.kunci,
    judul: k.judul,
    angka: k.kunci === 'durasi',
    render: (r) => {
      const teks = teksSel(k.ambil(r));
      const waktu = k.kunci === 'durasi' || KUNCI_WAKTU.includes(k.kunci);
      return (
        <span className={waktu ? styles.waktu : styles.teks} title={teks}>
          {teks}
        </span>
      );
    },
  }));

export default function TabelDataPelayanan({ rows, kolom, tampilan, keadaan }: Props) {
  const [idDetail, setIdDetail] = useState<string | null>(null);
  const ringkas = tampilan === 'ringkas';
  const terpilih = rows.find((r) => r.pelayanan_id === idDetail) ?? null;

  const kolomAksi: KolomTabel<BarisPelayanan> = {
    kunci: 'aksi',
    judul: <span className="sr-only">Aksi</span>,
    labelHp: 'Aksi',
    peran: 'aksi',
    lebar: '1%',
    render: (r) => (
      <Tombol
        varian="hantu"
        ukuran="kecil"
        aria-haspopup="dialog"
        aria-label={`Lihat detail pelayanan ${r.pengunjung_nama ?? ''}`.trim()}
        onClick={() => setIdDetail(r.pelayanan_id)}
      >
        Lihat detail
      </Tombol>
    ),
  };

  return (
    <>
      <Tabel
        kolom={[...(ringkas ? kolomRingkas() : kolomSemua(kolom)), kolomAksi]}
        baris={rows}
        kunciBaris="pelayanan_id"
        caption={CAPTION}
        kartuDiHp={ringkas}
        padat={!ringkas}
        className={cn(styles.tabelData, ringkas && styles.tabelKartu)}
        kosong={<p className={styles.kosongSel}>{keadaan ?? 'Belum ada pelayanan dilayani pada rentang ini.'}</p>}
      />
      <PanelSamping
        terbuka={terpilih !== null}
        onTutup={() => setIdDetail(null)}
        judul={`Detail pelayanan ${terpilih?.pengunjung_nama ?? ''}`.trim()}
        lebar="lebar"
        tutupDenganLatar
      >
        {terpilih && (
          <dl className={styles.detail}>
            {kolom.map((k) => (
              <div key={k.kunci} className={styles.detailItem}>
                <dt>{k.judul}</dt>
                <dd>{teksSel(k.ambil(terpilih))}</dd>
              </div>
            ))}
          </dl>
        )}
      </PanelSamping>
    </>
  );
}
