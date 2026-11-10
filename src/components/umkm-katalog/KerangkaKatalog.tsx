import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Store, UserRound } from 'lucide-react';
import { todayWIB } from '@/lib/time';
import styles from './kerangka.module.css';

// Kepala dan kaki halaman publik Katalog UMKM. Server component: tanpa data, tanpa status.
export default function KerangkaKatalog({ children }: { children: ReactNode }) {
  return <div className={styles.kerangka}>
    <a href="#isi-katalog" className={styles.lompat}>Langsung ke isi</a>
    <header className={styles.kepala}>
      <div className={styles.kepalaIsi}>
        <Link href="/" className={styles.merek}>
          <Image src="/logo.png" alt="" width={60} height={48} className={styles.logo} priority />
          <span className={styles.merekTeks}>Lampung Maju Hub</span>
        </Link>
        <nav aria-label="Navigasi utama" className={styles.nav}>
          <Link href="/" className={styles.navTautan}>Beranda</Link>
          <Link href="/umkm/katalog" className={`${styles.navTautan} ${styles.navLebar} ${styles.navAktif}`}>
            Katalog UMKM</Link>
          <Link href="/chat" className={`${styles.navTautan} ${styles.navLebar}`}>Live Chat</Link>
          <Link href="/me" className={styles.navAkun}>
            <UserRound size={18} aria-hidden="true" />
            <span>Akun saya</span>
          </Link>
          <Link href="/me/usaha" className={styles.navDaftar}>
            <Store size={18} aria-hidden="true" />
            <span>Daftarkan usaha</span>
          </Link>
        </nav>
      </div>
    </header>
    <div id="isi-katalog" className={styles.utama} tabIndex={-1}>{children}</div>
    <footer className={styles.kaki}>
      <div className={styles.kakiIsi}>
        <div className={styles.kakiMerek}>
          <p className={styles.kakiNama}>Lampung Maju Hub</p>
          <p>Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu Provinsi Lampung.</p>
          <p>Katalog ini memuat profil usaha yang sudah diperiksa petugas. Nomor pemilik usaha
            tidak ditampilkan untuk umum.</p>
        </div>
        <nav aria-label="Tautan kaki halaman" className={styles.kakiNav}>
          <Link href="/">Beranda</Link>
          <Link href="/umkm/katalog">Katalog UMKM</Link>
          <Link href="/me/usaha">Daftarkan usaha</Link>
          <Link href="/chat">Live Chat</Link>
          <Link href="/kebijakan-privasi">Kebijakan privasi</Link>
        </nav>
      </div>
      <p className={styles.hakCipta}>© {todayWIB().slice(0, 4)} Lampung Maju Hub</p>
    </footer>
  </div>;
}
