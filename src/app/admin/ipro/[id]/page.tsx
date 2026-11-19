import { notFound } from 'next/navigation';
import FormIpro from '@/components/admin/investasi/FormIpro';
import { idIproSah } from '@/components/admin/investasi/FormIpro/_logika/rute';

export default async function IproDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idIproSah(id)) notFound();
  return <FormIpro basis="admin" id={id} />;
}
