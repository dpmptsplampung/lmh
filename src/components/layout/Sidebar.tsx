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
  Menu,
  X,
  LogOut,
  ChevronRight,
  ChevronDown,
  QrCode,
  Globe,
  HelpCircle,
  Settings,
  LayoutTemplate,
  TrendingUp,
  BarChart3,
  MessageSquareHeart,
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
  ConciergeBell,
  ListOrdered,
  Headset,
  FileBarChart,
  SlidersHorizontal,
  Handshake,
  FolderOpen,
  Cog,
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
} from '@/lib/admin-nav';
import { totalBadge, useJudulTabBadge, useNavBadges, type NavBadge } from '@/lib/hooks/useNavBadges';
import styles from './Sidebar.module.css';

const ICONS: Record<AdminNavEntry['iconKey'], React.ReactNode> = {
  dashboard: <LayoutDashboard size={20} />,
  kunjungan: <ClipboardCheck size={20} />,
  scan: <QrCode size={20} />,
  antrian: <Users size={20} />,
  absensi: <BookOpen size={20} />,
  chat: <MessageSquare size={20} />,
  faq: <HelpCircle size={20} />,
  umkm: <Store size={20} />,
  gallery: <FileText size={20} />,
  leads: <TrendingUp size={20} />,
  skm: <BarChart3 size={20} />,
  aiLog: <Bot size={20} />,
  governance: <ShieldCheck size={20} />,
  petugas: <UserPlus size={20} />,
  jadwal: <CalendarDays size={20} />,
  settings: <Settings size={20} />,
  landing: <LayoutTemplate size={20} />,
  public: <Globe size={20} />,
  pengaduan: <ShieldAlert size={20} />,
  layar:     <Monitor size={20} />,
  rekap:     <TableProperties size={20} />,
  dokumen:   <ScrollText size={20} />,
  profil:    <UserCircle size={20} />,
  kelolaLayanan: <Layers size={20} />,
  bukuTamu:  <BookUser size={20} />,
  riwayat:   <History size={20} />,
  ai:        <Sparkles size={20} />,
  kotakMasuk: <Inbox size={20} />,
  penanganan: <ClipboardList size={20} />,
  daftarFo:  <ListChecks size={20} />,
  topik:     <Tags size={20} />,
  rekapFo:   <FileSpreadsheet size={20} />,
  performa:  <Gauge size={20} />,
  saran:     <Lightbulb size={20} />,
};

const GROUP_ICONS: Record<AdminNavGroupKey, React.ReactNode> = {
  frontOffice: <ConciergeBell size={20} />,
  antrean: <ListOrdered size={20} />,
  layananOnline: <Headset size={20} />,
  pesanPerilaku: <MessageSquareHeart size={20} />,
  laporan: <FileBarChart size={20} />,
  pengelolaan: <SlidersHorizontal size={20} />,
  kemitraan: <Handshake size={20} />,
  konten: <FolderOpen size={20} />,
  sistem: <Cog size={20} />,
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

export default function Sidebar() {
  const pathname = usePathname();
  // Laci mobile. Pindah halaman (link, Back/Forward) menutupnya: reset saat
  // render (pola resmi React "adjust state on prop change", tanpa effect).
  const [mobileOpen, setMobileOpen] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setMobileOpen(false);
  }

  // Accordion: satu kelompok terbuka. Render awal deterministik (kelompok halaman aktif);
  // sessionStorage dibaca di efek agar tidak ada hydration mismatch.
  const pathGroup = findGroupForPath(pathname);
  const [openGroup, setOpenGroup] = useState<AdminNavGroupKey | null>(pathGroup);
  const [prevGroup, setPrevGroup] = useState<AdminNavGroupKey | null>(pathGroup);
  const [storageReady, setStorageReady] = useState(false);
  if (prevGroup !== pathGroup) {
    // Pindah ke kelompok lain: buka kelompok baru (yang lain tertutup). Kelompok yang
    // sama: state tidak disentuh. Halaman tautan tunggal: kelompok terbuka dibiarkan.
    setPrevGroup(pathGroup);
    if (pathGroup) setOpenGroup(pathGroup);
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
  const toggleGroup = (key: AdminNavGroupKey) =>
    setOpenGroup((cur) => (cur === key ? null : key));

  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [userRole, setUserRole] = useState<string | null | undefined>(undefined);
  const [userName, setUserName] = useState<string>('');
  const [staf, setStaf] = useState<{ id: string | null; layananId: string | null }>({ id: null, layananId: null });

  // Badge notifikasi per menu (satu instance hook) + awalan jumlah di judul tab.
  const badges = useNavBadges(
    userRole ? { role: userRole, petugasId: staf.id, layananId: staf.layananId } : null,
  );
  useJudulTabBadge(totalBadge(badges));

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
      } else {
        setUserRole(null);
      }
    }
    getUserRole();
  }, []);

  // Laci terbuka: kunci scroll halaman, Esc menutup (fokus kembali ke tombol),
  // dan menutup bila layar melebar jadi desktop (>1024px).
  useEffect(() => {
    if (!mobileOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const toggle = toggleRef.current;
    sidebarRef.current?.focus();
    // Konten di belakang laci tak bisa difokus/dibaca (aria-modal setara):
    // semua saudara aside selain tombol & overlay diberi inert.
    const aside = sidebarRef.current;
    const inerted = aside
      ? Array.from(aside.parentElement?.children ?? []).filter(
          (el) => el !== aside && el !== toggle && !el.hasAttribute('data-sidebar-overlay'),
        )
      : [];
    inerted.forEach((el) => el.setAttribute('inert', ''));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        toggle?.focus();
      }
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

  // Tepat satu entri aktif: exact, lalu prefiks terpanjang ('/' dan '/admin' hanya exact).
  const activeHref = findActiveNavEntry(pathname)?.href;
  const isActive = (href: string) => href === activeHref;

  const tree = buildNavTree(userRole);

  const renderLink = (entry: AdminNavEntry, nested = false) => {
    const active = isActive(entry.href);
    const badge = entry.badgeKey ? badges[entry.badgeKey] : undefined;
    return (
      <Link
        key={entry.href}
        href={entry.href}
        className={cn(styles.navItem, nested && styles.navItemNested, active && styles.navItemActive)}
        aria-current={active ? 'page' : undefined}
        onClick={() => setMobileOpen(false)}
      >
        <span className={styles.navIcon}>{ICONS[entry.iconKey]}</span>
        <span className={styles.navLabel}>{entry.label}</span>
        {badge && <NavBadgeView count={badge.count} label={badge.label} />}
        {active && <ChevronRight size={16} className={styles.navArrow} />}
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
    <>
      {/* Mobile toggle button */}
      <button
        ref={toggleRef}
        type="button"
        className={styles.mobileToggle}
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? 'Tutup menu' : 'Buka menu'}
        aria-expanded={mobileOpen}
        aria-controls="admin-sidebar"
      >
        {mobileOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Overlay for mobile */}
      {mobileOpen && (
        <div
          className={styles.overlay}
          data-sidebar-overlay
          aria-hidden="true"
          onClick={() => {
            setMobileOpen(false);
            toggleRef.current?.focus();
          }}
        />
      )}

      <aside
        id="admin-sidebar"
        ref={sidebarRef}
        tabIndex={-1}
        className={cn(styles.sidebar, mobileOpen && styles.sidebarOpen)}
      >
        {/* Brand */}
        <div className={styles.brand}>
          <Image
            src="/logo.png"
            alt="Lampung Maju Hub Logo"
            width={180}
            height={80}
            className={styles.brandLogo}
            style={{ objectFit: 'contain', width: 'auto', height: 'auto' }}
            priority
          />
        </div>

        {/* Navigation */}
        <nav className={styles.nav} aria-label="Menu admin">
          {tree.map((item) => {
            if (item.type === 'link') return renderLink(item.entry);
            const { group, children } = item;
            const open = openGroup === group.key;
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
                  <span className={styles.navIcon}>{GROUP_ICONS[group.iconKey]}</span>
                  <span className={styles.navLabel}>{group.label}</span>
                  {!open && jumlahGrup > 0 && (
                    <NavBadgeView count={jumlahGrup} label={anak.map((b) => b.label).join('; ')} />
                  )}
                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className={cn(styles.groupChevron, open && styles.groupChevronOpen)}
                  />
                </button>
                <ul id={listId} className={styles.groupList} hidden={!open}>
                  {children.map((entry) => (
                    <li key={entry.href}>{renderLink(entry, true)}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={styles.footer}>
          {userRole && (
            <div style={{ padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-2)' }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                {userName || '—'}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {userRole === 'admin' ? 'Admin' : userRole === 'front_office' ? 'Front Office' : 'Petugas'}
              </div>
            </div>
          )}
          <button
            className={cn('btn btn--ghost', styles.logoutBtn)}
            onClick={handleLogout}
          >
            <LogOut size={18} />
            <span>Keluar</span>
          </button>
        </div>
      </aside>
    </>
  );
}
