import { layaniRpc, headersPrivat } from '@/lib/umkm-katalog/server';
import { kosongSchema, queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { laporanCsv } from '@/lib/umkm-katalog/laporan-csv';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  const response = await layaniRpc(kosongSchema, async () => queryInput(request), 'umkm_ekspor_statistik', () => ({}));
  if (!response.ok) return response;
  const { data } = await response.json();
  return new Response(laporanCsv(data), { headers: {
    ...headersPrivat, 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="umkm-laporan.csv"',
  } });
}
