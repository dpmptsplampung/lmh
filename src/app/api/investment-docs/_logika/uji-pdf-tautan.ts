export function pdfTautan() {
  const objek = [
    '<< /Type /Catalog /Pages 2 0 R /Dests << /awal [3 0 R /Fit] >> >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 140] /CropBox [10 20 210 120] /Rotate 90 /Resources << >> /Annots [5 0 R 6 0 R 7 0 R 8 0 R 9 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Annots [10 0 R 11 0 R 12 0 R 13 0 R] >>',
    '<< /Subtype /Link /Rect [60 45 110 70] /Dest [4 0 R /Fit] >>',
    '<< /Subtype /Link /Rect [20 30 40 50] /A << /S /URI /URI (https://lampung.example/peta) >> >>',
    '<< /Subtype /Link /Rect [20 30 40 50] /A << /S /URI /URI (file:///rahasia.pdf) >> >>',
    '<< /Subtype /Link /Rect [20 30 40 50] /A << /S /URI /URI (mailto:test@example.invalid) >> >>',
    '<< /Subtype /Link /Rect [20 30 40 50] /A << /S /URI /URI (javascript:alert) >> >>',
    '<< /Subtype /Link /Rect [-5 60 25 80] /Dest /awal >>',
    '<< /Subtype /Link /Rect [0 0 0.001 0.001] /Dest /awal >>',
    '<< /Subtype /Link /Rect [10 10 40 40] /Dest /hilang >>',
    '<< /Subtype /Link /Rect [10 10 40 40] /Dest [10 /Fit] >>',
  ];
  let isi = '%PDF-1.4\n';
  const posisi = objek.map((obj, i) => {
    const offset = isi.length;
    isi += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    return offset;
  });
  const xref = isi.length;
  const ukuran = objek.length + 1;
  isi += `xref\n0 ${ukuran}\n0000000000 65535 f \n`;
  for (const offset of posisi) isi += `${String(offset).padStart(10, '0')} 00000 n \n`;
  isi += `trailer\n<< /Size ${ukuran} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(isi);
}
