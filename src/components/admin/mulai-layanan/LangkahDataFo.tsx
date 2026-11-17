'use client';

// Langkah 1 wizard Mulai Layanan: data yang dicatat Front Office, baca-saja (identitas kunjungan, keperluan dan catatan
// eskalasi, nama pencatat, jam daftar). Tampilan dari props; pemuatan di useDataDariFo.
import Skeleton from '@/components/ui/Skeleton';
import Tombol from '@/components/ui/Tombol';
import type { DataDariFo } from '@/lib/data/pendataan-khusus';
import { formatWaktu } from '@/lib/utils';
import styles from './MulaiLayanan.module.css';

interface Props {
  data: DataDariFo | null;
  memuat: boolean;
  galat: string | null;
  onMuatUlang: () => void;
}

const LABEL_ASAL: Record<string, string> = { walk_in: 'Walk-in', reservasi: 'Reservasi', online: 'Online' };

function Baris({ label, nilai, penuh }: { label: string; nilai: string | null | undefined; penuh?: boolean }) {
  const ada = typeof nilai === 'string' && nilai.trim() !== '';
  return (
    <div className={`${styles.baris}${penuh ? ` ${styles.penuh}` : ''}`}>
      <dt className={styles.label}>{label}</dt>
      <dd className={`${styles.nilai}${ada ? '' : ` ${styles.kosong}`}`}>{ada ? nilai : 'Belum dicatat'}</dd>
    </div>
  );
}

export default function LangkahDataFo({ data, memuat, galat, onMuatUlang }: Props) {
  if (memuat) return <Skeleton bentuk="kartu" jumlah={1} label="Memuat data dari Front Office…" />;
  if (galat) {
    return (
      <div>
        <p role="alert" className={styles.galat}>{galat}</p>
        <Tombol varian="sekunder" ukuran="kecil" onClick={onMuatUlang}>Coba lagi</Tombol>
      </div>
    );
  }
  if (!data) {
    return <p className={styles.ringkas}>Data kunjungan tidak ditemukan atau tidak dapat Anda lihat.</p>;
  }
  const eskalasi = data.eskalasi;
  return (
    <>
      <p className={styles.ringkas}>Data berikut dicatat Front Office dan hanya dapat dibaca. Periksa sebelum melayani.</p>
      <dl className={styles.daftar} aria-label="Data dari Front Office">
        <Baris label="Nama pengunjung" nilai={data.nama} />
        <Baris label="Nomor HP" nilai={data.kontakHp} />
        <Baris label="Email" nilai={data.email} />
        <Baris label="Asal instansi" nilai={data.asalInstansi} />
        <Baris label="Kategori" nilai={data.kategori} />
        <Baris label="Asal kunjungan" nilai={data.asal ? (LABEL_ASAL[data.asal] ?? data.asal) : null} />
        <Baris label="Dicatat oleh" nilai={data.pencatatNama} />
        <Baris label="Jam daftar" nilai={data.waktuDaftar ? `${formatWaktu(data.waktuDaftar)} WIB` : null} />
        <Baris label="Keperluan" nilai={data.keperluan} penuh />
      </dl>
      {data.hasilEskalasi && (
        <section className={styles.eskalasi} aria-label="Catatan eskalasi Front Office">
          <h3 className={styles.eskalasiJudul}>Catatan eskalasi Front Office</h3>
          {eskalasi ? (
            <dl className={styles.daftar}>
              <Baris label="Topik" nilai={eskalasi.topik} />
              <Baris label="Petugas FO" nilai={eskalasi.foNama} />
              <Baris label="Catatan" nilai={eskalasi.catatan} penuh />
            </dl>
          ) : (
            <p className={styles.ringkas}>Catatan eskalasi tidak terbaca.</p>
          )}
        </section>
      )}
    </>
  );
}
