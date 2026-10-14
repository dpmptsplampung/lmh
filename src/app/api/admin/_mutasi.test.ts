// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

import { logServerEvent } from '@/lib/observability/logger';
import { MutasiError } from '@/lib/supabase/mutate';
import { catatMutasiGagal, kodeDbMutasi, pesanDbMutasi, statusMutasi } from './_mutasi';

describe('statusMutasi', () => {
  it('default per kode; peta menimpa sebagian kode', () => {
    expect(statusMutasi(new MutasiError('ditolak'))).toBe(403);
    expect(statusMutasi(new MutasiError('tidak_ada_baris'))).toBe(404);
    expect(statusMutasi(new MutasiError('jaringan'))).toBe(503);
    expect(statusMutasi(new MutasiError('database'))).toBe(500);
    expect(statusMutasi(new MutasiError('tidak_ada_baris'), { tidak_ada_baris: 409 })).toBe(409);
    expect(statusMutasi(new MutasiError('database'), { tidak_ada_baris: 409 })).toBe(500);
  });
});

describe('kodeDbMutasi / pesanDbMutasi', () => {
  it('membaca code/message dari error asli; kosong bila tidak ada', () => {
    const e = new MutasiError('database', { asal: { code: '23505', message: 'dup' } });
    expect(kodeDbMutasi(e)).toBe('23505');
    expect(pesanDbMutasi(e)).toBe('dup');
    expect(kodeDbMutasi(new MutasiError('tidak_ada_baris'))).toBeUndefined();
    expect(pesanDbMutasi(new MutasiError('tidak_ada_baris'))).toBe('');
    expect(kodeDbMutasi({ code: '42501' })).toBe('42501');
    expect(kodeDbMutasi(null)).toBeUndefined();
    expect(kodeDbMutasi(new MutasiError('database', { asal: { code: '' } }))).toBeUndefined();
  });
});

describe('catatMutasiGagal', () => {
  beforeEach(() => vi.mocked(logServerEvent).mockClear());

  it('tidak_ada_baris = warn; kode lain & error tak dikenal = error; route + operation ikut tercatat', () => {
    catatMutasiGagal('/api/admin/x', 'admin.x.y', new MutasiError('tidak_ada_baris'), { xId: '1' });
    expect(logServerEvent).toHaveBeenLastCalledWith('warn', expect.objectContaining({ operation: 'admin.x.y', route: '/api/admin/x', kode: 'tidak_ada_baris', xId: '1' }));
    catatMutasiGagal('/api/admin/x', 'admin.x.y', new MutasiError('ditolak', { asal: { code: '42501', message: 'rahasia' } }));
    const [level, fields] = vi.mocked(logServerEvent).mock.lastCall!;
    expect(level).toBe('error');
    expect(fields).toMatchObject({ kode: 'ditolak', asalCode: '42501' });
    expect(JSON.stringify(fields)).not.toContain('rahasia');
    catatMutasiGagal('/api/admin/x', 'admin.x.y', new TypeError('boom'));
    expect(vi.mocked(logServerEvent).mock.lastCall![0]).toBe('error');
  });
});
