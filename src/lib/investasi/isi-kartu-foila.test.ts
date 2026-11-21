import { describe, expect, it } from 'vitest';
import { bersihkanHtml, petakanProyek, ringkas, SEKTOR_PER_SLUG, teksAlt, urlThumbnail } from '../../../scripts/isi-kartu-foila/lib.mjs';
import { iproFoilaSchema } from './skema';
import { KAB_KOTA_IPRO } from './konstanta';

const dasar = (slug: string, location: string) => ({
  slug, title: 'Judul Inggris', location, thumbnail: '1792-abc.png',
  description: '<p>English &amp; description.</p>',
  translations: { id: { title: 'Judul Indonesia', description: '<p>Deskripsi <strong>Indonesia</strong>&nbsp;proyek.</p>' }, en: { title: 'English Title', description: '<p>English text.</p>' } },
});

describe('isi kartu FOILA', () => {
  it('membersihkan HTML dan entitas', () => {
    expect(bersihkanHtml('<p>A&nbsp;&amp; <b>B</b></p><p>C</p>')).toBe('A & B C');
  });
  it('meringkas di batas kata dan tidak melewati 600', () => {
    const panjang = Array.from({ length: 200 }, (_, i) => `kata${i}`).join(' ');
    const r = ringkas(panjang);
    expect(r.length).toBeLessThanOrEqual(600);
    expect(r.endsWith('…')).toBe(true);
    expect(ringkas('pendek')).toBe('pendek');
  });
  it('setiap pemetaan lolos skema kartu FOILA aplikasi dan memakai kab/kota sah', () => {
    const lokasi = ['Bandar Lampung', 'Kabupaten Lampung Selatan', 'Kabupaten Lampung Timur', 'Kabupaten Tanggamus', 'Tulang Bawang'];
    const slug = Object.keys(SEKTOR_PER_SLUG as Record<string, string>);
    slug.forEach((s, i) => {
      const { thumbnail: _t, sumber_slug: _ss, ...baris } = petakanProyek(dasar(s, lokasi[i % lokasi.length]));
      void _t; void _ss;
      expect(KAB_KOTA_IPRO).toContain(baris.kab_kota);
      const r = iproFoilaSchema.safeParse({ ...baris, slug: baris.slug });
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    });
  });
  it('proyek lintas kabupaten memakai Lintas Kabupaten/Kota', () => {
    const b = petakanProyek(dasar('kawasan-wisata-terpadu-lampung-selatan-pesawaran-dan-tanggamus', 'Kabupaten Lampung Selatan'));
    expect(b.kab_kota).toBe('Lintas Kabupaten/Kota');
    expect(b.sumber_url).toBe('https://invest.lampungprov.go.id/project/kawasan-wisata-terpadu-lampung-selatan-pesawaran-dan-tanggamus');
  });
  it('menolak slug tanpa keputusan sektor dan lokasi tak dikenal', () => {
    expect(() => petakanProyek(dasar('proyek-baru', 'Bandar Lampung'))).toThrow(/Sektor belum diputuskan/);
    expect(() => petakanProyek(dasar('kawasan-industri-lampung-ii', 'Jawa'))).toThrow(/Lokasi FOILA/);
  });
  it('nama thumbnail dibatasi dan alt cukup panjang', () => {
    expect(() => urlThumbnail('../x.png')).toThrow();
    expect(urlThumbnail('1792-abc.png')).toBe('https://invest.lampungprov.go.id/backend/uploads/1792-abc.png');
    expect(teksAlt('Judul')).toBe('Foto proyek Judul');
  });
});
