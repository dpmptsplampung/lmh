'use client';

// Rekapitulasi absen petugas pada halaman antrean: lipatan di dalam kartu (isi hanya dibaca saat dibuka; lihat
// useRekapAbsensi) + unduhan CSV. Hanya tampilan dari props.
import { ChevronDown, ChevronUp, Download, UserCheck } from 'lucide-react';
import Kartu from '@/components/ui/Kartu';
import Lencana from '@/components/ui/Lencana';
import Skeleton from '@/components/ui/Skeleton';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import Tombol from '@/components/ui/Tombol';
import type { BarisAbsensi } from '@/lib/data/antrean';
import { formatWaktu } from '@/lib/utils';
import { tanggalPanjang } from '../_logika/turunan';
import styles from '../antrian.module.css';

const KOLOM_ABSEN: KolomTabel<BarisAbsensi>[] = [
  { kunci: 'nama', judul: 'Nama Petugas', peran: 'utama', render: (a) => <span className={styles.nama}>{a.petugas?.nama ?? '—'}</span> },
  { kunci: 'masuk', judul: 'Jam Masuk', render: (a) => (a.jam_masuk ? formatWaktu(a.jam_masuk) : '—') },
  { kunci: 'pulang', judul: 'Jam Pulang', render: (a) => (a.jam_pulang ? formatWaktu(a.jam_pulang) : '—') },
  {
    kunci: 'status',
    judul: 'Status',
    render: (a) =>
      a.status === 'approved' ? <Lencana nada="sukses">Disetujui</Lencana>
      : a.status === 'pending' ? <Lencana nada="peringatan">Menunggu</Lencana>
      : a.status === 'ditolak' ? <Lencana nada="netral">Ditolak</Lencana>
      : <Lencana nada="bahaya">Alpa</Lencana>,
  },
];

export interface RekapAbsensiProps {
  tanggal: string;
  terbuka: boolean;
  baris: BarisAbsensi[];
  memuat: boolean;
  /** Buka/tutup lipatan (membuka = membaca ulang). */
  onAlihkan: () => unknown;
  onUnduh: () => void;
}

export default function RekapAbsensi({ tanggal, terbuka, baris, memuat, onAlihkan, onUnduh }: RekapAbsensiProps) {
  return (
    <Kartu padding="tanpa" as="section">
      <button
        type="button"
        className={styles.rekapToggle}
        aria-expanded={terbuka}
        aria-controls="rekap-absen-isi"
        onClick={() => void onAlihkan()}
      >
        <span className={styles.rekapJudul}>
          <UserCheck size={16} strokeWidth={1.75} aria-hidden="true" />
          Rekapitulasi Absen — {tanggalPanjang(tanggal)}
          {baris.length > 0 && <Lencana nada="primer">{baris.length} petugas</Lencana>}
        </span>
        {terbuka ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      {terbuka && (
        <div id="rekap-absen-isi" className={styles.rekapIsi}>
          <div className={styles.rekapAlat}>
            <Tombol varian="hantu" ukuran="kecil" ikon={Download} onClick={onUnduh} disabled={baris.length === 0}>
              Unduh CSV
            </Tombol>
          </div>
          {memuat ? (
            <Skeleton bentuk="baris" jumlah={3} label="Memuat rekapitulasi absen…" />
          ) : baris.length === 0 ? (
            <p className={styles.rekapCatatan}>Belum ada catatan absensi untuk tanggal ini.</p>
          ) : (
            <Tabel kolom={KOLOM_ABSEN} baris={baris} kunciBaris="id" caption="Rekapitulasi absen petugas" padat kartuDiHp />
          )}
        </div>
      )}
    </Kartu>
  );
}
