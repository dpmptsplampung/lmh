'use client';

// Kartu daftar antrean: tab saringan status, galat muat, tabel tiket (kolom menurut peran), keadaan kosong, paginasi.
// Hanya tampilan dari props: data, penangan aksi, dan halaman dikirim halaman (hook useAntrean/useAksiAntrean).
import { Users } from 'lucide-react';
import Pagination from '@/components/Pagination';
import Galat from '@/components/ui/Galat';
import Kartu from '@/components/ui/Kartu';
import Lencana from '@/components/ui/Lencana';
import StatusKosong from '@/components/ui/StatusKosong';
import { PanelTab } from '@/components/ui/Tab';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import type { CatatanEskalasi, ProfilPetugasAntrean, TiketBaris } from '@/lib/data/antrean';
import type { StatusSurvei } from '@/lib/survei/staf';
import { formatWaktu } from '@/lib/utils';
import type { FilterStatus } from '../antrianUrl';
import { bolehLihatSemuaLayanan, kunjunganDari, labelAsal, namaLayananDari, tanggalPanjang } from '../_logika/turunan';
import FilterAntrian, { ID_TAB_STATUS, LABEL_FILTER } from './FilterAntrian';
import SelAksi, { type AksiTiket } from './SelAksi';
import SelNama from './SelNama';
import SelStatus from './SelStatus';
import styles from '../antrian.module.css';

export interface DaftarAntreanProps {
  baris: TiketBaris[];
  pengguna: ProfilPetugasAntrean | null;
  /** Daftar dari RPC akses FO: kolom "Front Office" tersedia. */
  aksesFo: boolean;
  /** penanganan_asal_id -> catatan eskalasi FO. */
  catatanEskalasi: Record<string, CatatanEskalasi>;
  /** kunjungan_id -> status Pesan Perilaku. */
  statusSurvei: ReadonlyMap<string, StatusSurvei>;
  aksi: AksiTiket;
  tanggal: string;
  filterStatus: FilterStatus;
  onGantiStatus: (kunci: string) => void;
  /** Indeks halaman berbasis 0. */
  halaman: number;
  ukuranHalaman: number;
  total: number;
  onGantiHalaman: (halaman: number) => void;
  /** Skeleton: muat awal / ganti parameter. */
  memuat: boolean;
  /** Muat ulang senyap berjalan: tabel tetap tampil. */
  menyegarkan: boolean;
  galatMuat: string | null;
  onMuatUlang: () => void;
}

// Keadaan kosong: beda antara "memang kosong" dan "kosong karena saringan status".
function KosongAntrean({ filterStatus }: { filterStatus: FilterStatus }) {
  if (filterStatus === 'semua') {
    return <StatusKosong ikon={Users} judul="Belum Ada Antrean" isi="Belum ada tiket untuk tanggal ini." />;
  }
  return (
    <StatusKosong
      ikon={Users}
      judul={filterStatus === 'aktif' ? 'Tidak ada antrean aktif' : 'Belum ada tiket selesai'}
      isi={filterStatus === 'aktif'
        ? 'Tidak ada tiket menunggu atau sedang dilayani pada tanggal ini. Lihat tab Selesai atau Semua.'
        : 'Belum ada tiket yang selesai pada tanggal ini. Lihat tab Aktif atau Semua.'}
    />
  );
}

export default function DaftarAntrean({
  baris, pengguna, aksesFo, catatanEskalasi, statusSurvei, aksi, tanggal, filterStatus, onGantiStatus,
  halaman, ukuranHalaman, total, onGantiHalaman, memuat, menyegarkan, galatMuat, onMuatUlang,
}: DaftarAntreanProps) {
  const kolom: KolomTabel<TiketBaris>[] = [
    { kunci: 'nomor', judul: 'No. Tiket', peran: 'utama', render: (a) => <span className={styles.nomor}>{a.nomor_display}</span> },
    ...(bolehLihatSemuaLayanan(pengguna)
      ? [{ kunci: 'layanan', judul: 'Layanan', render: (a: TiketBaris) => <span className={styles.layanan}>{namaLayananDari(a)}</span> }]
      : []),
    {
      kunci: 'nama',
      judul: 'Nama',
      render: (a) => (
        <SelNama tiket={a} catatanFo={a.penanganan_asal_id ? catatanEskalasi[a.penanganan_asal_id] : undefined} />
      ),
    },
    {
      kunci: 'asal',
      judul: 'Asal',
      render: (a) => {
        const asal = kunjunganDari(a)?.asal ?? 'walk_in';
        return <Lencana nada={asal === 'reservasi' ? 'info' : 'netral'}>{labelAsal(asal)}</Lencana>;
      },
    },
    ...(aksesFo ? [{ kunci: 'fo', judul: 'Front Office', render: (a: TiketBaris) => a.fo_nama ?? '—' }] : []),
    {
      kunci: 'waktu',
      judul: 'Waktu Masuk',
      render: (a) => {
        const waktuMasuk = kunjunganDari(a)?.waktu_masuk ?? a.waktu_terbit;
        return <span className={styles.waktu}>{waktuMasuk ? formatWaktu(waktuMasuk) : '—'}</span>;
      },
    },
    { kunci: 'status', judul: 'Status', render: (a) => <SelStatus tiket={a} pengguna={pengguna} /> },
    {
      kunci: 'aksi',
      judul: 'Aksi / Durasi',
      peran: 'aksi',
      render: (a) => <SelAksi tiket={a} pengguna={pengguna} aksi={aksi} statusSurvei={statusSurvei.get(a.kunjungan_id)} />,
    },
  ];

  return (
    <Kartu padding="tanpa" as="section">
      <FilterAntrian aktif={filterStatus} onGanti={onGantiStatus} />
      <PanelTab idTab={ID_TAB_STATUS} kunci={filterStatus} aktif={filterStatus}>
        {galatMuat ? (
          <div className={styles.tidakAda}>
            <Galat pesan={galatMuat} onRetry={onMuatUlang} memuat={memuat} />
          </div>
        ) : (
          <div aria-busy={menyegarkan || undefined}>
            <Tabel
              kolom={kolom}
              baris={baris}
              kunciBaris="id"
              caption={`Daftar antrean ${tanggalPanjang(tanggal)}, tab ${LABEL_FILTER[filterStatus]}`}
              memuat={memuat}
              kartuDiHp
              kosong={<KosongAntrean filterStatus={filterStatus} />}
            />
            {!memuat && <Pagination page={halaman} pageSize={ukuranHalaman} total={total} onPageChange={onGantiHalaman} />}
          </div>
        )}
      </PanelTab>
    </Kartu>
  );
}
