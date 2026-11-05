'use client';

// Cangkang /me/*: sidebar varian pengunjung (4 menu, laci di HP) + bilah atas + widget "Kunjungan saya".
// Sumber menu = PENGUNJUNG_NAV (bukan admin-nav). Bilah atas dan gaya sidebar memakai ulang komponen/CSS staf
// tanpa mengubahnya; perilaku laci sama dengan Sidebar staf (fokus, Esc, inert, kunci gulir, tutup saat pindah rute).
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Bell, CalendarPlus, Globe, LayoutDashboard, LogOut, MessageSquare, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { keluarDariSesi } from '@/lib/sesi-staf';
import { cn } from '@/lib/utils';
import {
  cariEntriPengunjungAktif,
  PENGUNJUNG_NAV,
  type PengunjungIconKey,
  type PengunjungNavEntry,
} from '@/lib/pengunjung-nav';
import AppBar from '@/components/layout/AppBar';
import { inisialDari } from '@/components/layout/KartuIdentitas';
import styles from '@/components/layout/Sidebar.module.css';
import WidgetKunjunganSaya from './WidgetKunjunganSaya';
import { useDataPengunjung } from './useDataPengunjung';
import lokal from './cangkang.module.css';

const IKON: Record<PengunjungIconKey, React.ReactNode> = {
  beranda: <LayoutDashboard size={18} strokeWidth={1.75} />,
  reservasi: <CalendarPlus size={18} strokeWidth={1.75} />,
  notifikasi: <Bell size={18} strokeWidth={1.75} />,
  chat: <MessageSquare size={18} strokeWidth={1.75} />,
  situs: <Globe size={18} strokeWidth={1.75} />,
};

export default function CangkangPengunjung({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [laciBuka, setLaciBuka] = useState(false);
  const [pathLama, setPathLama] = useState(pathname);
  if (pathLama !== pathname) {
    setPathLama(pathname);
    setLaciBuka(false);
  }

  const toggleRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const data = useDataPengunjung();
  const { tandaiNotifikasiDilihat } = data;

  const aktif = cariEntriPengunjungAktif(pathname);

  // Halaman Notifikasi terbuka = semuanya dianggap sudah dilihat.
  useEffect(() => {
    if (pathname === '/me/notifications') tandaiNotifikasiDilihat();
  }, [pathname, tandaiNotifikasiDilihat]);

  // Laci terbuka: kunci gulir, fokus ke laci, Esc menutup, tutup bila layar melebar, konten lain inert.
  useEffect(() => {
    if (!laciBuka) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const aside = asideRef.current;
    aside?.focus();
    const diinert = aside
      ? Array.from(aside.parentElement?.children ?? []).filter(
          (el) => el !== aside && !el.hasAttribute('data-sidebar-overlay'),
        )
      : [];
    diinert.forEach((el) => el.setAttribute('inert', ''));
    const saatKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLaciBuka(false);
    };
    const mq = window.matchMedia('(min-width: 1025px)');
    const saatMq = () => {
      if (mq.matches) setLaciBuka(false);
    };
    document.addEventListener('keydown', saatKey);
    mq.addEventListener('change', saatMq);
    return () => {
      document.body.style.overflow = prev;
      diinert.forEach((el) => el.removeAttribute('inert'));
      document.removeEventListener('keydown', saatKey);
      mq.removeEventListener('change', saatMq);
    };
  }, [laciBuka]);

  // Fokus kembali ke tombol menu sesudah laci tertutup.
  const pernahBuka = useRef(false);
  useEffect(() => {
    if (laciBuka) pernahBuka.current = true;
    else if (pernahBuka.current) {
      pernahBuka.current = false;
      toggleRef.current?.focus();
    }
  }, [laciBuka]);

  const tutupLaci = () => setLaciBuka(false);

  const keluar = async () => {
    const supabase = createClient();
    // Sama seperti sebelumnya: akhiri sesi dulu (gagal tidak menghalangi), lalu keluar dari sesi ini saja.
    await keluarDariSesi(supabase);
    // Navigasi keras disengaja setelah keluar: reload penuh membersihkan seluruh state klien.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login';
  };

  const utama = PENGUNJUNG_NAV.filter((e) => e.slot !== 'bawah');
  const bawah = PENGUNJUNG_NAV.filter((e) => e.slot === 'bawah');

  const tautan = (e: PengunjungNavEntry) => {
    const sedangAktif = aktif?.href === e.href;
    const jumlah = e.badgeKey === 'notifikasi' ? data.belumDilihat : 0;
    return (
      <Link
        key={e.href}
        href={e.href}
        className={cn(styles.navItem, sedangAktif && styles.navItemActive)}
        aria-current={sedangAktif ? 'page' : undefined}
        onClick={tutupLaci}
      >
        <span className={styles.navIcon}>{IKON[e.iconKey]}</span>
        <span className={styles.navLabel}>{e.label}</span>
        {jumlah > 0 && (
          <>
            <span className={styles.badge} aria-hidden="true">{jumlah > 99 ? '99+' : jumlah}</span>
            <span className={styles.srOnly}>{`: ${jumlah} notifikasi belum dilihat`}</span>
          </>
        )}
      </Link>
    );
  };

  return (
    <div className={lokal.cangkang} data-tema="dasbor">
      <AppBar
        role={null}
        judul={aktif?.label ?? 'Dasbor saya'}
        total={data.belumDilihat}
        laciTerbuka={laciBuka}
        onToggleLaci={() => setLaciBuka((o) => !o)}
        toggleRef={toggleRef}
      />

      {laciBuka && (
        <div className={styles.overlay} data-sidebar-overlay data-cetak="sembunyi" aria-hidden="true" onClick={tutupLaci} />
      )}

      <aside
        id="sidebar"
        ref={asideRef}
        tabIndex={-1}
        className={cn(styles.sidebar, laciBuka && styles.sidebarOpen)}
        {...(laciBuka ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Navigasi utama' } : {})}
      >
        <div className={styles.brand}>
          <Image src="/logo.png" alt="" width={334} height={267} className={styles.brandLogo} priority />
          <span className={styles.brandName}>Lampung Maju Hub</span>
          {laciBuka && (
            <button type="button" className={styles.tutup} aria-label="Tutup menu" onClick={tutupLaci}>
              <X size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>

        {data.siap && (
          <div className={lokal.identitas}>
            <span className={lokal.avatar} aria-hidden="true">{inisialDari(data.nama || data.email)}</span>
            <span className={lokal.teks}>
              <span className={lokal.nama} title={data.nama || undefined}>{data.nama || 'Pengunjung'}</span>{' '}
              <span className={lokal.peran} title={data.email || 'Pengunjung'}>{data.email || 'Pengunjung'}</span>
            </span>
          </div>
        )}

        <div className={styles.isi}>
          <nav className={styles.nav} aria-label="Menu pengunjung">
            {utama.map(tautan)}
          </nav>

          <WidgetKunjunganSaya kunjungan={data.kunjungan} onNavigasi={tutupLaci} />

          <div className={styles.bawah}>
            {bawah.map(tautan)}
            <button type="button" className={cn(styles.navItem, styles.keluarBtn)} onClick={keluar}>
              <span className={styles.navIcon}><LogOut size={18} aria-hidden="true" /></span>
              <span className={styles.navLabel}>Keluar</span>
            </button>
          </div>
        </div>
      </aside>

      <div className={lokal.isi}>
        <div className={lokal.badan}>{children}</div>
      </div>
    </div>
  );
}
