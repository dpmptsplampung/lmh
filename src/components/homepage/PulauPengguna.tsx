'use client';

// Pulau klien bilah navigasi beranda. Beranda `/` adalah Server Component ber-cache yang sama untuk semua
// pengunjung, jadi semua yang bergantung pada pengguna/peramban hidup di sini:
//  - sesi: getUser + peran (tombol Panel Admin / Dashboard Saya / Keluar). Keluaran server SELALU keadaan
//    "belum masuk" (tombol Masuk); data pengguna baru muncul setelah hidrasi, tidak pernah ada di HTML server.
//  - keadaan menu seluler (buka/tutup, Escape, tutup saat pindah halaman).
// Pulau ini memegang seluruh <nav> dan panel menu seluler karena keduanya berbagi dua keadaan di atas dan panel
// harus menjadi saudara <nav> (CSS sticky). Hanya `adaBlokLayanan` (boolean) yang datang dari server.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { LogOut, Menu, User, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { keluarDariSesi } from '@/lib/sesi-staf';
import Tombol from '@/components/ui/Tombol';
import styles from '@/app/landing.module.css';

interface UserInfo {
  nama: string;
  foto_url: string | null;
  role?: string;
}

const ROLE_STAF = ['admin', 'petugas', 'front_office'];
const adalahStaf = (role?: string) => role !== undefined && ROLE_STAF.includes(role);

interface Props {
  /** Menu "Layanan" hanya berguna bila blok daftar layanan tampil. */
  adaBlokLayanan: boolean;
}

export default function PulauPengguna({ adaBlokLayanan }: Props) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => {
    let batal = false;
    async function checkUser() {
      try {
        const supabase = createClient();
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser || batal) return;
        const { data: petugas } = await supabase
          .from('petugas')
          .select('role')
          .eq('auth_user_id', authUser.id)
          .single();
        if (batal) return;
        setUser({
          nama: authUser.user_metadata?.full_name || 'Pengunjung',
          foto_url: authUser.user_metadata?.avatar_url || null,
          role: petugas?.role || 'pengunjung',
        });
      } catch {
        // Sesi tidak terbaca: tetap tampil sebagai belum masuk (sama seperti sebelum hidrasi).
      }
    }
    void checkUser();
    return () => {
      batal = true;
    };
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await keluarDariSesi(supabase);
    setUser(null);
  };

  return (
    <>
      <nav className={styles.navbar}>
        <Link href="/" className={styles.navBrand} style={{ display: 'flex', alignItems: 'center' }}>
          <Image
            src="/logo.png"
            alt="Lampung Maju Hub Logo"
            width={120}
            height={50}
            style={{ objectFit: 'contain' }}
            priority
          />
        </Link>

        <ul className={styles.navLinks}>
          {adaBlokLayanan && <li><a href="#layanan" className={styles.navLink}>Layanan</a></li>}
          <li><Link href="/umkm/katalog" className={styles.navLink}>UMKM</Link></li>
          <li><Link href="/gallery" className={styles.navLink}>Investasi</Link></li>
          <li><Link href="/chat" className={styles.navLink}>Live Chat</Link></li>
          <li><Link href="/transparansi" className={styles.navLink}>Transparansi</Link></li>
        </ul>

        <div className={styles.navActions}>
          {user ? (
            <div className={styles.navUserActions}>
              {adalahStaf(user.role) ? (
                <Tombol href="/admin" ukuran="kecil" ikon={User} className={styles.navTombolIkon}>
                  Panel Admin
                </Tombol>
              ) : (
                <Tombol href="/me" ukuran="kecil" ikon={User} className={styles.navTombolIkon}>
                  Dashboard Saya
                </Tombol>
              )}
              <Tombol varian="hantu" ukuran="kecil" ikon={LogOut} onClick={handleLogout} aria-label="Keluar">
                <span className="sr-only">Keluar</span>
              </Tombol>
            </div>
          ) : (
            <Tombol href="/login" ukuran="kecil" ikon={User} className={styles.navTombolIkon}>
              Masuk
            </Tombol>
          )}
          <button
            ref={menuButtonRef}
            type="button"
            className={styles.menuToggle}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-menu"
            aria-label={mobileMenuOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi'}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </nav>

      {mobileMenuOpen && (
        <div id="mobile-nav-menu" className={styles.mobileMenu}>
          <ul className={styles.mobileMenuList}>
            {adaBlokLayanan && (
              <li><a href="#layanan" className={styles.mobileMenuLink} onClick={() => setMobileMenuOpen(false)}>Layanan</a></li>
            )}
            <li><Link href="/umkm/katalog" className={styles.mobileMenuLink}>UMKM</Link></li>
            <li><Link href="/gallery" className={styles.mobileMenuLink}>Investasi</Link></li>
            <li><Link href="/chat" className={styles.mobileMenuLink}>Live Chat</Link></li>
            <li><Link href="/transparansi" className={styles.mobileMenuLink}>Transparansi</Link></li>
            <li>
              {user ? (
                adalahStaf(user.role) ? (
                  <Link href="/admin" className={styles.mobileMenuLink}>Panel Admin</Link>
                ) : (
                  <Link href="/me" className={styles.mobileMenuLink}>Dashboard Saya</Link>
                )
              ) : (
                <Link href="/login" className={styles.mobileMenuLink}>Masuk</Link>
              )}
            </li>
          </ul>
        </div>
      )}
    </>
  );
}
