// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bukaPdf } from './pdf';
import { ekstrakTautan } from './ekstraksi-tautan';
import { pdfTautan } from './uji-pdf-tautan';

describe('ekstraksi tautan PDF', () => {
  it('membaca tujuan langsung dan bernama, mencocokkan CropBox dan rotasi, serta membuang tautan tak sah', async () => {
    const pdf = await bukaPdf(pdfTautan());
    try {
      const hasil = await ekstrakTautan(pdf.doc);
      expect(hasil).toEqual({
        versi: 1,
        tautan: [
          { hal: 1, x: 0.25, y: 0.25, w: 0.25, h: 0.25, ke: 2 },
          { hal: 1, x: 0.1, y: 0.05, w: expect.closeTo(0.2), h: expect.closeTo(0.1), url: 'https://lampung.example/peta' },
          { hal: 2, x: 0, y: 0.2, w: 0.25, h: 0.2, ke: 1 },
        ],
      });
    } finally { await pdf.tutup(); }
  });
});
