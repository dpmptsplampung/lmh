// @vitest-environment node
// /kebijakan-privasi adalah halaman statis: Server Component tanpa 'use client', gaya lewat modul CSS bertoken
// (rencana refaktor 4.4). Isi teks dijaga oleh kebijakan-privasi.test.tsx.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import KebijakanPrivasiPage from './page';

const baca = (nama: string) => readFileSync(join(process.cwd(), 'src/app/kebijakan-privasi', nama), 'utf8');
const SUMBER = baca('page.tsx');
const CSS = baca('kebijakan-privasi.module.css').replace(/\/\*[\s\S]*?\*\//g, '');

describe('kebijakan-privasi: server component statis', () => {
  it("page.tsx tanpa 'use client' dan tanpa hook/penanganan peristiwa", () => {
    expect(SUMBER).not.toMatch(/^\s*['"]use client['"]/m);
    expect(SUMBER).not.toMatch(/\buse(State|Effect|Memo|Callback|Ref|Router|SearchParams|Pathname)\b/);
    expect(SUMBER).not.toMatch(/\bon[A-Z]\w*=\{/);
  });

  it('tanpa inline style: semua gaya lewat kelas modul CSS', () => {
    expect(SUMBER).not.toMatch(/style=\{/);
  });

  it('setiap styles.<kelas> yang dipakai page.tsx terdefinisi di modul CSS', () => {
    const dipakai = new Set([...SUMBER.matchAll(/styles\.(\w+)/g)].map((m) => m[1]));
    expect(dipakai.size).toBeGreaterThan(0);
    const terdefinisi = new Set([...CSS.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));
    for (const kelas of dipakai) expect(terdefinisi.has(kelas), `kelas .${kelas} belum ada di modul CSS`).toBe(true);
  });

  it('modul CSS hanya memakai token (tanpa hex/rgb baru) dan tidak memakai z-index', () => {
    expect(CSS).toMatch(/var\(--/);
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CSS).not.toMatch(/\brgba?\(/);
    expect(CSS).not.toMatch(/z-index/);
  });

  it('dirender murni di server: judul, sembilan bagian, tautan ke beranda', () => {
    const html = renderToStaticMarkup(<KebijakanPrivasiPage />);
    expect(html).toMatch(/<h1[^>]*>\s*Kebijakan Privasi\s*<\/h1>/);
    expect(html.match(/<section\b/g)).toHaveLength(9);
    expect(html.match(/<h2\b/g)).toHaveLength(9);
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>\s*← Beranda\s*<\/a>/);
    expect(html).not.toContain('style=');
  });
});
