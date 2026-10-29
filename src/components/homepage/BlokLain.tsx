'use client';

// Blok homepage selain daftar layanan dan status antrean: hero, jalur cepat, ajakan bertindak, footer, dan slot
// papan kinerja (tercadang, belum dibangun). Teks datang dari blok tersusun (lib/homepage/blok.ts); komponen
// ini tidak menyimpan teks cadangan sendiri karena blok mati tidak pernah sampai ke sini.
import type { ElementType } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  CalendarCheck,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Eye,
  Lightbulb,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Search,
  Sparkles,
  Store,
  TrendingUp,
} from 'lucide-react';
import { APP_NAME } from '@/lib/constants';
import landing from '@/app/landing.module.css';
import styles from './Homepage.module.css';

type Teks = Record<string, string>;

export function BlokHero({ teks, waHref }: { teks: Teks; waHref: string }) {
  const kedua = teks.cta_secondary_link;
  return (
    <section className={landing.hero}>
      <div className={landing.heroGlow} />
      <div className={landing.heroContent}>
        <div className={landing.heroBadge}>
          <Sparkles size={14} aria-hidden="true" />
          {teks.badge_text}
        </div>
        <div className={landing.heroLogo}>
          <Image
            src="/logo.png"
            alt=""
            width={240}
            height={100}
            style={{ objectFit: 'contain', maxWidth: '100%', height: 'auto' }}
            priority
          />
        </div>
        <h1 className={landing.heroTitle}>
          {teks.title} <span className={landing.heroTitleAccent}>{teks.title_accent}</span>
        </h1>
        <p className={landing.heroDescription}>{teks.description}</p>
        <div className={landing.heroActions}>
          <Link href={teks.cta_primary_link} className="btn btn--primary btn--lg">
            <ClipboardCheck size={20} aria-hidden="true" />
            {teks.cta_primary_text}
          </Link>
          {kedua === 'wa' ? (
            <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn btn--secondary btn--lg">
              <MessageCircle size={20} aria-hidden="true" />
              {teks.cta_secondary_text}
            </a>
          ) : (
            <Link href={kedua} className="btn btn--secondary btn--lg">
              <MessageCircle size={20} aria-hidden="true" />
              {teks.cta_secondary_text}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

// Tautan jalur cepat TETAP di kode; admin hanya mengubah judul dan penjelasan blok (rencana Fase 2, K6).
const JALUR_CEPAT: { href: string; label: string; ikon: ElementType }[] = [
  { href: '/me/reservasi', label: 'Rencanakan kedatangan', ikon: CalendarCheck },
  { href: '/chat', label: 'Live chat', ikon: MessageSquare },
  { href: '/pengaduan', label: 'Sampaikan pengaduan', ikon: Megaphone },
  { href: '/saran', label: 'Sampaikan saran', ikon: Lightbulb },
  { href: '/pengaduan/lacak', label: 'Lacak pengaduan', ikon: Search },
  { href: '/umkm', label: 'Marketplace UMKM', ikon: Store },
  { href: '/gallery', label: 'Galeri investasi', ikon: TrendingUp },
  { href: '/standar-pelayanan', label: 'Standar pelayanan', ikon: ClipboardList },
  { href: '/transparansi', label: 'Transparansi', ikon: Eye },
];

export function BlokJalurCepat({ teks }: { teks: Teks }) {
  return (
    <section className={styles.jalur} aria-labelledby="judul-jalur-cepat">
      <div className={landing.sectionHeader}>
        <h2 id="judul-jalur-cepat" className={landing.sectionTitle}>{teks.title}</h2>
        {teks.description && <p className={landing.sectionDescription}>{teks.description}</p>}
      </div>
      <ul className={styles.jalurGrid}>
        {JALUR_CEPAT.map(({ href, label, ikon: Ikon }) => (
          <li key={href}>
            <Link href={href} className={styles.jalurTautan}>
              <Ikon size={20} className={styles.jalurIkon} aria-hidden="true" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Slot tercadang: hanya judul + penjelasan; keduanya kosong = tidak ada yang tampil. */
export function BlokPapanKinerja({ teks }: { teks: Teks }) {
  if (!teks.title && !teks.description) return null;
  return (
    <section className={styles.papan} aria-labelledby={teks.title ? 'judul-papan-kinerja' : undefined}>
      <div className={landing.sectionHeader}>
        {teks.title && <h2 id="judul-papan-kinerja" className={landing.sectionTitle}>{teks.title}</h2>}
        {teks.description && <p className={landing.sectionDescription}>{teks.description}</p>}
      </div>
    </section>
  );
}

export function BlokAjakan({ teks }: { teks: Teks }) {
  return (
    <section className={landing.cta}>
      <div className={landing.ctaContent}>
        <h2 className={landing.ctaTitle}>{teks.title}</h2>
        <p className={landing.ctaDescription}>{teks.description}</p>
        <Link href={teks.button_link} className="btn btn--accent btn--lg">
          {teks.button_text}
          <ArrowRight size={20} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

/**
 * Tautan kebijakan yang SELALU tampil di homepage, di luar blok footer yang bisa dimatikan admin
 * (kewajiban memberi akses ke Kebijakan Privasi tidak boleh ikut hilang bersama blok).
 */
export function TautanKebijakan() {
  return (
    <nav aria-label="Kebijakan" className={styles.kebijakan}>
      <Link href="/kebijakan-privasi">Kebijakan Privasi</Link>
    </nav>
  );
}

export type KontakFooter = { address: string; hours: string; email: string };

export function BlokFooter({ teks, kontak }: { teks: Teks; kontak: KontakFooter }) {
  return (
    <footer className={landing.footer}>
      {(kontak.address || kontak.hours || kontak.email) && (
        <div className={landing.footerContact}>
          {kontak.address && (
            <p className={landing.footerContactItem}>
              <MapPin size={14} aria-hidden="true" />
              <span>{kontak.address}</span>
            </p>
          )}
          {kontak.hours && (
            <p className={landing.footerContactItem}>
              <Clock size={14} aria-hidden="true" />
              <span>{kontak.hours}</span>
            </p>
          )}
          {kontak.email && (
            <p className={landing.footerContactItem}>
              <Mail size={14} aria-hidden="true" />
              <a href={`mailto:${kontak.email}`}>{kontak.email}</a>
            </p>
          )}
        </div>
      )}
      <p>© {new Date().getFullYear()} {APP_NAME} — {teks.copyright}</p>
    </footer>
  );
}
