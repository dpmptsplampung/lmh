// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Penjaga lokal untuk CSS publik investasi: anggaran global hanya mengawasi angka total, jadi berkas ini dijaga satu per satu.
const BERKAS = [
  'src/components/investasi/investasi.module.css',
  'src/components/investasi/kerangka.module.css',
  'src/components/investasi/dokumen.module.css',
  'src/components/investasi/penampil.module.css',
  'src/app/gallery/gallery.module.css',
  'src/app/investasi/investasi.module.css',
  'src/app/investasi/ipro/[slug]/detail.module.css',
];
const kode = (b: string) => readFileSync(join(process.cwd(), b), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe.each(BERKAS)('%s', berkas => {
  const css = kode(berkas);
  it('tanpa warna tertulis langsung (hex/rgb)', () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(css.match(/\brgba?\(/g) ?? []).toEqual([]);
  });
  it('tanpa z-index >= 100 (hanya var(--z-*) bila perlu)', () => {
    expect([...css.matchAll(/z-index\s*:\s*(\d+)/g)].filter(m => Number(m[1]) >= 100)).toEqual([]);
  });
  it('titik putus hanya 640/1024/1280', () => {
    const lebar = [...css.matchAll(/@media[^{]*/g)].flatMap(media => [...media[0].matchAll(/(?:max|min)-width\s*:\s*(\d+)px/g)].map(m => Number(m[1])));
    expect(lebar.filter(n => ![640, 1024, 1280].includes(n))).toEqual([]);
  });
  it('token hanya yang terdefinisi di token.css atau di berkas ini', () => {
    const token = readFileSync(join(process.cwd(), 'src/styles/token.css'), 'utf8');
    const ada = new Set([...token.matchAll(/(--[\w-]+)\s*:/g), ...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
    // Token lokal kerangka (--inv-*) dipakai turun-temurun dari .kerangka.
    const kerangka = readFileSync(join(process.cwd(), 'src/components/investasi/kerangka.module.css'), 'utf8');
    for (const m of kerangka.matchAll(/(--[\w-]+)\s*:/g)) ada.add(m[1]);
    const dipakai = [...css.matchAll(/var\(\s*(--[\w-]+)\s*[,)]/g)].map(m => m[1]);
    expect(dipakai.filter(n => !ada.has(n))).toEqual([]);
  });
});
