import { describe, it, expect } from 'vitest';
import { normalizeQuestion, DEFAULT_SINONIM } from './normalize';

describe('normalizeQuestion', () => {
  it('lowercase, buang tanda baca, rapatkan spasi', () => {
    expect(normalizeQuestion('  Syarat NIB apa???  ')).toBe('syarat nib nomor induk berusaha apa');
  });

  it('memperluas singkatan lewat kamus sinonim', () => {
    const out = normalizeQuestion('berapa biaya OSS?');
    expect(out).toContain('online single submission');
  });

  it('kata tak dikenal dibiarkan', () => {
    expect(normalizeQuestion('halo dunia')).toBe('halo dunia');
  });

  it('sinonim kustom dipakai bila diberikan', () => {
    const out = normalizeQuestion('syarat ptd', { ptd: ['pendaftaran tenaga daerah'] });
    expect(out).toBe('syarat ptd pendaftaran tenaga daerah');
  });

  it('DEFAULT_SINONIM minimal memuat nib & oss', () => {
    expect(DEFAULT_SINONIM.nib).toBeDefined();
    expect(DEFAULT_SINONIM.oss).toBeDefined();
  });
});
