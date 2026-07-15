'use client';

import { useEffect, useState } from 'react';
import type { ElementType } from 'react';
import Link from 'next/link';
import Image from 'next/image';
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
  MessageSquare,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { APP_NAME, WA_NUMBER, WA_DEFAULT_MESSAGE } from '@/lib/constants';
import { waLink } from '@/lib/utils';
import EstimasiAntrean from '@/components/EstimasiAntrean';
import styles from './landing.module.css';

const iconMap: Record<string, ElementType> = {
  Building2,
  ClipboardCheck,
  Store,
  FileText,
  HeartHandshake,
  Sparkles,
  Shield,
};

const FALLBACK_SERVICES = [
  {
    icon: 'ClipboardCheck' as const,
    title: 'Helpdesk OSS',
    description: 'Konsultasi perizinan usaha melalui Online Single Submission. Petugas siap membantu proses NIB dan izin berusaha Anda.',
    color: 'serviceIconPrimary',
  },
  {
    icon: 'Shield' as const,
    title: 'Sertifikasi Halal',
    description: 'Pendampingan proses sertifikasi halal untuk produk UMKM. Konsultasi gratis langsung dengan petugas terlatih.',
    color: 'serviceIconSuccess',
  },
  {
    icon: 'HeartHandshake' as const,
    title: 'BPJS Kesehatan',
    description: 'Layanan informasi dan bantuan terkait BPJS Kesehatan. Tersedia konsultasi tatap muka dan online.',
    color: 'serviceIconAccent',
  },
  {
    icon: 'Store' as const,
    title: 'Matchmaking UMKM',
    description: 'Platform penghubung kebutuhan UMKM — dari bahan baku hingga kemitraan bisnis. Tersedia juga layanan PEMBIAYAAN UMKM.',
    color: 'serviceIconPrimary',
  },
  {
    icon: 'FileText' as const,
    title: 'Investment Gallery',
    description: 'Pameran potensi investasi Provinsi Lampung. Dokumen IPRO dan Peta Potensi tersedia untuk dilihat secara daring.',
    color: 'serviceIconAccent',
  },
  {
    icon: 'Building2' as const,
    title: 'Bank Lampung',
    description: 'Layanan perbankan daerah pendukung ekosistem UMKM dan investasi.',
    color: 'serviceIconPrimary',
  },
  {
    icon: 'Sparkles' as const,
    title: 'Balai Monitor SFR',
    description: 'Pelayanan Balai Monitor Spektrum Frekuensi Radio, meliputi perizinan frekuensi dan sertifikasi alat telekomunikasi.',
    color: 'serviceIconSuccess',
  },
  {
    icon: 'Shield' as const,
    title: 'Sertifikasi Mutu Keamanan Hasil Perikanan',
    description: 'Sertifikasi Kelayakan Pengolahan (SKP) produk perikanan untuk menjamin mutu dan keamanan pangan standar ekspor.',
    color: 'serviceIconAccent',
  },
  {
    icon: 'FileText' as const,
    title: 'Layanan Jasa Industri',
    description: 'Layanan sertifikasi SNI, pengujian, dan kalibrasi produk industri.',
    color: 'serviceIconPrimary',
  },
];

const FALLBACK_HERO = {
  badge_text: 'DPMPTSP Provinsi Lampung',
  description: 'Hub digital yang menyatukan layanan perizinan, sertifikasi halal, BPJS Kesehatan, matchmaking UMKM, dan galeri investasi dalam satu platform terintegrasi.',
  cta_primary_text: 'Rencanakan Kedatangan',
  cta_primary_link: '/me/reservasi',
  cta_secondary_text: 'Chat via WhatsApp',
  cta_secondary_link: 'wa',
};

const FALLBACK_SECTION_HEADER = {
  label: 'Layanan Kami',
  title: '9 Layanan dalam Satu Atap',
  description: 'Layanan konsultatif tatap muka dan platform digital yang bisa diakses dari mana saja, kapan saja.',
};

const FALLBACK_CTA = {
  title: 'Siap Berkunjung?',
  description: 'Booking kedatangan online terlebih dahulu untuk mempercepat pelayanan Anda di kantor DPMPTSP Provinsi Lampung.',
  button_text: 'Rencanakan Kedatangan',
  button_link: '/me/reservasi',
};

const FALLBACK_FOOTER = {
  copyright: 'DPMPTSP Provinsi Lampung. Hak cipta dilindungi.',
};

interface ServiceItem {
  icon: string;
  title: string;
  description: string;
  color: string;
}

interface LandingData {
  hero: Record<string, string>;
  sectionHeader: Record<string, string>;
  services: ServiceItem[];
  cta: Record<string, string>;
  footer: Record<string, string>;
}

function parseLandingContent(rows: { section: string; item_key: string; item_value: string | null; item_order: number }[]): LandingData {
  const hero: Record<string, string> = {};
  const sectionHeader: Record<string, string> = {};
  const cta: Record<string, string> = {};
  const footer: Record<string, string> = {};
  const serviceMap = new Map<number, ServiceItem>();

  for (const row of rows) {
    const value = row.item_value ?? '';
    switch (row.section) {
      case 'hero':
        hero[row.item_key] = value;
        break;
      case 'section_header':
        sectionHeader[row.item_key] = value;
        break;
      case 'cta':
        cta[row.item_key] = value;
        break;
      case 'footer':
        footer[row.item_key] = value;
        break;
      case 'service': {
        if (!serviceMap.has(row.item_order)) {
          serviceMap.set(row.item_order, { icon: '', title: '', description: '', color: '' });
        }
        const svc = serviceMap.get(row.item_order)!;
        if (row.item_key === 'icon') svc.icon = value;
        else if (row.item_key === 'title') svc.title = value;
        else if (row.item_key === 'description') svc.description = value;
        else if (row.item_key === 'color') svc.color = value;
        break;
      }
    }
  }

  const services = Array.from(serviceMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, svc]) => svc);

  return { hero, sectionHeader, services, cta, footer };
}

interface UserInfo {
  nama: string;
  foto_url: string | null;
  role?: string;
}

export default function LandingPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [landingData, setLandingData] = useState<LandingData | null>(null);

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

    async function fetchLandingContent() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('landing_content')
        .select('section, item_key, item_value, item_order')
        .eq('is_active', true)
        .order('section')
        .order('item_order');

      if (!error && data && data.length > 0) {
        setLandingData(parseLandingContent(data as { section: string; item_key: string; item_value: string | null; item_order: number }[]));
      }
    }

    checkUser();
    fetchLandingContent();
  }, []);

  const hero = landingData?.hero ?? {};
  const sectionHeader = landingData?.sectionHeader ?? {};
  const cta = landingData?.cta ?? {};
  const footer = landingData?.footer ?? {};
  const services = landingData?.services?.length ? landingData.services : FALLBACK_SERVICES;

  const heroBadgeText = hero.badge_text || FALLBACK_HERO.badge_text;
  const heroDescription = hero.description || FALLBACK_HERO.description;
  const heroCtaPrimaryText = hero.cta_primary_text || FALLBACK_HERO.cta_primary_text;
  const heroCtaPrimaryLink = hero.cta_primary_link || FALLBACK_HERO.cta_primary_link;
  const heroCtaSecondaryText = hero.cta_secondary_text || FALLBACK_HERO.cta_secondary_text;
  const heroCtaSecondaryLink = hero.cta_secondary_link || FALLBACK_HERO.cta_secondary_link;

  const sectionLabel = sectionHeader.label || FALLBACK_SECTION_HEADER.label;
  const sectionTitle = sectionHeader.title || FALLBACK_SECTION_HEADER.title;
  const sectionDescription = sectionHeader.description || FALLBACK_SECTION_HEADER.description;

  const ctaTitle = cta.title || FALLBACK_CTA.title;
  const ctaDescription = cta.description || FALLBACK_CTA.description;
  const ctaButtonText = cta.button_text || FALLBACK_CTA.button_text;
  const ctaButtonLink = cta.button_link || FALLBACK_CTA.button_link;

  const footerCopyright = footer.copyright || FALLBACK_FOOTER.copyright;

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
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
          <li><a href="#layanan" className={styles.navLink}>Layanan</a></li>
          <li><Link href="/umkm" className={styles.navLink}>UMKM</Link></li>
          <li><Link href="/gallery" className={styles.navLink}>Investasi</Link></li>
          <li><Link href="/chat" className={styles.navLink}>Live Chat</Link></li>
          <li><Link href="/transparansi" className={styles.navLink}>Transparansi</Link></li>
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
            {heroBadgeText}
          </div>
          <h1 className={styles.heroTitle} style={{ display: 'flex', justifyContent: 'center' }}>
            <Image 
              src="/logo.png" 
              alt="Pelayanan Terpadu Satu Pintu untuk Lampung Maju" 
              width={500} 
              height={220} 
              style={{ objectFit: 'contain', maxWidth: '100%', height: 'auto' }} 
              priority
            />
          </h1>
          <p className={styles.heroDescription}>
            {heroDescription}
          </p>
          <div className={styles.heroActions}>
            <Link href={heroCtaPrimaryLink} className="btn btn--primary btn--lg">
              <ClipboardCheck size={20} />
              {heroCtaPrimaryText}
            </Link>
            {heroCtaSecondaryLink === 'wa' ? (
              <a
                href={waLink(WA_NUMBER, WA_DEFAULT_MESSAGE)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn--secondary btn--lg"
              >
                <MessageCircle size={20} />
                {heroCtaSecondaryText}
              </a>
            ) : (
              <Link href={heroCtaSecondaryLink} className="btn btn--secondary btn--lg">
                <MessageCircle size={20} />
                {heroCtaSecondaryText}
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Estimasi Antrean Realtime */}
      <EstimasiAntrean />

      {/* Services */}
      <section id="layanan" className={styles.services}>
        <div className={styles.sectionHeader}>
          <p className={styles.sectionLabel}>{sectionLabel}</p>
          <h2 className={styles.sectionTitle}>{sectionTitle}</h2>
          <p className={styles.sectionDescription}>
            {sectionDescription}
          </p>
        </div>

        <div className={styles.serviceGrid}>
          {services.map((service, index) => {
            const IconComponent = iconMap[service.icon] || ClipboardCheck;
            const colorClass = styles[service.color] || styles.serviceIconPrimary;
            return (
              <div key={service.title || index} className={styles.serviceCard}>
                <div className={`${styles.serviceIcon} ${colorClass}`}>
                  <IconComponent size={28} />
                </div>
                <h3 className={styles.serviceTitle}>{service.title}</h3>
                <p className={styles.serviceDescription}>{service.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className={styles.cta}>
        <div className={styles.ctaContent}>
          <h2 className={styles.ctaTitle}>{ctaTitle}</h2>
          <p className={styles.ctaDescription}>
            {ctaDescription}
          </p>
          <Link href={ctaButtonLink} className="btn btn--accent btn--lg">
            {ctaButtonText}
            <ArrowRight size={20} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <p>© {new Date().getFullYear()} {APP_NAME} — {footerCopyright}</p>
        <p className={styles.footerLinks}>
          <Link href="/kebijakan-privasi">Kebijakan Privasi</Link>
        </p>
      </footer>

      {/* Floating Chat Widget */}
      <Link href="/chat" className={styles.floatingChat}>
        <MessageSquare size={18} />
        <span>Live Chat</span>
      </Link>
    </div>
  );
}
