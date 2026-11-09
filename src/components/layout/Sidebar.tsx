'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ClipboardCheck,
  Users,
  MessageSquare,
  Store,
  FileText,
  BookOpen,
  X,
  ChevronDown,
  QrCode,
  Globe,
  HelpCircle,
  Settings,
  LayoutTemplate,
  TrendingUp,
  BarChart3,
  Lightbulb,
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  Bot,
  CalendarDays,
  Monitor,
  TableProperties,
  ScrollText,
  UserCircle,
  Layers,
  BookUser,
  History,
  Sparkles,
  Inbox,
  ClipboardList,
  ListChecks,
  Tags,
  FileSpreadsheet,
  Gauge,
  LogOut,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { keluarDariSesi } from '@/lib/sesi-staf';
import {
  buildNavTree,
  findActiveNavEntry,
  findGroupForPath,
  type AdminNavEntry,
  type AdminNavGroupKey,
  type AdminNavTreeItem,
} from '@/lib/admin-nav';
import { totalBadge, useJudulTabBadge, useNavBadges, type NavBadge } from '@/lib/hooks/useNavBadges';
import AppBar from './AppBar';
import KartuIdentitas from './KartuIdentitas';
import WidgetSidebar from './WidgetSidebar';
import styles from './Sidebar.module.css';
import { PemeriksaContext } from '@/components/admin/umkm-tugas/PemeriksaContext';

const ICONS: Record<AdminNavEntry['iconKey'], React.ReactNode> = {
  dashboard: <LayoutDashboard size={18} strokeWidth={1.75} />,
  kunjungan: <ClipboardCheck size={18} strokeWidth={1.75} />,
  scan: <QrCode size={18} strokeWidth={1.75} />,
  antrian: <Users size={18} strokeWidth={1.75} />,
  absensi: <BookOpen size={18} strokeWidth={1.75} />,
  chat: <MessageSquare size={18} strokeWidth={1.75} />,
  faq: <HelpCircle size={18} strokeWidth={1.75} />,
  umkm: <Store size={18} strokeWidth={1.75} />,
  gallery: <FileText size={18} strokeWidth={1.75} />,
  leads: <TrendingUp size={18} strokeWidth={1.75} />,
  skm: <BarChart3 size={18} strokeWidth={1.75} />,
  aiLog: <Bot size={18} strokeWidth={1.75} />,
  governance: <ShieldCheck size={18} strokeWidth={1.75} />,
  petugas: <UserPlus size={18} strokeWidth={1.75} />,
  jadwal: <CalendarDays size={18} strokeWidth={1.75} />,
  settings: <Settings size={18} strokeWidth={1.75} />,
  landing: <LayoutTemplate size={18} strokeWidth={1.75} />,
  public: <Globe size={18} strokeWidth={1.75} />,
  pengaduan: <ShieldAlert size={18} strokeWidth={1.75} />,
  layar:     <Monitor size={18} strokeWidth={1.75} />,
  rekap:     <TableProperties size={18} strokeWidth={1.75} />,
  dokumen:   <ScrollText size={18} strokeWidth={1.75} />,
  profil:    <UserCircle size={18} strokeWidth={1.75} />,
  kelolaLayanan: <Layers size={18} strokeWidth={1.75} />,
  bukuTamu:  <BookUser size={18} strokeWidth={1.75} />,
  riwayat:   <History size={18} strokeWidth={1.75} />,
  ai:        <Sparkles size={18} strokeWidth={1.75} />,
  kotakMasuk: <Inbox size={18} strokeWidth={1.75} />,
  penanganan: <ClipboardList size={18} strokeWidth={1.75} />,
  daftarFo:  <ListChecks size={18} strokeWidth={1.75} />,
  topik:     <Tags size={18} strokeWidth={1.75} />,
  rekapFo:   <FileSpreadsheet size={18} strokeWidth={1.75} />,
  performa:  <Gauge size={18} strokeWidth={1.75} />,
  saran:     <Lightbulb size={18} strokeWidth={1.75} />,
};


// Kelompok yang terbuka bertahan saat muat ulang (per tab). Bentuk: {open, pathGroup};
// dipulihkan hanya bila kelompok halaman aktif masih sama dengan saat disimpan.
const SIDEBAR_STORAGE_KEY = 'lmh.sidebar.grup';

function readStored(): { open: AdminNavGroupKey | null; pathGroup: AdminNavGroupKey | null } | null {
  try {
    const raw = window.sessionStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { open?: unknown; pathGroup?: unknown };
    const ok = (x: unknown) => x === null || typeof x === 'string';
    if (!v || !ok(v.open) || !ok(v.pathGroup)) return null;
    return { open: v.open as AdminNavGroupKey | null, pathGroup: v.pathGroup as AdminNavGroupKey | null };
  } catch {
    return null;
  }
}

function writeStored(open: AdminNavGroupKey | null, pathGroup: AdminNavGroupKey | null) {
  try {
    window.sessionStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ open, pathGroup }));
  } catch {
    /* storage tidak tersedia: state tetap jalan tanpa persistensi */
  }
}

// Badge angka bundar: disembunyikan bila 0, '99+' bila >99. Angka disembunyikan dari pembaca layar
// (aria-hidden) dan diganti teks jelas yang tersembunyi secara visual.
function NavBadgeView({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <>
      <span className={styles.badge} aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className={styles.srOnly}>{`: ${label}`}</span>
    </>
  );
}

const LABEL_PERAN: Record<string, string> = { admin: 'Admin', front_office: 'Front Office', petugas: 'Petugas' };

export default function Sidebar() {
  const [pemeriksaUmkm, setPemeriksaUmkm] = useState(false);
  const pathname = usePathname();
  // Laci HP/tablet. Pindah halaman (link, Back/Forward) menutupnya: reset saat
  // render (pola resmi React "adjust state on prop change", tanpa effect).
  const [mobileOpen, setMobileOpen] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setMobileOpen(false);
  }

  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [userRole, setUserRole] = useState<string | null | undefined>(undefined);
  const [userName, setUserName] = useState<string>('');
  const [namaLayanan, setNamaLayanan] = useState<string | null>(null);
  const [staf, setStaf] = useState<{ id: string | null; layananId: string | null }>({ id: null, layananId: null });

  // P1: Admin (+-32 menu) memakai akordeon satu kelompok terbuka; Petugas dan Front Office (<=12 menu)
  // membuka semua kelompok bawaannya dan hanya mencatat yang dilipat sendiri.
  const akordeon = userRole === 'admin';

  // Accordion (Admin): satu kelompok terbuka. Render awal deterministik (kelompok halaman aktif);
  // sessionStorage dibaca di efek agar tidak ada hydration mismatch.
  const pathGroup = findGroupForPath(pathname);
  const [openGroup, setOpenGroup] = useState<AdminNavGroupKey | null>(pathGroup);
  const [prevGroup, setPrevGroup] = useState<AdminNavGroupKey | null>(pathGroup);
  const [storageReady, setStorageReady] = useState(false);
  const [dilipat, setDilipat] = useState<ReadonlySet<AdminNavGroupKey>>(() => new Set());
  if (prevGroup !== pathGroup) {
    // Pindah ke kelompok lain: buka kelompok baru (yang lain tertutup). Kelompok yang
    // sama: state tidak disentuh. Halaman tautan tunggal: kelompok terbuka dibiarkan.
    setPrevGroup(pathGroup);
    if (pathGroup) {
      setOpenGroup(pathGroup);
      setDilipat((cur) => {
        if (!cur.has(pathGroup)) return cur;
        const baru = new Set(cur);
        baru.delete(pathGroup);
        return baru;
      });
    }
  }
  useEffect(() => {
    const stored = readStored();
    // Pulihkan hanya bila kelompok halaman aktif sama dengan saat disimpan.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored && stored.pathGroup === pathGroup) setOpenGroup(stored.open);
    setStorageReady(true);
    // Sekali saat mount; perubahan berikutnya ditangani saat render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (storageReady) writeStored(openGroup, pathGroup);
  }, [storageReady, openGroup, pathGroup]);
  const terbuka = (key: AdminNavGroupKey) => (akordeon ? openGroup === key : !dilipat.has(key));
  const toggleGroup = (key: AdminNavGroupKey) => {
    if (akordeon) {
      setOpenGroup((cur) => (cur === key ? null : key));
      return;
    }
    setDilipat((cur) => {
      const baru = new Set(cur);
      if (baru.has(key)) baru.delete(key);
      else baru.add(key);
      return baru;
    });
  };

  // Badge notifikasi per menu (satu instance hook) + awalan jumlah di judul tab.
  const badges = useNavBadges(
    userRole ? { role: userRole, petugasId: staf.id, layananId: staf.layananId } : null,
  );
  const total = totalBadge(badges);
  useJudulTabBadge(total);

  useEffect(() => {
    const supabase = createClient();
    async function getUserRole() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: petugas, error } = await supabase
          .from('petugas')
          .select('id, nama, role, layanan_id')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        if (error || !petugas) {
          setUserRole(null);
          return;
        }
        setUserRole(petugas.role);
        setUserName(petugas.nama ?? '');
        setStaf({ id: petugas.id ?? null, layananId: petugas.layanan_id ?? null });
        // Kolom tambahan tidak boleh menghalangi menu staf sebelum migrasi tersedia.
        try {
          const { data: flag, error: flagError } = await supabase.from('petugas')
            .select('pemeriksa_umkm').eq('auth_user_id', user.id).maybeSingle();
          setPemeriksaUmkm(!flagError && flag?.pemeriksa_umkm === true && petugas.role !== 'front_office');
        } catch { setPemeriksaUmkm(false); }
        // Nama Layanan untuk kartu identitas: kueri terpisah dan tidak fatal (menu tidak boleh hilang karenanya).
        if (petugas.layanan_id) {
          try {
            const { data: lay } = await supabase.from('layanan').select('nama').eq('id', petugas.layanan_id).maybeSingle();
            setNamaLayanan((lay as { nama?: string } | null)?.nama ?? null);
          } catch {
            /* tanpa nama Layanan */
          }
        }
      } else {
        setUserRole(null);
      }
    }
    getUserRole();
  }, []);

  // Laci terbuka: kunci scroll halaman, Esc menutup, dan menutup bila layar melebar jadi desktop (>1024px).
  // Konten di belakang laci (termasuk AppBar) diberi inert: tak bisa difokus/dibaca (aria-modal setara).
  useEffect(() => {
    if (!mobileOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const aside = sidebarRef.current;
    aside?.focus();
    const inerted = aside
      ? Array.from(aside.parentElement?.children ?? []).filter(
          (el) => el !== aside && !el.hasAttribute('data-sidebar-overlay'),
        )
      : [];
    inerted.forEach((el) => el.setAttribute('inert', ''));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    const mq = window.matchMedia('(min-width: 1025px)');
    const onMq = () => { if (mq.matches) setMobileOpen(false); };
    document.addEventListener('keydown', onKey);
    mq.addEventListener('change', onMq);
    return () => {
      document.body.style.overflow = prevOverflow;
      inerted.forEach((el) => el.removeAttribute('inert'));
      document.removeEventListener('keydown', onKey);
      mq.removeEventListener('change', onMq);
    };
  }, [mobileOpen]);

  // Fokus kembali ke tombol menu sesudah laci tertutup (efek ini jalan setelah cleanup di atas melepas inert).
  const pernahBuka = useRef(false);
  useEffect(() => {
    if (mobileOpen) {
      pernahBuka.current = true;
    } else if (pernahBuka.current) {
      pernahBuka.current = false;
      toggleRef.current?.focus();
    }
  }, [mobileOpen]);

  // Tepat satu entri aktif: exact, lalu prefiks terpanjang ('/' dan '/admin' hanya exact).
  const aktif = findActiveNavEntry(pathname);
  const activeHref = aktif?.href;
  const isActive = (href: string) => href === activeHref;

  const tree = buildNavTree(userRole, { pemeriksa_umkm: pemeriksaUmkm });
  const bawah = tree.filter((t): t is Extract<AdminNavTreeItem, { type: 'link' }> => t.type === 'link' && t.entry.slot === 'bawah');
  const utama = tree.filter((t) => !(t.type === 'link' && t.entry.slot === 'bawah'));

  const tutupLaci = () => setMobileOpen(false);

  const renderLink = (entry: AdminNavEntry) => {
    const active = isActive(entry.href);
    const badge = entry.badgeKey ? badges[entry.badgeKey] : undefined;
    return (
      <Link
        key={entry.href}
        href={entry.href}
        className={cn(styles.navItem, active && styles.navItemActive)}
        aria-current={active ? 'page' : undefined}
        onClick={tutupLaci}
      >
        <span className={styles.navIcon}>{ICONS[entry.iconKey]}</span>
        <span className={styles.navLabel}>{entry.label}</span>
        {badge && <NavBadgeView count={badge.count} label={badge.label} />}
      </Link>
    );
  };

  const handleLogout = async () => {
    const supabase = createClient();
    // akhiri_sesi dulu (kegagalannya tidak menghalangi signOut), lalu keluar dari sesi ini saja.
    await keluarDariSesi(supabase);
    // Navigasi keras disengaja setelah keluar: reload penuh membersihkan seluruh state klien.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login';
  };

  return (
    <PemeriksaContext.Provider value={pemeriksaUmkm}>
      <AppBar
        role={userRole}
        judul={aktif?.label ?? 'Admin'}
        total={total}
        laciTerbuka={mobileOpen}
        onToggleLaci={() => setMobileOpen((o) => !o)}
        toggleRef={toggleRef}
      />

      {/* Latar redup laci (HP/tablet) */}
      {mobileOpen && (
        <div
          className={styles.overlay}
          data-sidebar-overlay
          data-cetak="sembunyi"
          aria-hidden="true"
          onClick={tutupLaci}
        />
      )}

      <aside
        id="sidebar"
        ref={sidebarRef}
        tabIndex={-1}
        className={cn(styles.sidebar, mobileOpen && styles.sidebarOpen)}
        {...(mobileOpen ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Navigasi utama' } : {})}
      >
        {/* Merek */}
        <div className={styles.brand}>
          <Image src="/logo.png" alt="" width={334} height={267} className={styles.brandLogo} priority />
          <span className={styles.brandName}>Lampung Maju Hub</span>
          {mobileOpen && (
            <button type="button" className={styles.tutup} aria-label="Tutup menu" onClick={tutupLaci}>
              <X size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>

        {userRole && (
          <KartuIdentitas
            nama={userName}
            peran={LABEL_PERAN[userRole] ?? 'Petugas'}
            layanan={userRole === 'petugas' ? namaLayanan : null}
            onKeluar={handleLogout}
            onNavigasi={tutupLaci}
          />
        )}

        {/* <=1024px: seluruh isi di bawah ini satu area gulir, sehingga widget ikut menggulir setelah menu terakhir. */}
        <div className={styles.isi}>
          <nav className={styles.nav} aria-label="Menu admin">
            {utama.map((item) => {
              if (item.type === 'link') return renderLink(item.entry);
              const { group, children } = item;
              const open = terbuka(group.key);
              const listId = `sidebar-grup-${group.key}`;
              const containsActive = children.some((c) => isActive(c.href));
              // Grup tertutup: jumlah total badge anak tetap terlihat; terbuka: badge ada di tiap anak.
              const anak = children
                .map((c) => (c.badgeKey ? badges[c.badgeKey] : undefined))
                .filter((b): b is NavBadge => !!b && b.count > 0);
              const jumlahGrup = anak.reduce((n, b) => n + b.count, 0);
              return (
                <div key={group.key} className={styles.group}>
                  <button
                    type="button"
                    className={cn(styles.groupHeader, containsActive && styles.groupHeaderActive)}
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() => toggleGroup(group.key)}
                  >
                    <span className={styles.navLabel}>{group.label}</span>
                    {!open && jumlahGrup > 0 && (
                      <NavBadgeView count={jumlahGrup} label={anak.map((b) => b.label).join('; ')} />
                    )}
                    <ChevronDown
                      size={14}
                      strokeWidth={1.75}
                      aria-hidden="true"
                      className={cn(styles.groupChevron, open && styles.groupChevronOpen)}
                    />
                  </button>
                  <ul id={listId} className={styles.groupList} hidden={!open}>
                    {children.map((entry) => (
                      <li key={entry.href}>{renderLink(entry)}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>

          {userRole && (
            <WidgetSidebar
              role={userRole}
              petugasId={staf.id}
              layanan={namaLayanan}
              badges={badges}
              onNavigasi={tutupLaci}
            />
          )}

          <div className={styles.bawah}>
            {bawah.map((item) => renderLink(item.entry))}
            {/* Keluar tetap terlihat langsung (tombol esensial); menu kartu identitas menyediakan jalur kedua. */}
            <button type="button" className={cn(styles.navItem, styles.keluarBtn)} onClick={handleLogout}>
              <span className={styles.navIcon}><LogOut size={18} aria-hidden="true" /></span>
              <span className={styles.navLabel}>Keluar</span>
            </button>
          </div>
        </div>
      </aside>
    </PemeriksaContext.Provider>
  );
}
