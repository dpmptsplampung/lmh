import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, requireAdmin } from '@/lib/akun/server';

export const dynamic = 'force-dynamic';

const tgl = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  jenis: z.string().trim().min(1).max(60).optional(),      // = audit_log.entitas (mis. layanan, site_settings, petugas)
  aksi: z.string().trim().min(1).max(80).optional(),
  orang: z.uuid().optional(),                               // petugas.id pelaku
  dari: tgl.optional(),
  sampai: tgl.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Riwayat Perubahan (audit_log) -- Admin aktif saja. Baca saja; penulisan hanya trigger/server.
export async function GET(request: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { service } = g;

  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
  const { jenis, aksi, orang, dari, sampai, page, limit } = parsed.data;

  let qb = service
    .from('audit_log')
    .select('id, actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (jenis) qb = qb.eq('entitas', jenis);
  if (aksi) qb = qb.eq('aksi', aksi);
  if (dari) qb = qb.gte('created_at', `${dari}T00:00:00+07:00`);
  if (sampai) qb = qb.lte('created_at', `${sampai}T23:59:59.999+07:00`);
  if (orang) {
    // actor_id bisa petugas.id (route server) atau auth user id (trigger DB).
    const { data: p } = await service.from('petugas').select('id, auth_user_id').eq('id', orang).maybeSingle();
    if (!p) return json({ items: [], total: 0, page, limit });
    qb = qb.in('actor_id', [p.id, p.auth_user_id].filter(Boolean));
  }

  const { data, count, error } = await qb;
  if (error) {
    console.error('[admin/riwayat GET] gagal', error.message);
    return json({ error: 'Gagal memuat riwayat' }, 500);
  }
  const rows = data ?? [];

  // Nama pelaku: cocokkan actor_id ke petugas.id ATAU petugas.auth_user_id.
  const ids = [...new Set(rows.map((r) => r.actor_id).filter((v): v is string => !!v))];
  const nama = new Map<string, { nama: string; username: string | null }>();
  if (ids.length > 0) {
    const [a, b] = await Promise.all([
      service.from('petugas').select('id, auth_user_id, nama, username').in('id', ids),
      service.from('petugas').select('id, auth_user_id, nama, username').in('auth_user_id', ids),
    ]);
    for (const p of [...(a.data ?? []), ...(b.data ?? [])]) {
      nama.set(p.id, { nama: p.nama, username: p.username ?? null });
      if (p.auth_user_id) nama.set(p.auth_user_id, { nama: p.nama, username: p.username ?? null });
    }
  }
  return json({
    items: rows.map((r) => ({ ...r, pelaku: r.actor_id ? (nama.get(r.actor_id) ?? null) : null })),
    total: count ?? 0,
    page,
    limit,
  });
}
