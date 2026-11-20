'use client';

import Link from 'next/link';
import Tombol from '@/components/ui/Tombol';

export default function GalatDetailIpro({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-16) var(--space-4)', textAlign: 'center' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>Proyek belum dapat dimuat</h1>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Terjadi gangguan sesaat saat memuat data proyek. Coba lagi, atau kembali ke daftar <Link href="/investasi">peluang investasi</Link>.
      </p>
      <Tombol onClick={reset}>Coba lagi</Tombol>
    </main>
  );
}
