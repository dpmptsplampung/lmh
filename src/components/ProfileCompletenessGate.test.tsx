// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KATEGORI_PENGUNJUNG } from '@/lib/constants';

describe('ProfileCompletenessGate kategori options', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/ProfileCompletenessGate.tsx'),
    'utf8',
  );

  it('imports KATEGORI_PENGUNJUNG and does not hardcode akademisi or lowercase values', () => {
    expect(source).toMatch(/KATEGORI_PENGUNJUNG/);
    expect(source).not.toMatch(/value=["']akademisi["']/);
    expect(source).not.toMatch(/value=["']umum["']/);
    expect(source).not.toMatch(/value=["']umkm["']/);
    expect(source).not.toMatch(/value=["']investor["']/);
    expect(source).not.toMatch(/value=["']instansi["']/);
  });

  it('renders options only from the typed constant keys', () => {
    for (const key of Object.keys(KATEGORI_PENGUNJUNG)) {
      expect(source).toMatch(new RegExp(`Object\\.(?:entries|keys)\\(KATEGORI_PENGUNJUNG\\)`));
      expect(key).toMatch(/^(Umum|UMKM|Investor|Instansi)$/);
    }
  });
});
