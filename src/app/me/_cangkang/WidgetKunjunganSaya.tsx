'use client';

// Widget sidebar pengunjung (SISTEM-DESAIN 4.2, baris Pengunjung): reservasi berikutnya. Memakai gaya
// WidgetSidebar supaya sama dengan sidebar staf. Gagal memuat = catatan netral, bukan galat merah.
import Link from 'next/link';
import { ArrowRight, CalendarCheck } from 'lucide-react';
import { formatTanggal } from '@/lib/utils';
import { todayWIB } from '@/lib/time';
import type { DataPengunjung } from './useDataPengunjung';
import styles from '@/components/layout/WidgetSidebar.module.css';

export interface WidgetKunjunganSayaProps {
  kunjungan: DataPengunjung['kunjungan'];
  onNavigasi?: () => void;
}

export function teksTanggalKunjungan(tanggal: string, hariIni: string = todayWIB()): string {
  if (tanggal === hariIni) return 'Hari ini';
  return formatTanggal(`${tanggal}T12:00:00+07:00`, { weekday: 'short', day: 'numeric', month: 'long', year: undefined });
}

export default function WidgetKunjunganSaya({ kunjungan, onNavigasi }: WidgetKunjunganSayaProps) {
  const { status, data } = kunjungan;
  const tujuan = data
    ? data.tujuan === 'bertemu_seseorang'
      ? `Bertemu ${data.namaYangDitemui ?? '-'}`
      : data.layanan ?? 'Loket layanan'
    : null;

  return (
    <section className={styles.widget} aria-labelledby="widget-kunjungan-judul" data-cetak="sembunyi" data-widget>
      <div className={styles.atas}>
        <h2 className={styles.judul} id="widget-kunjungan-judul">
          <span className={styles.ikon} aria-hidden="true"><CalendarCheck size={16} strokeWidth={1.75} /></span>
          Kunjungan saya
        </h2>
      </div>
      {status === 'memuat' && <p className={styles.keterangan}>Memuat kunjungan</p>}
      {status === 'tak-tersedia' && <p className={styles.keterangan}>Data kunjungan belum tersedia</p>}
      {status === 'kosong' && <p className={styles.keterangan}>Belum ada reservasi</p>}
      {status === 'ada' && data && (
        <>
          <p className={styles.keterangan}>{tujuan}</p>
          <dl className={styles.daftar}>
            <div className={styles.baris}>
              <dt>Tanggal</dt>
              <dd>{teksTanggalKunjungan(data.tanggal)}</dd>
            </div>
            {data.jam && (
              <div className={styles.baris}>
                <dt>Perkiraan jam</dt>
                <dd>{data.jam} WIB</dd>
              </div>
            )}
            {data.nomorAntrean && (
              <div className={styles.baris}>
                <dt>Nomor antrean</dt>
                <dd>{data.nomorAntrean}</dd>
              </div>
            )}
          </dl>
        </>
      )}
      <Link href="/me/reservasi" className={styles.tombol} onClick={onNavigasi}>
        {status === 'kosong' ? 'Buat reservasi' : 'Lihat reservasi'}
        <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </section>
  );
}
