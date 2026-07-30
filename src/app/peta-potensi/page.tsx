'use client';

// WP-32 / INV-01..03, RBA-11: Investment potential map.
// Requires authenticated user (RBA-11/SK-21).
// Logs jejak_minat_investasi for each sector/document view (INV-02).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Map, Building2, FileText, TrendingUp, Lock } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const SEKTOR = [
  { id: 'pertanian', label: 'Pertanian & Perkebunan', icon: '🌾', deskripsi: 'Sawit, karet, lada, singkong, dan komoditas unggulan Lampung' },
  { id: 'perikanan', label: 'Perikanan & Kelautan', icon: '🐟', deskripsi: 'Budidaya udang, tambak, dan industri pengolahan hasil laut' },
  { id: 'pariwisata', label: 'Pariwisata', icon: '🏖️', deskripsi: 'Wisata alam, pantai, dan ekowisata Lampung' },
  { id: 'industri', label: 'Industri Manufaktur', icon: '🏭', deskripsi: 'Pengolahan CPO, tekstil, dan industri berbasis bahan baku lokal' },
  { id: 'energi', label: 'Energi Terbarukan', icon: '⚡', deskripsi: 'PLTP, solar farm, dan potensi energi Lampung' },
  { id: 'infrastruktur', label: 'Infrastruktur & Logistik', icon: '🚢', deskripsi: 'Pelabuhan, kawasan industri, dan konektivitas' },
];

export default function PetaPotensiPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [pengunjungId, setPengunjungId] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login?redirect=/peta-potensi');
        return;
      }
      setUserId(user.id);
      const { data: p } = await supabase
        .from('pengunjung')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();
      if (p) setPengunjungId(p.id);
      setAuthChecked(true);

      // Log page view (INV-02)
      await supabase.from('jejak_minat_investasi').insert({
        pengunjung_id: p?.id ?? null,
        jenis_konten: 'peta_potensi',
        konten_id: 'halaman_utama',
        sumber_halaman: '/peta-potensi',
      });
    }
    check();
  }, [router]);

  const logSektorView = async (sektorId: string) => {
    if (!authChecked) return;
    const supabase = createClient();
    await supabase.from('jejak_minat_investasi').insert({
      pengunjung_id: pengunjungId ?? null,
      jenis_konten: 'sektor',
      konten_id: sektorId,
      sumber_halaman: '/peta-potensi',
    });
  };

  if (!authChecked) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, color: 'var(--text-secondary)' }}>
        <Lock size={40} style={{ opacity: 0.4 }} />
        <p>Memverifikasi akses.</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{ background: 'var(--color-primary-700)', color: '#fff', padding: 'var(--space-16) var(--space-8)', textAlign: 'center' }}>
        <Map size={48} style={{ marginBottom: 'var(--space-4)', opacity: 0.9 }} />
        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, marginBottom: 'var(--space-3)' }}>
          Peta Potensi Investasi Lampung
        </h1>
        <p style={{ fontSize: 'var(--text-lg)', opacity: 0.85, maxWidth: 640, margin: '0 auto' }}>
          Jelajahi peluang investasi unggulan di Provinsi Lampung. Data dipresentasikan oleh DPMPTSP Provinsi Lampung.
        </p>
      </div>
      {/* Sektor grid */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--space-12) var(--space-8)' }}>
        <h2 style={{ fontWeight: 700, fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-8)', textAlign: 'center' }}>
          <TrendingUp size={24} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
          Sektor Unggulan
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-6)' }}>
          {SEKTOR.map(s => (
            <button
              key={s.id}
              onClick={() => logSektorView(s.id)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-xl)',
                padding: 'var(--space-6)',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'box-shadow 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.12)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
            >
              <div style={{ fontSize: '2rem', marginBottom: 'var(--space-3)' }}>{s.icon}</div>
              <h3 style={{ fontWeight: 700, fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>{s.label}</h3>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{s.deskripsi}</p>
            </button>
          ))}
        </div>
        {/* Investment Gallery link */}
        <div style={{ marginTop: 'var(--space-12)', textAlign: 'center' }}>
          <Link href="/gallery" className="btn btn--primary btn--lg">
            <FileText size={18} />
            Lihat Investment Gallery &amp; Dokumen IPRO
          </Link>
          <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            Dokumen profil investasi, potensi wilayah, dan IPRO tersedia untuk investor terdaftar.
          </p>
        </div>
        {/* Contact CTA */}
        <div style={{ marginTop: 'var(--space-12)', background: 'var(--color-primary-50)', border: '1px solid var(--color-primary-100)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-8)', textAlign: 'center' }}>
          <Building2 size={36} style={{ color: 'var(--color-primary-600)', marginBottom: 'var(--space-3)' }} />
          <h3 style={{ fontWeight: 700, fontSize: 'var(--text-xl)', marginBottom: 'var(--space-2)' }}>
            Tertarik Berinvestasi di Lampung?
          </h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
            Hubungi tim DPMPTSP Provinsi Lampung untuk informasi lebih lanjut dan pendampingan investasi.
          </p>
          <Link href="/chat" className="btn btn--primary">
            Konsultasi via Live Chat
          </Link>
        </div>
      </div>
    </div>
  );
}
