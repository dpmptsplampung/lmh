import { describe, expect, it } from 'vitest';
import { breadcrumbJsonLd, paragrafDari, potongDeskripsi, serialisasiJsonLd, urlMutlak } from './detail';

describe('potongDeskripsi', () => {
  it('teks pendek tetap; spasi dirapikan', () => {
    expect(potongDeskripsi('  satu   dua\n tiga ')).toBe('satu dua tiga');
  });
  it('teks panjang dipotong di batas kata dan diberi elipsis, tidak melebihi batas', () => {
    const hasil = potongDeskripsi('kata '.repeat(100), 160);
    expect(hasil.length).toBeLessThanOrEqual(160);
    expect(hasil.endsWith('…')).toBe(true);
    expect(hasil).not.toMatch(/\s…$/);
  });
});

describe('paragrafDari', () => {
  it('memisah di baris kosong dan membuang paragraf kosong', () => {
    expect(paragrafDari('A\nlanjut\n\n\nB\n\n  \nC')).toEqual(['A\nlanjut', 'B', 'C']);
    expect(paragrafDari(null)).toEqual([]);
    expect(paragrafDari('')).toEqual([]);
  });
});

describe('urlMutlak dan JSON-LD', () => {
  it('tanpa basis sah tidak menghasilkan URL maupun JSON-LD', () => {
    expect(urlMutlak(undefined, '/investasi')).toBeNull();
    expect(urlMutlak('bukan-url', '/investasi')).toBeNull();
    expect(urlMutlak('javascript:alert(1)', '/investasi')).toBeNull();
    expect(breadcrumbJsonLd(undefined, 'x', 'Judul')).toBeNull();
  });
  it('BreadcrumbList dua butir dengan URL mutlak, tanpa data pribadi', () => {
    const ld = breadcrumbJsonLd('https://lmh.example', 'wisata', 'Wisata Pesisir');
    expect(ld).toEqual({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Investasi', item: 'https://lmh.example/investasi' },
        { '@type': 'ListItem', position: 2, name: 'Wisata Pesisir', item: 'https://lmh.example/investasi/ipro/wisata' },
      ],
    });
  });
  it('serialisasi meng-escape < agar </script> tidak menutup tag', () => {
    const teks = serialisasiJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(teks).not.toContain('<');
    expect(teks).toContain('\\u003c/script');
    expect(JSON.parse(teks).name).toBe('</script><script>alert(1)</script>');
  });
});
