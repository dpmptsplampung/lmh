// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ encrypted: false, pages: 2, width: 100, height: 100, destroy: vi.fn(), createCanvas: vi.fn(), render: vi.fn() }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: () => ({
  destroy: h.destroy, promise: Promise.resolve({ numPages: h.pages, canvasFactory: { create: h.createCanvas }, getPermissions: async () => h.encrypted ? [] : null, getPage: async () => ({
    getViewport: () => ({ width: h.width, height: h.height }), render: h.render, cleanup: vi.fn(),
  }) }),
}) }));
import { bukaPdf, renderHalaman } from './pdf';
const bytes = (s: string) => new TextEncoder().encode(s);
describe('batas PDF investasi', () => {
  it('menolak tanda tangan palsu dan enkripsi pada trailer', async () => {
    await expect(bukaPdf(bytes('bukan PDF'))).rejects.toThrow('INPUT_TIDAK_VALID');
    await expect(bukaPdf(bytes('%PDF-1.4' + ' '.repeat(3000) + '/Encrypt 1 0 R'))).rejects.toThrow('INPUT_TIDAK_VALID');
  });
  it('menolak enkripsi yang dibuka tanpa sandi melalui izin parser', async () => {
    h.encrypted = true;
    await expect(bukaPdf(bytes('%PDF-1.4'))).rejects.toThrow('INPUT_TIDAK_VALID');
    h.encrypted = false;
  });
  it('menolak lebih dari 50 halaman dan membersihkan dokumen', async () => {
    h.pages = 51;
    await expect(bukaPdf(bytes('%PDF-1.4'))).rejects.toThrow('INPUT_TIDAK_VALID');
    expect(h.destroy).toHaveBeenCalled(); h.pages = 2;
  });
  it('menolak bom piksel sebelum canvas dialokasikan', async () => {
    const pdf = await bukaPdf(bytes('%PDF-1.4'));
    h.width = 100000; h.height = 100000;
    await expect(renderHalaman(pdf.doc, 1)).rejects.toThrow('INPUT_TIDAK_VALID');
    expect(h.createCanvas).not.toHaveBeenCalled();
  });
});
