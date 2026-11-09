import type { Metadata } from 'next';
import Katalog from '@/components/umkm-katalog/Katalog';

export const metadata: Metadata = {
  title: 'Katalog UMKM', description: 'Temukan profil usaha Lampung yang sudah diperiksa petugas.',
};

export default function KatalogPage() {
  return <Katalog />;
}
