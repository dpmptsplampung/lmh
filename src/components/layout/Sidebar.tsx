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
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import styles from './Sidebar.module.css';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
  fase?: string;
  roles?: string[]; // 'admin', 'petugas'
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/admin',
    icon: <LayoutDashboard size={20} />,
    fase: 'Fase 1',
    roles: ['admin'],
  },
  {
    label: 'Kunjungan',
    href: '/admin/kunjungan',
    icon: <ClipboardCheck size={20} />,
    fase: 'Fase 1',
    roles: ['admin'],
  },
  {
    label: 'Scan QR',
    href: '/admin/scan',
    icon: <QrCode size={20} />,
    fase: 'Fase 1',
    roles: ['admin'],
  },

  {
    label: 'Antrian',
    href: '/admin/antrian',
    icon: <Users size={20} />,
    fase: 'Fase 2',
    roles: ['admin', 'petugas'],
  },
  {
    label: 'Absensi',
    href: '/admin/absensi',
    icon: <BookOpen size={20} />,
    fase: 'Fase 1',
    roles: ['admin', 'petugas'],
  },
  {
    label: 'Live Chat',
    href: '/admin/chat',
    icon: <MessageSquare size={20} />,
    fase: 'Fase 3',
    roles: ['admin', 'petugas'],
  },
  {
    label: 'Kelola FAQ',
    href: '/admin/chat/faq',
    icon: <HelpCircle size={20} />,
    fase: 'Fase 3',
    roles: ['admin', 'petugas'],
  },
  {
    label: 'UMKM',
    href: '/admin/umkm',
    icon: <Store size={20} />,
    fase: 'Fase 4',
    roles: ['admin'],
  },
  {
    label: 'Investment Gallery',
    href: '/admin/gallery',
    icon: <FileText size={20} />,
    fase: 'Fase 4',
    roles: ['admin'],
  },
  {
    label: 'Lead Investasi',
    href: '/admin/investasi-leads',
    icon: <TrendingUp size={20} />,
    fase: 'Fase 4',
    roles: ['admin'],
  },
  {
    label: 'Pengaturan',
    href: '/admin/settings',
    icon: <Settings size={20} />,
    fase: 'Fase 4',
    roles: ['admin'],
  },
  {
    label: 'Konten Landing',
    href: '/admin/settings/landing',
    icon: <LayoutTemplate size={20} />,
    fase: 'Fase 4',
    roles: ['admin'],
  },
  {
    label: 'Tampilan Publik',
    href: '/',
    icon: <Globe size={20} />,
    fase: 'Fase 1',
    roles: ['admin', 'petugas'],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userRole, setUserRole] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    async function getUserRole() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: petugas, error } = await supabase
          .from('petugas')
          .select('role')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        if (error) {
          setUserRole(null);
          return;
        }
        if (!petugas) {
          setUserRole(null);
          return;
        }
        setUserRole(petugas.role);
      } else {
        setUserRole(null);
      }
    }
    getUserRole();
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
              {isActive(item.href) && (
                <ChevronRight size={16} className={styles.navArrow} />
              )}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className={styles.footer}>
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
