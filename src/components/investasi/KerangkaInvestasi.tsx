import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { UserRound } from 'lucide-react';
import { todayWIB } from '@/lib/time';
import styles from './kerangka.module.css';

/** Kepala dan kaki halaman publik investasi. Server Component: tanpa data dan tanpa status. */
export default function KerangkaInvestasi({ aktif, children }: { aktif: 'hub' | 'detail'; children: ReactNode }) {
  return (
    <div className={styles.kerangka}>
      <a href="#isi-investasi" className={styles.lompat}>Langsung ke isi</a>
      <header className={styles.kepala}>
        <div className={styles.kepalaIsi}>
          <Link href="/" className={styles.merek} aria-label="Lampung Maju Hub, ke beranda">
            <Image src="/logo.png" alt="" width={60} height={48} className={styles.logo} priority />
            <span className={styles.merekTeks} aria-hidden="true">Lampung Maju Hub</span>
          </Link>
          <nav aria-label="Navigasi utama" className={styles.nav}>
            <Link href="/" className={styles.navTautan}>Beranda</Link>
            <Link href="/investasi" className={`${styles.navTautan} ${styles.navAktif}`}
              aria-current={aktif === 'hub' ? 'page' : undefined}>Investasi</Link>
            <Link href="/gallery" className={`${styles.navTautan} ${styles.navLebar}`}>Dokumen</Link>
            <Link href="/chat" className={`${styles.navTautan} ${styles.navLebar}`}>Live Chat</Link>
            <Link href="/me" className={styles.navAkun}>
              <UserRound size={18} aria-hidden="true" />
              <span className={styles.navAkunTeks}>Akun saya</span>
            </Link>
          </nav>
        </div>
      </header>
      <div id="isi-investasi" className={styles.utama} tabIndex={-1}>{children}</div>
      <footer className={styles.kaki}>
        <div className={styles.kakiIsi}>
          <div className={styles.kakiMerek}>
            <p className={styles.kakiNama}>Investment Gallery Lampung</p>
            <p>Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu Provinsi Lampung.</p>
            <p>Calon investor menghubungi lembaga lewat tombol &quot;Hubungi petugas&quot; pada halaman proyek.
              Kontak pribadi petugas tidak ditampilkan.</p>
          </div>
          <nav aria-label="Tautan kaki halaman" className={styles.kakiNav}>
            <Link href="/">Beranda</Link>
            <Link href="/investasi">Peluang investasi</Link>
            <Link href="/gallery">Dokumen investasi</Link>
            <Link href="/kebijakan-privasi">Kebijakan privasi</Link>
          </nav>
        </div>
        <p className={styles.hakCipta}>© {todayWIB().slice(0, 4)} Lampung Maju Hub</p>
      </footer>
    </div>
  );
}
