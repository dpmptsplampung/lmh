// /admin/rekap-fo (lama) -> redirect ke Rekap terpadu, Data Pelayanan unit Front Office.
import { describe, expect, it, vi } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import RekapFoRedirect from './page';

describe('/admin/rekap-fo', () => {
  it('redirect ke /admin/rekap?bagian=data&unit=fo', () => {
    expect(() => RekapFoRedirect()).toThrow('NEXT_REDIRECT:/admin/rekap?bagian=data&unit=fo');
  });
});
