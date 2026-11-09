import type { Metadata } from 'next';
import DetailUsahaSaya from '@/components/umkm-pemilik/DetailUsahaSaya';

export const metadata: Metadata = { title: 'Usaha saya', description: 'Kelola profil usaha UMKM Anda.' };

export default async function DetailUsahaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetailUsahaSaya id={id} />;
}
