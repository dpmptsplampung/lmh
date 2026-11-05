// Kontrak CSS murni (tanpa browser) untuk kartu layar TV. Menjaga akar P1 "isi kartu bertumpuk":
// lantai ukuran huruf (clamp dengan batas bawah rem/px), badan kartu yang boleh menyusut ke nol, dan
// pemotongan kartu. Pengukuran posisi nyata ada di kartuMuat.test.tsx (Chromium); ini berjalan di CI tanpa browser.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const berkas: Array<[string, string]> = [['/layar/[token]', 'src/app/layar/[token]/layar-token.module.css']];

type Blok = { selektor: string; isi: string };

/** Semua blok `selektor { deklarasi }`, termasuk yang bersarang di dalam @container. */
function bacaBlok(css: string): Blok[] {
  const tanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const hasil: Blok[] = [];
  for (const m of tanpaKomentar.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    hasil.push({ selektor: m[1].trim().replace(/^@container[^\n]*\{\s*/, ''), isi: m[2] });
  }
  return hasil;
}

const deklarasi = (isi: string, prop: string): string[] =>
  [...isi.matchAll(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`, 'g'))].map(m => m[1].trim());

const KELAS_ISI = ['.loketName', '.nomorLabel', '.nomorValue', '.antreLabel', '.antreValue'];

describe.each(berkas)('kontrak kartu TV %s', (_nama, jalur) => {
  const css = readFileSync(join(process.cwd(), jalur), 'utf8');
  const blok = bacaBlok(css);
  const untuk = (sel: string) => blok.filter(b => b.selektor.split(',').map(s => s.trim()).includes(sel));

  it('ukuran huruf isi kartu = min(Ncqh, Ncqw) tanpa lantai (tanpa clamp, rem, px, vw)', () => {
    let diperiksa = 0;
    for (const sel of KELAS_ISI) {
      for (const b of untuk(sel)) {
        for (const nilai of deklarasi(b.isi, 'font-size')) {
          diperiksa++;
          expect(nilai, `${sel} font-size`).toMatch(/^min\(\d+(\.\d+)?cqh,\s*\d+(\.\d+)?cqw\)$/);
        }
      }
    }
    expect(diperiksa).toBeGreaterThanOrEqual(5);
  });

  it('isi kartu berupa grid berbaris pecahan tetap (minmax(0, Nfr)), bukan flex yang boleh menyusut', () => {
    const isi = untuk('.loketIsi');
    expect(isi.length).toBeGreaterThan(0);
    expect(isi.some(b => /display:\s*grid/.test(b.isi))).toBe(true);
    const baris = blok.filter(b => /grid-template-rows:/.test(b.isi) && /\.loketIsi/.test(b.selektor));
    expect(baris.length).toBeGreaterThanOrEqual(1);
    for (const b of baris) {
      for (const nilai of deklarasi(b.isi, 'grid-template-rows')) {
        expect(nilai).toMatch(/^(minmax\(0,\s*\d+fr\)\s*)+$/);
      }
    }
  });

  it('tiap sel grid menahan isinya sendiri (min-height 0, overflow hidden) dan badan kartu tidak flex: 1', () => {
    const sel = blok.find(b => b.selektor.replace(/\s+/g, '') === '.loketIsi>*');
    expect(sel?.isi).toMatch(/min-height:\s*0/);
    expect(sel?.isi).toMatch(/overflow:\s*hidden/);
    for (const b of untuk('.loketBody')) expect(b.isi).not.toMatch(/flex:\s*1/);
  });

  it('kartu kecil beralih ke mode ringkas lewat @container dan label nomor disembunyikan', () => {
    expect(css).toMatch(/@container\s*\(max-height:\s*\d+px\)/);
    const sembunyi = blok.find(b => /display:\s*none/.test(b.isi) && b.selektor.includes('.nomorLabel'));
    expect(sembunyi).toBeTruthy();
  });

  it('nama layanan dibatasi dua baris dan tinggi maksimum, tidak menimpa bagian lain', () => {
    const nama = untuk('.loketName')[0];
    expect(nama.isi).toMatch(/line-clamp:\s*2/);
    expect(nama.isi).toMatch(/max-height:\s*2\.2em/);
  });

  it('kisi berpetak setengah kartu tanpa gap (jarak dari margin kartu) agar letak setengah petak tepat', () => {
    const grid = untuk('.grid')[0];
    expect(grid.isi).not.toMatch(/(^|[;\s])gap:/);
    expect(untuk('.loket')[0].isi).toMatch(/margin:\s*var\(--jarak\)/);
  });

  it('panggilan baru memakai bingkai lebih tebal, tetap terlihat ketika denyut dimatikan', () => {
    const biasa = /border:\s*(\d+)px/.exec(untuk('.loket')[0].isi);
    const dipanggil = /border-width:\s*(\d+)px/.exec(untuk('.loket.loketDipanggil')[0].isi);
    expect(biasa).not.toBeNull();
    expect(dipanggil).not.toBeNull();
    expect(Number(dipanggil?.[1])).toBeGreaterThan(Number(biasa?.[1]));
    expect(Number(dipanggil?.[1])).toBeGreaterThanOrEqual(4);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.loket\.loketDipanggil\s*\{\s*animation:\s*none/);
  });
});
