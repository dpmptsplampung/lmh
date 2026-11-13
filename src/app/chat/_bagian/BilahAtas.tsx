// Bilah atas /chat (gaya Dasbor, tanpa sidebar): logo ke beranda situs, judul, dan tautan keluar chat. Tanpa props.
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, LayoutDashboard } from 'lucide-react';
import styles from '../chat.module.css';

export default function BilahAtas() {
  return (
    <header className={styles.chatHeader}>
      <Link href="/" className={styles.brand}>
        <Image
          src="/logo.png"
          alt="Lampung Maju Hub Logo"
          width={120}
          height={50}
          className={styles.brandLogo}
          priority
        />
      </Link>
      <h1 className={styles.judulBar}>Live Chat</h1>
      <nav className={styles.aksiBar} aria-label="Navigasi chat">
        <Link href="/me" className={styles.tautanBar}>
          <LayoutDashboard size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.teksTautan}>Beranda saya</span>
        </Link>
        <Link href="/" className={styles.backBtn}>
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className={styles.teksTautan}>Kembali ke Web</span>
        </Link>
      </nav>
    </header>
  );
}
