'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import PendataanKhususEditor from '@/components/admin/layanan/PendataanKhususEditor';

// Pendataan Khusus satu Layanan (Admin; spec Fase 4 §7). Hanya Admin: API menolak peran lain (403).
export default function PendataanKhususPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  return (
    <>
      <PageHeader title="Pendataan Khusus" description="Isian tambahan per Layanan yang diisi petugas saat menyelesaikan pelayanan" />
      <div style={{ padding: 'clamp(var(--space-4), 4vw, var(--space-8))' }}>
        <p style={{ margin: '0 0 var(--space-4)' }}>
          <Link href="/admin/layanan" className="btn btn--ghost btn--sm">
            <ArrowLeft size={14} aria-hidden="true" /> Kembali ke Kelola Layanan
          </Link>
        </p>
        {id ? <PendataanKhususEditor layananId={id} /> : null}
      </div>
    </>
  );
}
