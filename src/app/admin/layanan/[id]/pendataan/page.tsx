'use client';

import Tombol from '@/components/ui/Tombol';

import tampilan from './page.dasbor.module.css';

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
      <div className={tampilan.area1}>
        <p className={tampilan.teks2}>
          <Tombol href="/admin/layanan" varian="hantu" ukuran="kecil">
            <ArrowLeft size={14} aria-hidden="true" /> Kembali ke Kelola Layanan
          </Tombol>
        </p>
        {id ? <PendataanKhususEditor layananId={id} /> : null}
      </div>
    </>
  );
}
