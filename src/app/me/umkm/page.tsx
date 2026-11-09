import type { Metadata } from 'next';
import PanelUmkmSaya from '@/components/umkm-perusahaan/PanelUmkmSaya';

export const metadata: Metadata = {
  title: 'UMKM saya', description: 'Kebutuhan dan permintaan nomor UMKM Anda.',
};

export default function UmkmSayaPage() {
  return <PanelUmkmSaya />;
}
