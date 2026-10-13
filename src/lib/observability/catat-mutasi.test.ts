// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

import { logServerEvent } from '@/lib/observability/logger';
import { MutasiError } from '@/lib/supabase/mutate';
import { catatMutasi } from './catat-mutasi';

describe('catatMutasi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('MutasiError: mencatat kode + asalCode, tanpa pesan teknis mentah', () => {
    const e = new MutasiError('database', {
      asal: { code: '23505', message: 'duplicate key value violates unique constraint "x_key" Key (email)=(a@b.c)' },
    });
    catatMutasi('error', 'chat.sesi.update', '/api/chat/sesi', e, { sesiId: 's1' });

    expect(logServerEvent).toHaveBeenCalledTimes(1);
    const [level, fields] = vi.mocked(logServerEvent).mock.calls[0];
    expect(level).toBe('error');
    expect(fields).toMatchObject({
      operation: 'chat.sesi.update',
      route: '/api/chat/sesi',
      kode: 'database',
      asalCode: '23505',
      sesiId: 's1',
    });
    expect(JSON.stringify(fields)).not.toMatch(/duplicate key|a@b\.c|x_key/);
  });

  it('MutasiError tanpa kode asal (mis. tidak_ada_baris): asalCode tidak disertakan', () => {
    catatMutasi('warn', 'x.y', '/api/x', new MutasiError('tidak_ada_baris'));
    const [level, fields] = vi.mocked(logServerEvent).mock.calls[0];
    expect(level).toBe('warn');
    expect(fields).toMatchObject({ kode: 'tidak_ada_baris' });
    expect(fields).not.toHaveProperty('asalCode');
  });

  it('error tak terduga: kode tak_terduga dan error diteruskan ke logger (yang menyamarkan pesannya)', () => {
    const err = new TypeError('boom');
    catatMutasi('error', 'x.y', '/api/x', err);
    const [, fields] = vi.mocked(logServerEvent).mock.calls[0];
    expect(fields).toMatchObject({ kode: 'tak_terduga', error: err });
  });
});
