// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const createClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/client', () => ({ createClient }));

import { langganStatus, langganTabel, statusTabel } from './pusat';

describe('pusat realtime saat SSR (tanpa window)', () => {
  it('tidak membuat klien atau channel; fungsi berhenti aman dan idempoten', () => {
    expect(typeof window).toBe('undefined');
    const henti = langganTabel('penanganan', vi.fn());
    const hentiStatus = langganStatus('penanganan', vi.fn());
    expect(createClient).not.toHaveBeenCalled();
    expect(statusTabel('penanganan')).toBe('putus');
    expect(() => { henti(); henti(); hentiStatus(); hentiStatus(); }).not.toThrow();
  });
});
