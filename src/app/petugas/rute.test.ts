// @vitest-environment node
// Pagar rute /petugas: setiap menu petugas punya halaman nyata, dan halaman hanya merakit (tanpa query/logika).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PETUGAS_NAV } from '@/lib/admin-nav';

const AKAR = join(process.cwd(), 'src/app/petugas');

function semuaHalaman(dir: string): string[] {
  return readdirSync(dir).flatMap((nama) => {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) return semuaHalaman(p);
    return nama === 'page.tsx' ? [p] : [];
  });
}

describe('halaman /petugas', () => {
  it('setiap entri PETUGAS_NAV (kecuali Tampilan Publik) punya page.tsx', () => {
    for (const e of PETUGAS_NAV.filter((x) => x.href !== '/')) {
      expect(existsSync(join(process.cwd(), 'src/app', e.href, 'page.tsx')), e.href).toBe(true);
    }
    expect(existsSync(join(AKAR, 'page.tsx'))).toBe(true); // /petugas -> Antrean
    expect(existsSync(join(AKAR, 'layout.tsx'))).toBe(true);
  });

  it('tidak ada halaman di luar menu: semua page.tsx terdaftar di PETUGAS_NAV (atau pintu masuk /petugas)', () => {
    const terdaftar = new Set(PETUGAS_NAV.map((e) => join(process.cwd(), 'src/app', e.href, 'page.tsx')));
    terdaftar.add(join(AKAR, 'page.tsx'));
    for (const p of semuaHalaman(AKAR)) expect(terdaftar.has(p), p).toBe(true);
  });

  it('halaman hanya merakit: tipis, tanpa query Supabase, tanpa salinan logika', () => {
    for (const p of semuaHalaman(AKAR)) {
      const isi = readFileSync(p, 'utf8');
      expect(isi.split('\n').length, p).toBeLessThanOrEqual(15);
      expect(isi, p).not.toMatch(/supabase|useState|useEffect|fetch\(/);
    }
  });

  it('layout memasang Sidebar, AdminGuard, dan tema dasbor', () => {
    const isi = readFileSync(join(AKAR, 'layout.tsx'), 'utf8');
    expect(isi).toContain('<Sidebar />');
    expect(isi).toContain('<AdminGuard>');
    expect(isi).toContain('data-tema="dasbor"');
  });
});
