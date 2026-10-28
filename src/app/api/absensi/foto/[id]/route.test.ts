// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({ r2Tersedia: vi.fn(() => true), getObjectStream: vi.fn() }));

import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as r2 from '@/lib/storage/r2';
import { GET } from './route';

const ID = '11111111-1111-1111-1111-111111111111';
const panggil = (id = ID) => GET({} as NextRequest, { params: Promise.resolve({ id }) });
function sesi(user: unknown, baris: unknown) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: baris }) }) }) }),
  });
}

describe('GET /api/absensi/foto/[id]', () => {
  beforeEach(() => vi.clearAllMocks());
  it('id bukan UUID -> 404', async () => { sesi({ id: 'u' }, null); expect((await panggil('x')).status).toBe(404); });
  it('tanpa sesi -> 401', async () => { sesi(null, null); expect((await panggil()).status).toBe(401); });
  it('baris tak terlihat (RLS) -> 404 tanpa menyentuh R2', async () => {
    sesi({ id: 'u' }, null);
    expect((await panggil()).status).toBe(404);
    expect(r2.getObjectStream).not.toHaveBeenCalled();
  });
  it('sukses men-stream dengan no-store', async () => {
    sesi({ id: 'u' }, { foto_path: '2026-11-02/L1_1.jpg' });
    (r2.getObjectStream as ReturnType<typeof vi.fn>).mockResolvedValue({ stream: new Response('x').body, contentType: 'image/jpeg', contentLength: 1 });
    const res = await panggil();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(r2.getObjectStream).toHaveBeenCalledWith('private', 'absensi-foto/2026-11-02/L1_1.jpg');
  });
});
