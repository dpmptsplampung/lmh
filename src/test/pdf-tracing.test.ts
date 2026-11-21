// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// Regresi 2026-11-21: dua sebab unggah PDF investasi ditolak INPUT_TIDAK_VALID (galat tertelan): (1) fungsi Vercel tidak
// memuat @napi-rs/canvas, (2) Turbopack membundel pdfjs sehingga pdf.worker.mjs tidak ditemukan. Lihat next.config.ts.
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
  it('pdfjs-dist dan kanvas native dimuat sebagai paket eksternal (worker pdfjs dicari di lokasi aslinya)', async () => {
    vi.resetModules();
    const { default: nextConfig } = await import('../../next.config');
    expect(nextConfig.serverExternalPackages).toEqual(expect.arrayContaining(['pdfjs-dist', '@napi-rs/canvas']));
  });
  it('tidak melebar ke rute lain (bundel fungsi tetap kecil)', async () => {
    vi.resetModules();
    const { default: nextConfig } = await import('../../next.config');
    expect(Object.keys(nextConfig.outputFileTracingIncludes ?? {}).every(k => k.startsWith('/api/investment-docs'))).toBe(true);
  });
});
