import { MutasiError } from '@/lib/supabase/mutate';

export async function patchDokumen(id: string, payload: object): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/investment-docs/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
  } catch {
    throw new MutasiError('jaringan');
  }
  if (res.ok) return;
  const body = await res.json().catch(() => ({}));
  const pesan = typeof body.error?.message === 'string' ? body.error.message : undefined;
  if (res.status === 401 || res.status === 403) throw new MutasiError('ditolak', { pesan });
  if (res.status === 404 || res.status === 409) throw new MutasiError('tidak_ada_baris', { pesan });
  throw new MutasiError('database', { pesan });
}
