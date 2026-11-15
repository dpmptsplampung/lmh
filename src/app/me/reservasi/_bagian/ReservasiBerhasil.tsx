'use client';

// Layar sesudah reservasi dibuat: QR untuk dipindai petugas Front Office. Tanpa query.
import { CalendarPlus, CheckCircle2 } from 'lucide-react';
import QRCodeDisplay from '@/components/QRCode';
import Tombol from '@/components/ui/Tombol';
import styles from '../reservasi.module.css';

interface ReservasiBerhasilProps {
  qrToken: string;
  onBuatLagi: () => void;
}

export default function ReservasiBerhasil({ qrToken, onBuatLagi }: ReservasiBerhasilProps) {
  return (
    <div className={styles.berhasil}>
      <span className={styles.berhasilIkon}>
        <CheckCircle2 size={28} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className={styles.berhasilTeks}>
        Simpan QR code ini dan tunjukkan ke petugas saat Anda tiba di kantor DPMPTSP.
      </p>

      <div className={styles.qrWrapper}>
        <QRCodeDisplay value={qrToken} size={180} />
        <p className={styles.qrHint}>
          Tunjukkan QR code ini ke petugas Front Office untuk dipindai saat tiba di kantor
        </p>
        <p className={styles.qrHint}>QR ini juga tersimpan di daftar Reservasi Saya.</p>
      </div>

      <div className={styles.aksiBerhasil}>
        <Tombol href="/me">Kembali ke Beranda saya</Tombol>
        <Tombol varian="sekunder" ikon={CalendarPlus} onClick={onBuatLagi}>
          Buat Reservasi Lain
        </Tombol>
      </div>
    </div>
  );
}
