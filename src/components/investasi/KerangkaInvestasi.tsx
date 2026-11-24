import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { UserRound } from 'lucide-react';
import { todayWIB } from '@/lib/time';
import styles from './kerangka.module.css';

/** Kepala dan kaki halaman publik investasi. Server Component: tanpa data dan tanpa status. */
export type HalamanAktif = 'hub' | 'detail' | 'dokumen';

/**
 * `<main id="main-content">` dipasang satu kali oleh root layout, jadi kerangka ini tidak menambah landmark `main`:
 * isi memakai `div` bertarget lompat sendiri. Tautan lompat bawaan root disembunyikan (kerangka.module.css) karena
 * targetnya membungkus kepala ini; "Langsung ke isi" di bawah adalah satu-satunya yang benar-benar melewati navigasi.
 */
export default function KerangkaInvestasi({ aktif, children }: { aktif: HalamanAktif; children: ReactNode }) {
  return (
    <div className={styles.kerangka}>
      <a href="#isi-investasi" className={styles.lompat}>Langsung ke isi</a>
      <header className={styles.kepala}>
        <div className={styles.kepalaIsi}>
          <Link href="/" className={styles.merek} aria-label="Lampung Maju Hub, ke beranda">
            <Image src="/logo.png" alt="" width={60} height={48} className={styles.logo} />
            <span className={styles.merekTeks} aria-hidden="true">Lampung Maju Hub</span>
          </Link>
          <nav aria-label="Navigasi utama" className={styles.nav}>
            <Link href="/" className={`${styles.navTautan} ${styles.navBeranda}`}>Beranda</Link>
            <Link href="/investasi" className={`${styles.navTautan} ${aktif !== 'dokumen' ? styles.navAktif : ''}`}
              aria-current={aktif === 'hub' ? 'page' : undefined}>Investasi</Link>
            <Link href="/gallery" className={`${styles.navTautan} ${aktif === 'dokumen' ? styles.navAktif : ''}`}
              aria-current={aktif === 'dokumen' ? 'page' : undefined}>Investment Gallery</Link>
            <Link href="/chat" className={`${styles.navTautan} ${styles.navLiveChat}`}>Live Chat</Link>
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
            <p className={styles.kakiNama}>Investment Gallery</p>
            <p>Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu Provinsi Lampung.</p>
            <p>Calon investor menghubungi lembaga lewat tombol &quot;Hubungi petugas&quot; pada halaman proyek.
              Kontak pribadi petugas tidak ditampilkan.</p>
          </div>
          <nav aria-label="Tautan kaki halaman" className={styles.kakiNav}>
            <Link href="/">Beranda</Link>
            <Link href="/investasi">Peluang investasi</Link>
            <Link href="/gallery">Investment Gallery</Link>
            <Link href="/kebijakan-privasi">Kebijakan privasi</Link>
          </nav>
        </div>
        <p className={styles.hakCipta}>© {todayWIB().slice(0, 4)} Lampung Maju Hub</p>
      </footer>
    </div>
  );
}
