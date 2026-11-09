import type { Metadata } from 'next';
import ProfilKatalog from '@/components/umkm-katalog/ProfilKatalog';

export const metadata: Metadata = {
  title: 'Profil UMKM', description: 'Informasi usaha Lampung dan bantuan melalui petugas UMKM.',
};

export default async function ProfilKatalogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProfilKatalog id={id} />;
}
