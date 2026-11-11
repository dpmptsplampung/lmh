// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import dasar from './token-peta.json';

/**
 * Peta token per lingkup (SPEC refaktor arsitektur-UI §3, rencana G3 tugas 3.1).
 *
 * `token-peta.json` adalah potret (karakterisasi) semua deklarasi `--x: nilai` pada berkas CSS global
 * SEBELUM token dipindah ke `src/styles/token.css`. Lingkup:
 *   root                    -> `:root` (tema publik)
 *   dasbor                  -> `:is(:root:has([data-tema="dasbor"]), [data-tema="dasbor"])` (tema dasbor)
 *   <lingkup> @media (...)  -> penimpaan di dalam media query
 *
 * Keputusan pemilik 2026-11-11: tema publik TETAP berbeda dari dasbor. Dua lingkup itu sengaja tidak
 * disatukan nilainya; yang disatukan hanya berkas sumbernya.
 *
 * Aturan: nama yang sudah ada tidak boleh berubah nilainya (kecuali tercatat di PERUBAHAN_DISENGAJA).
 * Nama baru hanya boleh muncul di lingkup `root` dan hanya bila nama itu sebelumnya ada di lingkup `dasbor`
 * (token semantik yang tadinya kosong di luar dasbor).
 */

const akar = resolve(__dirname, '../..');
const BERKAS_CSS_GLOBAL = ['src/styles/token.css', 'src/styles/globals.css', 'src/styles/tema-dasbor.css'];
const SELEKTOR_DASBOR = ':is(:root:has([data-tema="dasbor"]), [data-tema="dasbor"])';

type Peta = Record<string, Record<string, string>>;

/** Perubahan nilai yang disengaja: lingkup -> nama -> { dari, ke, alasan }. */
const PERUBAHAN_DISENGAJA: Record<string, Record<string, { dari: string; ke: string; alasan: string }>> = {
  dasbor: {
    '--text-tertiary': {
      dari: '#64748b',
      ke: '#5c6b82',
      alasan: 'Tugas 3.2: kontras 4,13:1 di kanvas gagal AA; nilai baru >= 4,5:1 di kanvas, surface, dan surface-muted.',
    },
  },
};

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function ukurPeta(berkas: string[]): { peta: Peta; perBerkas: Record<string, number> } {
  const peta: Peta = {};
  const perBerkas: Record<string, number> = {};
  for (const b of berkas) {
    const jalur = resolve(akar, b);
    if (!existsSync(jalur)) continue;
    perBerkas[b] = 0;
    postcss.parse(readFileSync(jalur, 'utf8')).walkDecls(/^--/, (d) => {
      const rule = d.parent as Rule;
      const sel = norm(rule.selector);
      const nama = sel === ':root' ? 'root' : sel === SELEKTOR_DASBOR ? 'dasbor' : `SELEKTOR LAIN: ${sel}`;
      const rantai: string[] = [];
      for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) {
        if (p.type === 'atrule') rantai.unshift(`@${(p as postcss.AtRule).name} ${norm((p as postcss.AtRule).params)}`);
      }
      const kunci = [nama, ...rantai].join(' ');
      (peta[kunci] ??= {})[d.prop] = norm(d.value);
      perBerkas[b]++;
    });
  }
  return { peta, perBerkas };
}

const { peta: sekarang, perBerkas } = ukurPeta(BERKAS_CSS_GLOBAL);
const lama = dasar as Peta;

describe('peta token per lingkup (karakterisasi)', () => {
  it('potret dasar memuat lingkup root dan dasbor', () => {
    expect(Object.keys(lama)).toEqual(expect.arrayContaining(['root', 'dasbor']));
    expect(Object.keys(lama.root).length).toBeGreaterThan(100);
    expect(Object.keys(lama.dasbor).length).toBeGreaterThan(100);
  });

  it('tidak ada deklarasi token di luar lingkup root dan dasbor', () => {
    expect(Object.keys(sekarang).filter((k) => k.startsWith('SELEKTOR LAIN'))).toEqual([]);
  });

  it('nilai setiap nama yang sudah ada per lingkup tidak berubah', () => {
    const beda: string[] = [];
    for (const [lingkup, daftar] of Object.entries(lama)) {
      for (const [nama, nilai] of Object.entries(daftar)) {
        const disengaja = PERUBAHAN_DISENGAJA[lingkup]?.[nama];
        const harapan = disengaja ? disengaja.ke : nilai;
        const kini = sekarang[lingkup]?.[nama];
        if (kini !== harapan) beda.push(`${lingkup} ${nama}: "${nilai}" -> ${kini === undefined ? 'HILANG' : `"${kini}"`}`);
      }
    }
    expect(beda).toEqual([]);
  });

  it('perubahan disengaja tercatat dengan nilai asal yang cocok dengan potret dasar', () => {
    for (const [lingkup, daftar] of Object.entries(PERUBAHAN_DISENGAJA)) {
      for (const [nama, p] of Object.entries(daftar)) {
        expect(lama[lingkup]?.[nama], `${lingkup} ${nama}`).toBe(p.dari);
        expect(p.alasan.length, `${lingkup} ${nama}`).toBeGreaterThan(10);
      }
    }
  });

  it('nama baru hanya di lingkup root dan hanya token semantik yang sebelumnya ada di dasbor', () => {
    const dariDasbor = new Set(Object.keys(lama.dasbor));
    const asing: string[] = [];
    for (const [lingkup, daftar] of Object.entries(sekarang)) {
      for (const nama of Object.keys(daftar)) {
        if (lama[lingkup]?.[nama] !== undefined) continue;
        if (lingkup !== 'root' || !dariDasbor.has(nama)) asing.push(`${lingkup} ${nama}`);
      }
    }
    expect(asing).toEqual([]);
  });

  it('tema publik tetap berbeda dari dasbor (keputusan pemilik 2026-11-11)', () => {
    expect(sekarang.root['--color-primary-600']).toBe('#4f46e5');
    expect(sekarang.dasbor['--color-primary-600']).toBe('#2563eb');
    expect(sekarang.root['--glass-blur']).toBe('16px');
    expect(sekarang.dasbor['--glass-blur']).toBe('0px');
    expect(sekarang.root['--text-link']).not.toBe(sekarang.dasbor['--text-link']);
  });
});

describe('satu berkas sumber token', () => {
  it('src/styles/token.css ada dan memuat kedua lingkup', () => {
    expect(existsSync(resolve(akar, 'src/styles/token.css'))).toBe(true);
    expect(perBerkas['src/styles/token.css']).toBeGreaterThan(200);
  });

  it('globals.css dan tema-dasbor.css tidak lagi mendefinisikan custom property', () => {
    expect(perBerkas['src/styles/globals.css']).toBe(0);
    expect(perBerkas['src/styles/tema-dasbor.css']).toBe(0);
  });

  it('semua var() di dalam token.css merujuk nama yang didefinisikan di token.css atau di luar (font Next)', () => {
    const teks = readFileSync(resolve(akar, 'src/styles/token.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const didefinisikan = new Set([...teks.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
    const DARI_NEXT_FONT = new Set(['--font-inter', '--font-jakarta']);
    const hilang = new Set<string>();
    for (const m of teks.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      if (!didefinisikan.has(m[1]) && !DARI_NEXT_FONT.has(m[1])) hilang.add(m[1]);
    }
    expect([...hilang]).toEqual([]);
  });
});
