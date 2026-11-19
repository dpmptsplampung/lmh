import FormIpro from '@/components/admin/investasi/FormIpro';
import { sumberDariParam } from '@/components/admin/investasi/FormIpro/_logika/rute';

export default async function IproBaruPage({ searchParams }: { searchParams: Promise<{ sumber?: string | string[] }> }) {
  const { sumber } = await searchParams;
  return <FormIpro basis="admin" sumberBaru={sumberDariParam(sumber)} />;
}
