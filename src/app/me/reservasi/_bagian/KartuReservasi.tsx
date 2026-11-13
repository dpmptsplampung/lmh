'use client';

// Satu reservasi di daftar "Reservasi Saya": QR + info untuk yang masih terjadwal, dengan konfirmasi dua langkah
// sebelum membatalkan. Tanpa query; aksi lewat props.
import { CalendarPlus, Clock, XCircle } from 'lucide-react';
import QRCodeDisplay from '@/components/QRCode';
import Lencana from '@/components/ui/Lencana';
import Tombol from '@/components/ui/Tombol';
import { labelStatusReservasi, type ReservasiKunjungan } from '@/lib/reservasi';
import { formatTanggal } from '@/lib/utils';
import { nadaReservasi } from '../_logika/tampilanReservasi';
import styles from '../reservasi.module.css';

interface KartuReservasiProps {
  reservasi: ReservasiKunjungan;
  /** Judul baris: nama layanan atau "Bertemu: <nama>". */
  judul: string;
  /** Id reservasi yang sedang menunggu konfirmasi batal. */
  konfirmasiBatal: string | null;
  /** Id reservasi yang sedang dibatalkan (RPC berjalan). */
  membatalkan: string | null;
  onMintaBatal: (id: string) => void;
  onBatalkan: (id: string) => void;
  onTutupKonfirmasi: () => void;
}

export default function KartuReservasi({
  reservasi: r,
  judul,
  konfirmasiBatal,
  membatalkan,
  onMintaBatal,
  onBatalkan,
  onTutupKonfirmasi,
}: KartuReservasiProps) {
  const info = labelStatusReservasi(r.status);
  const aktif = r.status === 'terjadwal';
  const sedangBatal = membatalkan === r.id;

  return (
    <li className={styles.reservasiCard}>
      {aktif && (
        <div className={styles.reservasiQr}>
          <QRCodeDisplay value={r.qr_token} size={90} />
        </div>
      )}
      <div className={styles.reservasiInfo}>
        <div className={styles.daftarBaris}>
          <span className={styles.reservasiNama}>{judul}</span>
          <Lencana nada={nadaReservasi(r.status)}>{info.label}</Lencana>
        </div>
        <div className={styles.reservasiMeta}>
          <CalendarPlus size={14} strokeWidth={1.75} className={styles.reservasiMetaIcon} aria-hidden="true" />
          {formatTanggal(`${r.tanggal}T12:00:00+07:00`, { weekday: 'long' })}
        </div>
        {r.jam_rencana && (
          <div className={styles.reservasiMeta}>
            <Clock size={14} strokeWidth={1.75} className={styles.reservasiMetaIcon} aria-hidden="true" />
            {r.jam_rencana.substring(0, 5)} WIB
          </div>
        )}
        {aktif && (
          <>
            <p className={styles.daftarCatatan}>Tunjukkan QR ini ke petugas Front Office saat tiba.</p>
            {konfirmasiBatal === r.id ? (
              <div className={styles.daftarAksi}>
                <Tombol varian="bahaya" ukuran="kecil" onClick={() => onBatalkan(r.id)} disabled={sedangBatal}>
                  {sedangBatal ? 'Membatalkan…' : 'Ya, batalkan'}
                </Tombol>
                <Tombol varian="sekunder" ukuran="kecil" onClick={onTutupKonfirmasi} disabled={sedangBatal}>
                  Tidak
                </Tombol>
              </div>
            ) : (
              <div className={styles.daftarAksi}>
                <Tombol
                  varian="hantu"
                  ukuran="kecil"
                  ikon={XCircle}
                  onClick={() => onMintaBatal(r.id)}
                  disabled={membatalkan !== null}
                >
                  Batalkan reservasi
                </Tombol>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}
