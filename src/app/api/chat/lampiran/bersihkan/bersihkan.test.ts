// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ baris: [] as Array<{ id: string; lampiran_kunci: string }>, updated: [] as unknown[], batasLt: '' }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ not: () => ({ lt: (_k: string, v: string) => { h.batasLt = v; return { limit: async () => ({ data: h.baris, error: null }) }; } }) }),
      update: (p: unknown) => ({ in: (_k: string, ids: string[]) => ({ select: async () => { h.updated.push({ p, ids }); return { data: ids.map((id) => ({ id })), error: null }; } }) }),
    }),
  }),
}));
vi.mock('@/lib/storage/r2', () => ({ r2Tersedia: () => true, deleteObjects: vi.fn(async () => undefined) }));

import type { NextRequest } from 'next/server';
import * as r2 from '@/lib/storage/r2';
import { POST } from './route';

const req = (auth?: string) => new Request('http://x', { method: 'POST', headers: auth ? { authorization: auth } : {} }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  h.baris = []; h.updated = [];
  vi.stubEnv('CRON_SECRET', 's3cret');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
});

describe('POST /api/chat/lampiran/bersihkan', () => {
  it('tanpa/salah rahasia -> 401', async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req('Bearer salah'))).status).toBe(401);
  });
  it('menghapus objek lalu mengosongkan kolom; batas 90 hari', async () => {
    h.baris = [{ id: 'a', lampiran_kunci: 'chat-lampiran/s/1.png' }, { id: 'b', lampiran_kunci: 'chat-lampiran/s/2.jpg' }];
    const res = await POST(req('Bearer s3cret'));
    expect(await res.json()).toEqual({ dihapus: 2 });
    expect(r2.deleteObjects).toHaveBeenCalledWith('private', ['chat-lampiran/s/1.png', 'chat-lampiran/s/2.jpg']);
    expect(h.updated).toHaveLength(1);
    const umurHari = (Date.now() - new Date(h.batasLt).getTime()) / 86_400_000;
    expect(umurHari).toBeGreaterThan(89.9);
    expect(umurHari).toBeLessThan(90.1);
  });
  it('R2 gagal -> kolom TIDAK dikosongkan dan 500', async () => {
    h.baris = [{ id: 'a', lampiran_kunci: 'chat-lampiran/s/1.png' }];
    (r2.deleteObjects as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('R2 mati'));
    expect((await POST(req('Bearer s3cret'))).status).toBe(500);
    expect(h.updated).toHaveLength(0);
  });
  it('tidak ada yang kedaluwarsa -> dihapus 0', async () => {
    expect(await (await POST(req('Bearer s3cret'))).json()).toEqual({ dihapus: 0 });
  });
});
