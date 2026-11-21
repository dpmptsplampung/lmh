// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// Regresi 2026-11-21: tanpa berkas ini fungsi Vercel tidak menemukan @napi-rs/canvas, pdfjs gagal dimuat,
// dan unggah PDF investasi ditolak INPUT_TIDAK_VALID (galat tertelan). Lihat next.config.ts.
describe('Pelacakan berkas runtime pdfjs untuk rute investment-docs', () => {
  it('menyertakan kanvas native, worker, dan font pdfjs pada rute PDF', async () => {
    vi.resetModules();
    const { default: nextConfig } = await import('../../next.config');
    const inc = nextConfig.outputFileTracingIncludes ?? {};
    for (const rute of ['/api/investment-docs', '/api/investment-docs/**']) {
      const daftar = inc[rute] ?? [];
      expect(daftar.some(p => p.includes('@napi-rs/canvas/'))).toBe(true);
      expect(daftar.some(p => p.includes('@napi-rs/canvas-linux-x64-gnu'))).toBe(true);
      expect(daftar.some(p => p.includes('pdfjs-dist/legacy/build'))).toBe(true);
      expect(daftar.some(p => p.includes('pdfjs-dist/standard_fonts'))).toBe(true);
    }
  });
  it('tidak melebar ke rute lain (bundel fungsi tetap kecil)', async () => {
    vi.resetModules();
    const { default: nextConfig } = await import('../../next.config');
    expect(Object.keys(nextConfig.outputFileTracingIncludes ?? {}).every(k => k.startsWith('/api/investment-docs'))).toBe(true);
  });
});
