'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  ClipboardCheck,
  MessageCircle,
  Store,
  FileText,
  HeartHandshake,
  Sparkles,
  ArrowRight,
  Shield,
  LogOut,
  User,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { APP_NAME, WA_NUMBER, WA_DEFAULT_MESSAGE } from '@/lib/constants';
import { waLink } from '@/lib/utils';
import styles from './landing.module.css';

const services = [
  {
    icon: <ClipboardCheck size={28} />,
    title: 'Helpdesk OSS',
    description: 'Konsultasi perizinan usaha melalui Online Single Submission. Petugas siap membantu proses NIB dan izin berusaha Anda.',
    color: 'serviceIconPrimary',
  },
  {
    icon: <Shield size={28} />,
    title: 'Sertifikasi Halal',
    description: 'Pendampingan proses sertifikasi halal untuk produk UMKM. Konsultasi gratis langsung dengan petugas terlatih.',
    color: 'serviceIconSuccess',
  },
  {
    icon: <HeartHandshake size={28} />,
    title: 'CS BPJS Kesehatan',
    description: 'Layanan informasi dan bantuan terkait BPJS Kesehatan. Tersedia konsultasi tatap muka dan online.',
    color: 'serviceIconAccent',
  },
  {
    icon: <Store size={28} />,
    title: 'Matchmaking UMKM',
    description: 'Platform penghubung kebutuhan UMKM — dari bahan baku hingga kemitraan bisnis. Terbuka untuk seluruh Indonesia.',
    color: 'serviceIconPrimary',
  },
  {
    icon: <FileText size={28} />,
    title: 'Investment Gallery',
    description: 'Pameran potensi investasi Provinsi Lampung. Dokumen profil investasi tersedia untuk dilihat secara daring.',
    color: 'serviceIconAccent',
  },
];

interface UserInfo {
  nama: string;
  foto_url: string | null;
  role?: string;
}

export default function LandingPage() {
  const [user, setUser] = useState<UserInfo | null>(null);

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
    checkUser();
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <div className={styles.landing}>
      {/* Navbar */}
      <nav className={styles.navbar}>
        <Link href="/" className={styles.navBrand}>
          <div className={styles.navBrandIcon}>
            <Building2 size={20} />
          </div>
          <span className={styles.navBrandText}>{APP_NAME}</span>
        </Link>

        <ul className={styles.navLinks}>
          <li><a href="#layanan" className={styles.navLink}>Layanan</a></li>
          <li><Link href="/umkm" className={styles.navLink}>UMKM</Link></li>
          <li><Link href="/gallery" className={styles.navLink}>Investasi</Link></li>
        </ul>

        <div className={styles.navActions}>
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              {user.role === 'admin' || user.role === 'petugas' ? (
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
              <button className="btn btn--ghost btn--sm" onClick={handleLogout}>
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <Link href="/login" className="btn btn--primary btn--sm">
              <User size={16} />
              Masuk
            </Link>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <Sparkles size={14} />
            DPMPTSP Provinsi Lampung
          </div>
          <h1 className={styles.heroTitle}>
            Pelayanan Terpadu{' '}
            <span className={styles.heroTitleAccent}>Satu Pintu</span>{' '}
            untuk Lampung Maju
          </h1>
          <p className={styles.heroDescription}>
            Hub digital yang menyatukan layanan perizinan, sertifikasi halal,
            BPJS Kesehatan, matchmaking UMKM, dan galeri investasi
            dalam satu platform terintegrasi.
          </p>
          <div className={styles.heroActions}>
            <Link href="/me/reservasi" className="btn btn--primary btn--lg">
              <ClipboardCheck size={20} />
              Rencanakan Kedatangan
            </Link>
            <a
              href={waLink(WA_NUMBER, WA_DEFAULT_MESSAGE)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--secondary btn--lg"
            >
              <MessageCircle size={20} />
              Chat via WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="layanan" className={styles.services}>
        <div className={styles.sectionHeader}>
          <p className={styles.sectionLabel}>Layanan Kami</p>
          <h2 className={styles.sectionTitle}>5 Layanan dalam Satu Atap</h2>
          <p className={styles.sectionDescription}>
            Layanan konsultatif tatap muka dan platform digital yang bisa diakses
            dari mana saja, kapan saja.
          </p>
        </div>

        <div className={styles.serviceGrid}>
          {services.map((service) => (
            <div key={service.title} className={styles.serviceCard}>
              <div className={`${styles.serviceIcon} ${styles[service.color]}`}>
                {service.icon}
              </div>
              <h3 className={styles.serviceTitle}>{service.title}</h3>
              <p className={styles.serviceDescription}>{service.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className={styles.cta}>
        <div className={styles.ctaContent}>
          <h2 className={styles.ctaTitle}>Siap Berkunjung?</h2>
          <p className={styles.ctaDescription}>
            Booking kedatangan online terlebih dahulu untuk mempercepat pelayanan Anda
            di kantor DPMPTSP Provinsi Lampung.
          </p>
          <Link href="/me/reservasi" className="btn btn--accent btn--lg">
            Rencanakan Kedatangan
            <ArrowRight size={20} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <p>© {new Date().getFullYear()} {APP_NAME} — DPMPTSP Provinsi Lampung. Hak cipta dilindungi.</p>
      </footer>
    </div>
  );
}
