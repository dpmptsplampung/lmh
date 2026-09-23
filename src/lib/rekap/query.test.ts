import { describe, it, expect } from 'vitest';
import { escapeIlikeWildcards, buildTicketsQuery } from './query';

describe('escapeIlikeWildcards', () => {
  it('escapes % and _', () => {
    expect(escapeIlikeWildcards('100%')).toBe('100\\%');
    expect(escapeIlikeWildcards('a_b')).toBe('a\\_b');
    expect(escapeIlikeWildcards('a%b_c')).toBe('a\\%b\\_c');
  });

  it('leaves normal chars unchanged', () => {
    expect(escapeIlikeWildcards('budi')).toBe('budi');
  });
});

describe('buildTicketsQuery', () => {
  // Fake builder minimal: cukup merekam argumen select().
  function makeFakeSupabase() {
    const selectArg = { value: '' as string };
    const builder: Record<string, unknown> = {
      select: (sel: string) => {
        selectArg.value = sel;
        return builder;
      },
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      or: () => builder,
      order: () => builder,
      range: () => builder,
    };
    return {
      supabase: { from: () => builder } as unknown as Parameters<typeof buildTicketsQuery>[0],
      selectArg,
    };
  }

  it('memakai embed tabel pelayanan_oss & pelayanan_perizinan tanpa alias tiket_id', () => {
    const { supabase, selectArg } = makeFakeSupabase();
    buildTicketsQuery(supabase, {
      layananId: null, q: '', dari: '2026-09-01', sampai: '2026-09-07', from: 0, to: 24,
    });
    expect(selectArg.value).toContain('pelayanan_oss(*)');
    expect(selectArg.value).toContain('pelayanan_perizinan(*)');
    expect(selectArg.value).not.toContain('tiket_id(');
    expect(selectArg.value).not.toContain('perizinAN');
  });
});
