import type { Metadata } from 'next';
import UsahaSaya from '@/components/umkm-pemilik/UsahaSaya';

export const metadata: Metadata = {
  title: 'Usaha saya', description: 'Daftarkan dan kelola profil usaha UMKM Anda.',
};

export default function UsahaSayaPage() {
  return <UsahaSaya />;
}
