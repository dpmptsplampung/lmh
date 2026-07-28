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
  QrCode,
  Globe,
  HelpCircle,
  Settings,
  LayoutTemplate,
  TrendingUp,
  BarChart3,
  ShieldCheck,
  UserPlus,
  Bot,
  CalendarDays,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { ADMIN_NAV, type AdminNavEntry } from '@/lib/admin-nav';
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
};

const navItems = ADMIN_NAV.map((entry) => ({
  label: entry.label,
  href: entry.href,
  icon: ICONS[entry.iconKey],
  roles: entry.roles as string[],
}));

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userRole, setUserRole] = useState<string | null | undefined>(undefined);
  const [userName, setUserName] = useState<string>('');
  const [eskalasiCount, setEskalasiCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function getUserRole() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: petugas, error } = await supabase
          .from('petugas')
          .select('nama, role, layanan_id')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        if (error || !petugas) {
          setUserRole(null);
          return;
        }
        setUserRole(petugas.role);
        setUserName(petugas.nama ?? '');

        // Badge unread: sesi chat berstatus eskalasi — live via subscription
        const scopeLayananId = petugas.role === 'petugas' ? petugas.layanan_id : null;
        const refreshBadge = async () => {
          let badgeQuery = supabase
            .from('chat_sesi')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'eskalasi');
          if (scopeLayananId) {
            badgeQuery = badgeQuery.eq('layanan_id', scopeLayananId);
          }
          const { count } = await badgeQuery;
          setEskalasiCount(count ?? 0);
        };
        await refreshBadge();

        channel = supabase
          .channel('sidebar-eskalasi-badge')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_sesi' }, () => {
            refreshBadge();
          })
          .subscribe();
      } else {
        setUserRole(null);
      }
    }
    getUserRole();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/admin') return pathname === '/admin';
    if (pathname === href) return true;
    const moreSpecific = navItems.some(
      (item) =>
        item.href !== href &&
        item.href.startsWith(href + '/') &&
        (pathname === item.href || pathname.startsWith(item.href + '/'))
    );
    if (moreSpecific) return false;
    return pathname.startsWith(href + '/');
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <>
      {/* Mobile toggle button */}
      <button
        className={styles.mobileToggle}
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Overlay for mobile */}
      {mobileOpen && (
        <div
          className={styles.overlay}
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={cn(styles.sidebar, mobileOpen && styles.sidebarOpen)}>
        {/* Brand */}
        <div className={styles.brand} style={{ padding: 'var(--space-4) var(--space-5)', justifyContent: 'center' }}>
          <Image 
            src="/logo.png" 
            alt="Lampung Maju Hub Logo" 
            width={180} 
            height={80} 
            style={{ objectFit: 'contain', width: '100%', height: 'auto' }} 
            priority
          />
        </div>

        {/* Navigation */}
        <nav className={styles.nav}>
          {navItems.filter(item => {
            if (userRole === undefined || userRole === null) return false;
            if (!item.roles) return true;
            return item.roles.includes(userRole);
          }).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                styles.navItem,
                isActive(item.href) && styles.navItemActive
              )}
              onClick={() => setMobileOpen(false)}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span className={styles.navLabel}>{item.label}</span>
              {item.href === '/admin/chat' && eskalasiCount > 0 && (
                <span
                  aria-label={`${eskalasiCount} sesi chat eskalasi`}
                  style={{
                    background: 'var(--color-danger-500)',
                    color: 'var(--text-inverse)',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 700,
                    minWidth: '20px',
                    height: '20px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 var(--space-1)',
                  }}
                >
                  {eskalasiCount}
                </span>
              )}
              {isActive(item.href) && (
                <ChevronRight size={16} className={styles.navArrow} />
              )}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className={styles.footer}>
          {userRole && (
            <div style={{ padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-2)' }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                {userName || '—'}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {userRole === 'admin' ? 'Admin' : 'Petugas'}
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
