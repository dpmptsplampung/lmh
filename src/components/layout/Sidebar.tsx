'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
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
} from 'lucide-react';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { APP_NAME } from '@/lib/constants';
import { cn } from '@/lib/utils';
import styles from './Sidebar.module.css';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
  fase?: string;
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/admin',
    icon: <LayoutDashboard size={20} />,
    fase: 'Fase 1',
  },
  {
    label: 'Kunjungan',
    href: '/admin/kunjungan',
    icon: <ClipboardCheck size={20} />,
    fase: 'Fase 1',
  },
  {
    label: 'Scan QR',
    href: '/admin/scan',
    icon: <QrCode size={20} />,
    fase: 'Fase 1',
  },
  {
    label: 'Antrian Helpdesk',
    href: '/admin/antrian',
    icon: <Users size={20} />,
    fase: 'Fase 2',
  },
  {
    label: 'Absensi Mitra',
    href: '/admin/absensi',
    icon: <BookOpen size={20} />,
    fase: 'Fase 1',
  },
  {
    label: 'Live Chat Staf',
    href: '/admin/chat',
    icon: <MessageSquare size={20} />,
    fase: 'Fase 3',
  },
  {
    label: 'Kelola FAQ Bot',
    href: '/admin/chat/faq',
    icon: <HelpCircle size={20} />,
    fase: 'Fase 3',
  },
  {
    label: 'UMKM',
    href: '/admin/umkm',
    icon: <Store size={20} />,
    fase: 'Fase 4',
  },
  {
    label: 'Investment Gallery',
    href: '/admin/gallery',
    icon: <FileText size={20} />,
    fase: 'Fase 4',
  },
  {
    label: 'Tampilan Publik',
    href: '/',
    icon: <Globe size={20} />,
    fase: 'Fase 1',
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
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
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <Building2 size={24} />
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>{APP_NAME}</span>
            <span className={styles.brandSub}>Panel Admin</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className={styles.nav}>
          {navItems.map((item) => (
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
