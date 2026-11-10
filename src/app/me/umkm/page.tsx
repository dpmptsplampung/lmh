import type { Metadata } from 'next';
import PanelUmkmSaya from '@/components/umkm-perusahaan/PanelUmkmSaya';

export const metadata: Metadata = {
  title: 'Cari pemasok', description: 'Kebutuhan dan permintaan nomor UMKM yang Anda cari.',
};

export default function UmkmSayaPage() {
  return <PanelUmkmSaya />;
}
