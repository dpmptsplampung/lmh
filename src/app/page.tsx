'use client';

// Homepage = etalase layanan. Tersusun dari blok berjenis tetap (lib/homepage/blok.ts) yang diatur admin di
// /admin/settings/landing: hero, jalur cepat, status hari ini (antrean), cari & daftar layanan, papan kinerja
// (tercadang), ajakan, footer. Blok mati TIDAK dirender. Kartu layanan terisi otomatis dari Kelola Layanan
// (v_layanan_publik); klik kartu membuka popup dengan alamat /?layanan=<slug>.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, User, MessageSquare, Menu, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { keluarDariSesi } from '@/lib/sesi-staf';
import { WA_NUMBER, WA_DEFAULT_MESSAGE } from '@/lib/constants';
import { getSiteSettings } from '@/lib/site-settings';
import { waLink } from '@/lib/utils';
import EstimasiAntrean from '@/components/EstimasiAntrean';
import DaftarLayanan from '@/components/homepage/DaftarLayanan';
import PopupDariUrl from '@/components/homepage/PopupDariUrl';
import {
  BlokAjakan,
  BlokFooter,
  BlokHero,
  BlokJalurCepat,
  BlokPapanKinerja,
  TautanKebijakan,
  type KontakFooter,
} from '@/components/homepage/BlokLain';
import { blokTampil, gabungkanBlok, type BlokTersusun } from '@/lib/homepage/blok';
import {
  denganBatasWaktu,
  muatBlok,
  muatLayanan,
  muatStatusHariIni,
  type LayananEtalase,
  type StatusHariIni,
} from '@/lib/homepage/data';
import styles from './landing.module.css';
import etalase from '@/components/homepage/Homepage.module.css';

/** Batas tunggu tiap pemuat etalase sebelum memakai bawaan. */
const BATAS_MUAT_MS = 6000;

interface UserInfo {
  nama: string;
  foto_url: string | null;
  role?: string;
}

interface DataEtalase {
  blok: BlokTersusun[];
  layanan: LayananEtalase[];
  status: Map<string, StatusHariIni> | null;
}

export default function LandingPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [data, setData] = useState<DataEtalase | null>(null);
  const [waHref, setWaHref] = useState(() => waLink(WA_NUMBER, WA_DEFAULT_MESSAGE));
  const [contact, setContact] = useState<KontakFooter>({ address: '', hours: '', email: '' });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const dariKartuRef = useRef<string | null>(null);

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
    async function checkUser() {
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { data: petugas } = await supabase
          .from('petugas')
          .select('role')
          .eq('auth_user_id', authUser.id)
          .single();

        setUser({
          nama: authUser.user_metadata?.full_name || 'Pengunjung',
          foto_url: authUser.user_metadata?.avatar_url || null,
          role: petugas?.role || 'pengunjung',
        });
      }
    }

    // Tiap pemuat dibatasi waktu: permintaan yang menggantung (jaringan/DB lambat) jatuh ke bawaan setelah
    // BATAS_MUAT_MS (blok bawaan, daftar layanan kosong, tanpa status) alih-alih membiarkan "Memuat halaman…" selamanya.
    async function muatEtalase() {
      const supabase = createClient();
      const [blok, layanan, status] = await Promise.all([
        denganBatasWaktu(muatBlok(supabase), BATAS_MUAT_MS, gabungkanBlok(null)),
        denganBatasWaktu(muatLayanan(supabase), BATAS_MUAT_MS, { layanan: [] as LayananEtalase[], tingkat: 0 as const }),
        denganBatasWaktu(muatStatusHariIni(supabase), BATAS_MUAT_MS, null),
      ]);
      setData({ blok, layanan: layanan.layanan, status });
    }

    async function fetchSiteSettings() {
      const settings = await getSiteSettings([
        'wa_number',
        'wa_default_message',
        'contact_address',
        'contact_hours',
        'contact_email',
      ]);
      setWaHref(waLink(settings.wa_number, settings.wa_default_message));
      setContact({
        address: settings.contact_address,
        hours: settings.contact_hours,
        email: settings.contact_email,
      });
    }

    checkUser();
    muatEtalase();
    fetchSiteSettings();
  }, []);

  const bukaLayanan = useCallback(
    (slug: string) => {
      dariKartuRef.current = slug;
      router.push(`/?layanan=${encodeURIComponent(slug)}`, { scroll: false });
    },
    [router],
  );

  const handleLogout = async () => {
    const supabase = createClient();
    await keluarDariSesi(supabase);
    setUser(null);
  };

  // Menu "Layanan" hanya berguna bila blok daftar layanan tampil (sebelum data siap dianggap ada).
  const adaBlokLayanan = data ? data.blok.some((b) => b.jenis === 'layanan' && b.aktif) : true;
  const kartu = data ? data.layanan.filter((l) => l.tampilDiHomepage) : [];

  const renderBlok = (b: BlokTersusun) => {
    switch (b.jenis) {
      case 'hero':
        return <BlokHero key={b.jenis} teks={b.teks} waHref={waHref} />;
      case 'jalur_cepat':
        return <BlokJalurCepat key={b.jenis} teks={b.teks} />;
      case 'status_hari_ini':
        return <EstimasiAntrean key={b.jenis} judul={b.teks.title} penjelasan={b.teks.description} />;
      case 'layanan':
        return (
          <DaftarLayanan key={b.jenis} layanan={kartu} status={data?.status ?? null} teks={b.teks} onBuka={bukaLayanan} />
        );
      case 'papan_kinerja':
        return <BlokPapanKinerja key={b.jenis} teks={b.teks} />;
      case 'ajakan':
        return <BlokAjakan key={b.jenis} teks={b.teks} />;
      case 'footer':
        return <BlokFooter key={b.jenis} teks={b.teks} kontak={contact} />;
    }
  };

  return (
    <div className={styles.landing}>
      {/* Navbar */}
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
          <li><Link href="/umkm" className={styles.navLink}>UMKM</Link></li>
          <li><Link href="/gallery" className={styles.navLink}>Investasi</Link></li>
          <li><Link href="/chat" className={styles.navLink}>Live Chat</Link></li>
          <li><Link href="/transparansi" className={styles.navLink}>Transparansi</Link></li>
        </ul>

        <div className={styles.navActions}>
          {user ? (
            <div className={styles.navUserActions}>
              {user.role === 'admin' || user.role === 'petugas' || user.role === 'front_office' ? (
                <Link href="/admin" className="btn btn--primary btn--sm">
                  <User size={16} />
                  Panel Admin
                </Link>
              ) : (
                <Link href="/me" className="btn btn--primary btn--sm">
                  <User size={16} />
                  Dashboard Saya
                </Link>
              )}
              <button className="btn btn--ghost btn--sm" onClick={handleLogout} aria-label="Keluar">
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <Link href="/login" className="btn btn--primary btn--sm">
              <User size={16} />
              Masuk
            </Link>
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
            <li><Link href="/umkm" className={styles.mobileMenuLink}>UMKM</Link></li>
            <li><Link href="/gallery" className={styles.mobileMenuLink}>Investasi</Link></li>
            <li><Link href="/chat" className={styles.mobileMenuLink}>Live Chat</Link></li>
            <li><Link href="/transparansi" className={styles.mobileMenuLink}>Transparansi</Link></li>
            <li>
              {user ? (
                user.role === 'admin' || user.role === 'petugas' || user.role === 'front_office' ? (
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

      {/* Blok homepage: dirender hanya bila data konfigurasi siap (menghindari kilasan blok yang dimatikan admin). */}
      {data === null ? (
        <p className={etalase.memuat} role="status" aria-busy="true">Memuat halaman…</p>
      ) : (
        blokTampil(data.blok).map(renderBlok)
      )}

      {/* Selalu tampil, tidak bergantung pada blok footer. */}
      {data !== null && <TautanKebijakan />}

      {/* Popup layanan (alamat /?layanan=<slug>); Suspense karena useSearchParams. */}
      <Suspense fallback={null}>
        {data && <PopupDariUrl layanan={data.layanan} status={data.status} dariKartuRef={dariKartuRef} />}
      </Suspense>

      {/* Floating Chat Widget */}
      <Link href="/chat" className={styles.floatingChat}>
        <MessageSquare size={18} />
        <span>Live Chat</span>
      </Link>
    </div>
  );
}
