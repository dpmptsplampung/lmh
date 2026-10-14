// Halaman /checkin = INFORMASI, tidak menulis ke database (K3, audit T3).
// Pendaftaran walk-in dan check-in QR hanya dilakukan Front Office (/admin/fo/daftar, /admin/scan); pengunjung
// cukup datang ke meja Front Office. Server component statis: tanpa sign-in anonim, tanpa akses Supabase.
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CalendarCheck, ClipboardCheck, Users } from 'lucide-react';
import { APP_NAME } from '@/lib/constants';
import styles from './checkin.module.css';

export const metadata: Metadata = {
  title: 'Check-in Kunjungan',
  description: `Cara check-in kunjungan di ${APP_NAME}: walk-in langsung ke Front Office, atau tunjukkan QR reservasi.`,
};

export default function CheckinPage() {
  return (
    <div className={styles.checkinPage}>
      <div className={styles.checkinGlow} />
      <div className={styles.checkinCard}>
        <div className={styles.checkinHeader}>
          <div className={styles.checkinIcon}>
            <ClipboardCheck size={28} aria-hidden="true" />
          </div>
          <h1 className={styles.checkinTitle}>Check-in Kunjungan</h1>
          <p className={styles.checkinSubtitle}>Selamat datang di {APP_NAME}</p>
        </div>

        <div className={styles.checkinBody}>
          <div className={styles.infoList}>
            <section className={styles.infoItem} aria-labelledby="info-walkin">
              <span className={styles.infoIcon} aria-hidden="true">
                <Users size={22} />
              </span>
              <div>
                <h2 id="info-walkin" className={styles.infoTitle}>
                  Datang langsung (walk-in)
                </h2>
                <p className={styles.infoText}>
                  Silakan menuju meja Front Office. Petugas akan mencatat kedatangan Anda dan melayani Anda;
                  bila perlu, Anda diarahkan ke petugas layanan yang sesuai. Anda tidak perlu mengisi
                  formulir sendiri.
                </p>
              </div>
            </section>

            <section className={styles.infoItem} aria-labelledby="info-reservasi">
              <span className={styles.infoIcon} aria-hidden="true">
                <CalendarCheck size={22} />
              </span>
              <div>
                <h2 id="info-reservasi" className={styles.infoTitle}>
                  Sudah punya reservasi?
                </h2>
                <p className={styles.infoText}>
                  Tunjukkan QR reservasi Anda kepada petugas Front Office untuk dipindai. QR tersedia di
                  halaman reservasi akun Anda.
                </p>
                <Link href="/me/reservasi" className="btn btn--primary btn--sm">
                  Lihat QR Reservasi
                </Link>
              </div>
            </section>
          </div>

          <p className={styles.infoFootnote}>
            Belum punya reservasi dan ingin datang di hari lain? Buat reservasi dari halaman yang sama.
          </p>

          <Link href="/" className={styles.backLink}>
            <ArrowLeft size={16} aria-hidden="true" />
            Kembali ke halaman utama
          </Link>
        </div>
      </div>
    </div>
  );
}
