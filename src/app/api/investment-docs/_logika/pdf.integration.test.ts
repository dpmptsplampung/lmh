// @vitest-environment node
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { bukaPdf, renderHalaman } from './pdf';

// PDF sintetis valid dengan xref; tanpa jaringan, data nyata, atau penyimpanan eksternal.
function pdfSederhana() {
  const stream = '0.2 0.4 0.6 rg 10 10 30 30 re f';
  const objek = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let s = '%PDF-1.4\n'; const offsets = [0];
  objek.forEach((isi, i) => { offsets.push(s.length); s += `${i + 1} 0 obj\n${isi}\nendobj\n`; });
  const xref = s.length;
  s += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(s);
}
describe('PDF nyata melalui parser, canvas, dan sharp', () => {
  it('merender PDF sintetis menjadi PNG skala 1.5 tanpa metadata', async () => {
    const pdf = await bukaPdf(pdfSederhana());
    try {
      expect(pdf.doc.numPages).toBe(1);
      const png = await renderHalaman(pdf.doc, 1);
      const meta = await sharp(png).metadata();
      expect(meta).toMatchObject({ format: 'png', width: 150, height: 150 });
      expect(meta.exif).toBeUndefined();
    } finally { await pdf.tutup(); }
  });
});
