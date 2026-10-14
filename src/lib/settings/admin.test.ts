// @vitest-environment node
// Audit T2d (inventaris No 4): audit perubahan pengaturan best-effort, tetapi kegagalan tidak boleh ditelan diam-diam.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

const fake = (error: { code?: string; message: string } | null = null) => {
  const insert = vi.fn(async () => ({ error }));
  return { insert, service: { from: () => ({ insert }) } as unknown as SupabaseClient };
};

describe('auditSettings', () => {
  beforeEach(() => vi.resetModules());

  it('sukses: menulis audit_log entitas pengaturan', async () => {
    const f = fake();
    const { auditSettings } = await import('./admin');
    await auditSettings(f.service, { id: 'p-1', role: 'admin' }, 'llm_uji', 'llm.rantai_chat', { ok: true });
    expect(f.insert).toHaveBeenCalledWith({
      actor_id: 'p-1', actor_role: 'admin', aksi: 'llm_uji', entitas: 'pengaturan', entitas_id: 'llm.rantai_chat', detail: { ok: true },
    });
  });

  it('gagal: tidak melempar (aksi sudah terjadi) tetapi dicatat ke log tanpa pesan DB', async () => {
    const f = fake({ code: '42501', message: 'row-level security rahasia-db' });
    const { auditSettings } = await import('./admin');
    const logger = await import('@/lib/observability/logger');
    vi.mocked(logger.logServerEvent).mockClear();
    await expect(auditSettings(f.service, { id: 'p-1', role: 'admin' }, 'llm_uji', 'k', {})).resolves.toBeUndefined();
    expect(logger.logServerEvent).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'settings.audit', asalCode: '42501', aksi: 'llm_uji' }));
    expect(JSON.stringify(vi.mocked(logger.logServerEvent).mock.calls)).not.toContain('rahasia-db');
  });
});
