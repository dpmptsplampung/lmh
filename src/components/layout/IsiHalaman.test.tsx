// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import IsiHalaman from './IsiHalaman';

afterEach(cleanup);

const akar = resolve(__dirname, '../../..');
const baca = (relatif: string) => readFileSync(resolve(akar, relatif), 'utf8');
const tanpaKomentar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const urai = (blok: string) =>
  Object.fromEntries(
    blok
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const i = d.indexOf(':');
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
      }),
  );

describe('IsiHalaman: komponen', () => {
  it('membungkus anak tanpa menambah peran atau label', () => {
    const { container } = render(
      <IsiHalaman>
        <p>Isi pertama</p>
        <p>Isi kedua</p>
      </IsiHalaman>,
    );
    expect(screen.getByText('Isi pertama')).toBeInTheDocument();
    expect(screen.getByText('Isi kedua')).toBeInTheDocument();
    const pembungkus = container.firstElementChild as HTMLElement;
    expect(pembungkus.children).toHaveLength(2);
    expect(pembungkus).not.toHaveAttribute('role');
    expect(pembungkus).not.toHaveAttribute('aria-label');
  });

  it('lebar bawaan penuh; lebar baca ditandai pada elemen', () => {
    const { container, rerender } = render(<IsiHalaman>x</IsiHalaman>);
    expect(container.firstElementChild).toHaveAttribute('data-lebar', 'penuh');
    rerender(<IsiHalaman lebar="baca">x</IsiHalaman>);
    expect(container.firstElementChild).toHaveAttribute('data-lebar', 'baca');
    rerender(<IsiHalaman lebar="penuh">x</IsiHalaman>);
    expect(container.firstElementChild).toHaveAttribute('data-lebar', 'penuh');
  });
});

describe('IsiHalaman: kontrak CSS (padding dan lebar satu sumber)', () => {
  const css = tanpaKomentar(baca('src/components/layout/IsiHalaman.module.css'));
  const blokDasar = urai(css.match(/\.isi\s*\{([^}]*)\}/)?.[1] ?? '');
  const blokBaca = urai(css.match(/\.isi\[data-lebar=['"]baca['"]\]\s*\{([^}]*)\}/)?.[1] ?? '');

  it('padding hanya sisi kiri, kanan, dan bawah dari --pad-page', () => {
    expect(blokDasar.padding).toBe('0 var(--pad-page) var(--pad-page)');
  });

  it('lebar penuh dibatasi --content-max; kolom grid satu dan boleh menyusut', () => {
    expect(blokDasar['max-width']).toBe('var(--content-max)');
    expect(blokDasar['min-width']).toBe('0');
    expect(blokDasar.display).toBe('grid');
    expect(blokDasar['grid-template-columns']).toBe('minmax(0, 1fr)');
  });

  it('jarak antaranak memakai --gap-grid', () => {
    expect(blokDasar.gap).toBe('var(--gap-grid)');
  });

  it('lebar baca lebih sempit dari lebar penuh dan terpusat', () => {
    expect(blokBaca['max-width']).toMatch(/^\d+px$/);
    expect(Number.parseInt(blokBaca['max-width'], 10)).toBeLessThan(1440);
    expect(blokBaca['margin-inline'] ?? blokBaca.margin).toMatch(/auto/);
  });

  it('tanpa token baru, warna literal, atau z-index', () => {
    expect(css).not.toMatch(/^\s*--[\w-]+\s*:/m);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toMatch(/z-index/);
  });
});

describe('IsiHalaman: adopsi delapan halaman admin', () => {
  const HALAMAN: Array<{ dir: string; css: string[] }> = [
    { dir: 'kunjungan', css: ['kunjungan.module.css'] },
    { dir: 'absensi', css: ['absensi.module.css'] },
    { dir: 'petugas', css: ['petugas.module.css'] },
    { dir: 'pengaduan', css: ['pengaduan.module.css'] },
    { dir: 'rekap', css: ['rekap.module.css'] },
    { dir: 'layanan', css: ['page.dasbor.module.css'] },
    { dir: 'investasi-leads', css: ['investasi-leads.module.css', 'page.dasbor.module.css'] },
    { dir: 'profil', css: ['profil.module.css'] },
  ];

  it.each(HALAMAN)('$dir memakai IsiHalaman', ({ dir }) => {
    const sumber = baca(`src/app/admin/${dir}/page.tsx`);
    expect(sumber).toMatch(/import IsiHalaman from '@\/components\/layout\/IsiHalaman'/);
    expect(sumber).toMatch(/<IsiHalaman[\s>]/);
  });

  it.each(HALAMAN)('$dir tidak lagi menyimpan padding halaman di modul CSS-nya', ({ dir, css }) => {
    for (const berkas of css) {
      const isi = tanpaKomentar(baca(`src/app/admin/${dir}/${berkas}`));
      expect(isi, `${dir}/${berkas}`).not.toMatch(/--pad-page/);
      expect(isi, `${dir}/${berkas}`).not.toMatch(/max-width:\s*var\(--content-max/);
    }
  });

  it('badan cangkang admin tidak menambah padding horizontal', () => {
    const css = tanpaKomentar(baca('src/app/admin/admin.module.css'));
    const luarCetak = css.slice(0, css.indexOf('@media print'));
    const aturan = [...luarCetak.matchAll(/\.adminBody\s*\{([^{}]*)\}/g)].map((m) => urai(m[1]));
    expect(aturan.length).toBeGreaterThan(0);
    for (const a of aturan) {
      if (a.padding) expect(a.padding).toMatch(/^var\(--space-\d+\)\s+0$/);
      expect(a['padding-left']).toBeUndefined();
      expect(a['padding-right']).toBeUndefined();
      expect(a['padding-inline']).toBeUndefined();
    }
  });
});
