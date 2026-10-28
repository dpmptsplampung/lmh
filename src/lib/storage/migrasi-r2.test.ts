import { describe, expect, it } from 'vitest';
import { perluDisalin, petakanObjek, ringkas, tulisUlangUrl } from '../../../scripts/migrasi-r2/lib.mjs';

describe('migrasi-r2 lib', () => {
  it('petakanObjek: bucket -> (bucket R2, kunci berawalan)', () => {
    expect(petakanObjek('umkm-photos', 'a.jpg')).toEqual({ bucket: 'public', key: 'umkm-photos/a.jpg' });
    expect(petakanObjek('absensi-foto', '2026-11-02/x.jpg')).toEqual({ bucket: 'private', key: 'absensi-foto/2026-11-02/x.jpg' });
    expect(() => petakanObjek('lain', 'a')).toThrow(/tidak dikenal/);
    expect(() => petakanObjek('umkm-photos', '../a')).toThrow();
  });
  it('perluDisalin: lewati yang sudah ada dengan ukuran sama', () => {
    expect(perluDisalin(10, null)).toBe(true);
    expect(perluDisalin(10, { size: 10 })).toBe(false);
    expect(perluDisalin(10, { size: 9 })).toBe(true);
  });
  it('tulisUlangUrl hanya mengubah URL publik umkm-photos Supabase', () => {
    const base = 'https://pub.example.org';
    expect(tulisUlangUrl('https://p.supabase.co/storage/v1/object/public/umkm-photos/a.jpg', base)).toBe(`${base}/umkm-photos/a.jpg`);
    expect(tulisUlangUrl('https://satudata.umkm.go.id/x.jpg', base)).toBe('https://satudata.umkm.go.id/x.jpg');
    expect(tulisUlangUrl('https://p.supabase.co/storage/v1/object/public/investment-docs/a.png', base)).toBe('https://p.supabase.co/storage/v1/object/public/investment-docs/a.png');
  });
  it('ringkas menjumlahkan per bucket', () => {
    expect(ringkas([{ bucket: 'a', ukuran: 5 }, { bucket: 'a', ukuran: 7 }, { bucket: 'b', ukuran: 1 }])).toEqual({ a: { jumlah: 2, byte: 12 }, b: { jumlah: 1, byte: 1 } });
  });
});
