// @vitest-environment node
// Pagar rute /petugas: setiap menu petugas punya halaman nyata, dan halaman hanya merakit (tanpa query/logika).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { PETUGAS_NAV } from '@/lib/admin-nav';

const AKAR = join(process.cwd(), 'src/app/petugas');
const AKAR_MENU = PETUGAS_NAV.filter(e => e.href.startsWith('/petugas/'))
  .map(e => join(process.cwd(), 'src/app', e.href));
const halamanDalamMenu = (p: string) => p === join(AKAR, 'page.tsx') ||
  AKAR_MENU.some(akar => p.startsWith(`${akar}${sep}`));

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

  it('tidak ada halaman di luar menu: semua page.tsx berada di href PETUGAS_NAV atau turunannya (atau pintu masuk /petugas)', () => {
    for (const p of semuaHalaman(AKAR)) expect(halamanDalamMenu(p), p).toBe(true);
  });

  it('menerima anak menu IPRO dan menolak halaman yatim serta awalan href yang berbeda', () => {
    expect(halamanDalamMenu(join(AKAR, 'investasi/ipro/[id]/page.tsx'))).toBe(true);
    expect(halamanDalamMenu(join(AKAR, 'investasi/ipro/baru/page.tsx'))).toBe(true);
    expect(halamanDalamMenu(join(AKAR, 'yatim/page.tsx'))).toBe(false);
    expect(halamanDalamMenu(join(AKAR, 'investasi/page.tsx'))).toBe(false);
    expect(halamanDalamMenu(join(AKAR, 'investasi/ipro-lain/page.tsx'))).toBe(false);
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
