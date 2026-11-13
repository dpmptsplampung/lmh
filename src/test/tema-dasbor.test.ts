// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const akar = resolve(__dirname, '../..');
// Token ada di satu berkas (token.css); tema-dasbor.css hanya berisi aturan elemen/komponen.
const tema = readFileSync(resolve(akar, 'src/styles/tema-dasbor.css'), 'utf8');
const token = readFileSync(resolve(akar, 'src/styles/token.css'), 'utf8');
const globals = readFileSync(resolve(akar, 'src/styles/globals.css'), 'utf8');
const layout = readFileSync(resolve(akar, 'src/app/layout.tsx'), 'utf8');

const MULAI = '/* TOKEN:MULAI */';
const SELESAI = '/* TOKEN:SELESAI */';
const blokToken = token.slice(token.indexOf(MULAI), token.indexOf(SELESAI));
// tema-dasbor.css tidak lagi memuat token: seluruh isinya adalah "di luar blok token".
const luarToken = tema;

/** Token :root lama yang SENGAJA diwarisi dari lingkup publik token.css (tidak diganti tema). */
const SENGAJA_DIWARISI = [
  // Aksen, sukses, peringatan, bahaya: "tidak diubah" (SISTEM-DESAIN §2.2)
  '--color-accent-50', '--color-accent-100', '--color-accent-200', '--color-accent-300',
  '--color-accent-400', '--color-accent-500', '--color-accent-600', '--color-accent-700',
  '--color-success-50', '--color-success-100', '--color-success-500', '--color-success-600', '--color-success-700',
  '--color-warning-50', '--color-warning-500', '--color-warning-600',
  '--color-danger-50', '--color-danger-100', '--color-danger-500', '--color-danger-600', '--color-danger-700',
  // Skala netral Tailwind-slate: nilainya sama dengan yang dipakai tema
  '--color-neutral-0', '--color-neutral-50', '--color-neutral-100', '--color-neutral-200', '--color-neutral-300',
  '--color-neutral-400', '--color-neutral-500', '--color-neutral-600', '--color-neutral-700', '--color-neutral-800',
  '--color-neutral-900', '--color-neutral-950',
  // Tipografi: Inter tetap, skala ukuran dan spasi tetap
  '--font-sans', '--font-display', '--font-mono',
  '--text-xs', '--text-sm', '--text-base', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl', '--text-4xl', '--text-5xl',
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--space-10',
  '--space-12', '--space-16', '--space-20', '--space-24',
  // Gerak, lapisan z, dan ukuran tata letak lama: tidak berubah
  '--transition-fast', '--transition-base', '--transition-slow', '--transition-spring',
  '--z-dropdown', '--z-sticky', '--z-modal', '--z-overlay', '--z-toast',
  '--header-height', '--max-content-width',
];

function blokRoot(css: string): string {
  const awal = css.indexOf(':root {');
  if (awal < 0) throw new Error(':root tidak ditemukan');
  return css.slice(awal, css.indexOf('\n}', awal));
}

function namaToken(css: string): string[] {
  return [...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]);
}

/** Peta token -> nilai; kemunculan pertama menang (blok dasar mendahului media query). */
function petaToken(css: string): Map<string, string> {
  const peta = new Map<string, string>();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    if (!peta.has(m[1])) peta.set(m[1], m[2].trim());
  }
  return peta;
}

const petaTema = petaToken(blokToken);
const petaGlobals = petaToken(blokRoot(token));

function selesaikan(nilai: string, kedalaman = 0): string {
  if (kedalaman > 10) throw new Error(`var() melingkar: ${nilai}`);
  const m = nilai.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (!m) return nilai;
  const berikut = petaTema.get(m[1]) ?? petaGlobals.get(m[1]);
  if (!berikut) throw new Error(`token ${m[1]} tidak terdefinisi`);
  return selesaikan(berikut, kedalaman + 1);
}

function warna(token: string): string {
  const nilai = selesaikan(token.startsWith('#') ? token : (petaTema.get(token) ?? petaGlobals.get(token) ?? ''));
  if (!/^#[0-9a-f]{6}$/i.test(nilai)) throw new Error(`${token} bukan heksadesimal 6 digit: "${nilai}"`);
  return nilai;
}

function luminans(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function kontras(a: string, b: string): number {
  const la = luminans(warna(a));
  const lb = luminans(warna(b));
  const [terang, gelap] = la >= lb ? [la, lb] : [lb, la];
  return (terang + 0.05) / (gelap + 0.05);
}

describe('tema-dasbor: cakupan dan token', () => {
  it('memasang cakupan K2 dan color-scheme light', () => {
    expect(blokToken).toContain(':root:has([data-tema="dasbor"])');
    expect(blokToken).toContain('[data-tema="dasbor"]');
    expect(blokToken).toMatch(/color-scheme:\s*light;/);
  });

  it('(a) setiap token :root lama punya nilai di cakupan atau tercantum sebagai sengaja diwarisi', () => {
    const lama = [...new Set(namaToken(blokRoot(token)))];
    expect(lama.length).toBeGreaterThan(100);
    const diTema = new Set(namaToken(blokToken));
    const hilang = lama.filter((n) => !diTema.has(n) && !SENGAJA_DIWARISI.includes(n));
    expect(hilang).toEqual([]);
  });

  it('daftar "sengaja diwarisi" tidak basi dan tidak tumpang tindih dengan tema', () => {
    const lama = new Set(namaToken(blokRoot(token)));
    const diTema = new Set(namaToken(blokToken));
    expect(SENGAJA_DIWARISI.filter((n) => !lama.has(n))).toEqual([]);
    expect(SENGAJA_DIWARISI.filter((n) => diTema.has(n))).toEqual([]);
  });

  it('mengulang --sidebar-width: 0px untuk lebar <= 1024px di dalam cakupan', () => {
    expect(blokToken).toMatch(
      /@media \(max-width: 1024px\)\s*\{\s*:is\(:root:has\(\[data-tema="dasbor"\]\), \[data-tema="dasbor"\]\)\s*\{[^}]*--sidebar-width:\s*0px;/,
    );
  });

  it('memakai nilai pratinjau yang menggantikan SISTEM-DESAIN', () => {
    expect(warna('--bg-canvas')).toBe('#eceff4');
    expect(petaTema.get('--radius-panel')).toBe('20px');
    expect(warna('--nav-active-bg')).toBe('#0f131b');
    expect(warna('--nav-badge-bg')).toBe('#6a4fe0');
    expect(warna('--color-primary-600')).toBe('#2563eb');
  });

  it('nama token kontrak (SISTEM-DESAIN §2.2) semuanya ada', () => {
    const wajib = [
      '--bg-canvas', '--bg-surface', '--bg-surface-muted', '--bg-surface-hover', '--border-subtle',
      '--nav-fg', '--nav-fg-hover', '--nav-bg-hover', '--nav-active-bg', '--nav-active-fg', '--nav-badge-bg',
      '--nav-badge-fg', '--nav-group-label', '--radius-button', '--radius-card', '--radius-panel',
      '--shadow-card', '--shadow-card-hover', '--shadow-panel', '--shadow-overlay', '--focus-ring',
      '--gap-grid', '--pad-card', '--pad-page', '--fs-page-title', '--fs-card-title', '--fs-kpi',
      '--fs-table-head', '--fs-body', '--sidebar-panel-width', '--sidebar-gap', '--sidebar-width',
      '--drawer-width', '--appbar-height', '--content-max', '--chart-1', '--chart-2', '--chart-3',
      '--chart-4', '--chart-5', '--chart-6', '--chart-compare', '--chart-grid', '--chart-axis',
      '--chart-bar-muted', '--chart-target', '--trend-up-fg', '--trend-down-fg', '--trend-flat-fg',
      ...['success', 'warning', 'danger', 'info', 'neutral'].flatMap((s) => [
        `--status-${s}-fg`, `--status-${s}-bg`, `--status-${s}-border`,
      ]),
    ];
    const diTema = new Set(namaToken(blokToken));
    expect(wajib.filter((n) => !diTema.has(n))).toEqual([]);
  });

  it('alias kaca menjadi datar (blur 0, tanpa bayangan glow)', () => {
    expect(petaTema.get('--glass-blur')).toBe('0px');
    expect(petaTema.get('--shadow-glow')).toBe('none');
    expect(selesaikan(petaTema.get('--glass-bg') as string)).toBe(warna('--bg-surface'));
  });
});

describe('tema-dasbor: kontras WCAG AA (dihitung dari nilai token)', () => {
  const teks: Array<[string, string]> = [
    ['--text-primary', '--bg-canvas'],
    ['--text-primary', '--bg-surface'],
    ['--text-primary', '--bg-surface-muted'],
    ['--text-primary', '--bg-surface-hover'],
    ['--text-secondary', '--bg-canvas'],
    ['--text-secondary', '--bg-surface'],
    ['--text-secondary', '--bg-surface-muted'],
    ['--text-secondary', '--bg-surface-hover'],
    ['--text-tertiary', '--bg-canvas'],
    ['--text-tertiary', '--bg-surface'],
    ['--text-tertiary', '--bg-surface-muted'],
    ['--text-tertiary', '--bg-surface-hover'],
    ['--text-on-primary', '--color-primary-600'],
    ['--text-on-primary', '--color-primary-700'],
    ['--text-link', '--bg-surface'],
    ['--text-link', '--bg-canvas'],
    ['--color-primary-700', '--color-primary-50'],
    ['--color-primary-700', '--color-primary-100'],
    ['--nav-fg', '--bg-surface'],
    ['--nav-fg-hover', '--nav-bg-hover'],
    ['--nav-active-fg', '--nav-active-bg'],
    ['--nav-badge-fg', '--nav-badge-bg'],
    ['--nav-group-label', '--bg-surface'],
    ['--chart-axis', '--bg-surface'],
    ['--status-danger-fg', '--bg-surface'],
    ...['success', 'warning', 'danger', 'info', 'neutral'].map(
      (s): [string, string] => [`--status-${s}-fg`, `--status-${s}-bg`],
    ),
  ];

  it.each(teks)('teks %s di atas %s >= 4,5:1', (fg, bg) => {
    expect(kontras(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  const bukanTeks: Array<[string, string]> = [
    ['--border-focus', '--bg-surface'],
    ['--border-focus', '--bg-canvas'],
    ['--color-primary-500', '--bg-surface'],
    ['--color-primary-300', '--nav-active-bg'],
    ['--chart-1', '--bg-surface'],
    ['--chart-2', '--bg-surface'],
    ['--chart-3', '--bg-surface'],
    ['--chart-4', '--bg-surface'],
    ['--chart-5', '--bg-surface'],
    ['--chart-6', '--bg-surface'],
    ['--chart-compare', '--bg-surface'],
    ['--chart-target', '--bg-surface'],
    ['--color-neutral-500', '--bg-surface'], // latar saklar mati
  ];

  it.each(bukanTeks)('non-teks %s di atas %s >= 3:1', (fg, bg) => {
    expect(kontras(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it('(b) --text-tertiary tidak dipasang pada kanvas, body, atau elemen yang bisa berada di luar kartu', () => {
    const aturan = [...luarToken.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1], isi: m[2] }));
    const pakaiTersier = aturan.filter((a) => /color:\s*var\(--text-tertiary\)/.test(a.isi));
    // Hanya permukaan putih: tabel, kepala tabel
    for (const a of pakaiTersier) {
      expect(a.sel, `selektor ${a.sel.trim()}`).toMatch(/\.table/);
    }
    const kanvas = aturan.filter((a) => /background(-color)?:\s*var\(--bg-canvas\)/.test(a.isi));
    expect(kanvas.length).toBeGreaterThan(0);
    for (const a of kanvas) expect(a.isi).not.toMatch(/--text-tertiary/);
  });
});

describe('token z-index: skala berurutan (kontrak di kepala token.css)', () => {
  const angka = (n: string) => Number(petaGlobals.get(n));
  it('dropdown < sticky < modal < overlay < toast, semuanya >= 1000', () => {
    const urut = ['--z-dropdown', '--z-sticky', '--z-modal', '--z-overlay', '--z-toast'].map(angka);
    expect(urut.every((n) => Number.isInteger(n) && n >= 1000)).toBe(true);
    expect([...urut].sort((x, y) => x - y)).toEqual(urut);
    expect(new Set(urut).size).toBe(urut.length);
  });

  it('toast tetap di atas modal dan gerbang layar penuh', () => {
    expect(angka('--z-toast')).toBeGreaterThan(angka('--z-overlay'));
    expect(angka('--z-toast')).toBeGreaterThan(angka('--z-modal'));
    const toast = readFileSync(resolve(akar, 'src/components/Toast.module.css'), 'utf8');
    expect(toast).toMatch(/z-index:\s*var\(--z-toast/);
  });

  it('tema dasbor tidak menimpa skala z-index', () => {
    expect([...petaTema.keys()].filter((n) => n.startsWith('--z-'))).toEqual([]);
  });
});

describe('tema-dasbor: aturan berkas', () => {
  it('(c) tidak ada prefers-color-scheme (tanpa mode gelap)', () => {
    expect(tema).not.toMatch(/prefers-color-scheme/);
    expect(tema).not.toMatch(/color-scheme:\s*dark/);
  });

  it('(d) globals.css tidak berisi selektor [data-tema] (tidak tersentuh)', () => {
    expect(globals).not.toMatch(/\[data-tema/);
    expect(globals).not.toMatch(/tema-dasbor/);
  });

  it('(e) tanpa warna heksadesimal di luar blok token', () => {
    expect(blokToken.length).toBeGreaterThan(1000);
    expect(luarToken.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    // komentar menyebut #laporan-cetak (id), itu bukan warna: sudah lolos karena huruf non-heksa
  });

  it('(f) layout.tsx mengimpor token.css paling awal, lalu globals.css, lalu tema; tanpa dependensi atau font baru', () => {
    const iToken = layout.indexOf('import "@/styles/token.css"');
    const iGlobals = layout.indexOf('import "@/styles/globals.css"');
    const iTema = layout.indexOf('import "@/styles/tema-dasbor.css"');
    expect(iToken).toBeGreaterThan(-1);
    expect(iGlobals).toBeGreaterThan(iToken);
    expect(iTema).toBeGreaterThan(iGlobals);
    expect(token).not.toMatch(/@import|@font-face|url\(/);
    expect(tema).not.toMatch(/@import|@font-face|url\(/);
  });

  it('semua selektor di luar blok token tercakup (kecuali body:has dan cakupan itu sendiri)', () => {
    const tanpaKomentar = luarToken.replace(/\/\*[\s\S]*?\*\//g, '');
    const selektor = [...tanpaKomentar.matchAll(/(^|[}{])\s*([^{}@]+)\{/g)]
      .map((m) => m[2].trim())
      .filter(Boolean);
    expect(selektor.length).toBeGreaterThan(50);
    const tercakup = /^(:where\(:root:has\(\[data-tema="dasbor"\]\), \[data-tema="dasbor"\]\)|body:has\(\[data-tema="dasbor"\]\)|\[data-tema="dasbor"\]|:is\(:root:has\(\[data-tema="dasbor"\]\), \[data-tema="dasbor"\]\))/;
    const lolos = selektor.flatMap((s) => s.split(/,\s*(?![^(]*\))/)).map((s) => s.trim());
    expect(lolos.filter((s) => !tercakup.test(s))).toEqual([]);
  });

  it('menimpa semua kelas global yang dijanjikan (SISTEM-DESAIN §3.2)', () => {
    const kelas = [
      '.card', '.card--interactive', '.glass', '.glass--strong', '.badge',
      '.badge--menunggu', '.badge--selesai', '.badge--draft', '.badge--pending', '.badge--published',
      '.badge--nonaktif', '.badge--aktif', '.badge--bot', '.badge--eskalasi', '.table', '.table-wrapper',
      '.stat-card', '.stat-card__icon', '.stat-card__value', '.stat-card__label', '.form-label',
      '.form-input', '.input', '.form-select', '.form-textarea', '.form-hint', '.form-error', '.saklar',
      '.empty-state', '.empty-state__icon', '.empty-state__title', '.skeleton',
      '.section__title', '.grid-stats', '.grid-cards',
    ];
    const hilang = kelas.filter((k) => !luarToken.includes(`) ${k}`));
    expect(hilang).toEqual([]);
  });

  it('toast memakai CSS Module dan atribut data-toast; tema tidak menyisakan kelas global mati', () => {
    expect(luarToken).not.toMatch(/\.toast(?:-container|--[a-z]+)?\b/);
    const komponen = readFileSync(resolve(akar, 'src/components/Toast.tsx'), 'utf8');
    expect(komponen).toContain('Toast.module.css');
    expect(komponen).toContain('data-toast');
    const modul = readFileSync(resolve(akar, 'src/components/Toast.module.css'), 'utf8');
    expect(modul).toContain('var(--toast-bg)');
    expect(modul).toContain('var(--toast-garis)');
  });

  it('kartu tanpa blur', () => {
    const kartu = luarToken.match(/\) \.card \{([^}]*)\}/)?.[1] ?? '';
    expect(kartu).toContain('backdrop-filter: none');
    expect(kartu).toContain('var(--radius-card)');
  });

  it('(A18) layar sentuh: tombol, item menu, baris aksi >= 44px dan isian 16px', () => {
    const blok = luarToken.slice(luarToken.indexOf('@media (pointer: coarse)'));
    expect(blok).toMatch(/min-height:\s*var\(--target-sentuh\)/);
    expect(blok).toContain('[role="menuitem"]');
    expect(blok).toContain('.aksi-baris');
    expect(blok).toMatch(/font-size:\s*16px/);
    expect(warna('--bg-surface')).toBeTruthy();
    expect(petaTema.get('--target-sentuh')).toBe('44px');
  });

  it('(A20) cetak: sembunyikan sidebar, bilah atas, toast, tombol; kartu tanpa bayangan; tautan tanpa URL', () => {
    const cetak = luarToken.slice(luarToken.indexOf('@media print'));
    for (const s of ['aside', 'nav[aria-label="Menu admin"]', '[data-cetak="sembunyi"]', '[data-toast]', 'button', '[role="button"]']) {
      expect(cetak).toContain(s);
    }
    expect(cetak).toMatch(/display:\s*none/);
    expect(cetak).toMatch(/box-shadow:\s*none/);
    expect(cetak).toMatch(/a\[href\]::after\s*\{\s*content:\s*none/);
    expect(cetak).not.toMatch(/attr\(href\)/);
  });

  it('(A20) halaman cetak Pesan Perilaku tetap menang: tombol di #laporan-cetak dikecualikan dan tidak ada !important', () => {
    const cetak = luarToken.slice(luarToken.indexOf('@media print'));
    expect(cetak).toContain(':not(#laporan-cetak *)');
    expect(cetak).not.toMatch(/visibility/);
    expect(cetak).not.toMatch(/!important/);
    const halaman = readFileSync(resolve(akar, 'src/app/admin/pesan-perilaku/cetak/page.tsx'), 'utf8');
    expect(halaman).toMatch(/<article\b[^>]*\bid=["']laporan-cetak["']/);
  });

  it('(G3) penyembunyian cetak mengalahkan kelas CSS Module sidebar, app bar, alat, dan toast tanpa bergantung urutan impor', () => {
    const cetak = luarToken.slice(luarToken.indexOf('@media print'));
    const aturan = [...cetak.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const tersembunyi = aturan.filter((m) => /display:\s*none\s*;/.test(m[2]));
    // :where bernilai nol: aside kalah terhadap .sidebar dan atribut seri dengan .bar.
    // :is menambahkan kekhususan cakupan (termasuk cadangan tanpa :has).
    const cakupan = ':is(:root:has([data-tema="dasbor"]), [data-tema="dasbor"])';
    for (const target of ['aside', '[data-cetak="sembunyi"]', '[data-toast]']) {
      expect(tersembunyi.some((m) => m[1].includes(`${cakupan} ${target}`)), target).toBe(true);
    }
    const appbar = readFileSync(resolve(akar, 'src/components/layout/AppBar.tsx'), 'utf8');
    expect(appbar).toMatch(/<header\b[^>]*data-cetak="sembunyi"/);
    const sesi = readFileSync(resolve(akar, 'src/components/layout/SesiStafGuard.tsx'), 'utf8');
    expect(sesi).toMatch(/<div\b[^>]*className=\{styles.banner\}[^>]*data-cetak="sembunyi"/);
  });

  it('(G3) cangkang cetak menghapus ruang sidebar dan app bar serta membuka seluruh lebar isi untuk semua laporan admin', () => {
    const cangkang = readFileSync(resolve(akar, 'src/app/admin/admin.module.css'), 'utf8');
    const cetak = cangkang.match(/@media print\s*\{([\s\S]*)\}/)?.[1] ?? '';
    const aturan = [...cetak.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const kelas of ['.adminLayout', '.adminContent', '.adminBody']) {
      const reset = aturan.filter((m) => m[1].split(',').some((s) => s.trim() === kelas)).map((m) => m[2]).join('\n');
      for (const deklarasi of [/display:\s*block\s*;/, /width:\s*100%\s*;/, /max-width:\s*none\s*;/, /min-height:\s*0\s*;/, /margin:\s*0\s*;/, /padding:\s*0\s*;/]) {
        expect(reset, kelas).toMatch(deklarasi);
      }
    }
    const kertas = readFileSync(resolve(akar, 'src/app/admin/pesan-perilaku/cetak/cetak.module.css'), 'utf8');
    expect(kertas.slice(kertas.indexOf('@media print'))).toMatch(/\.kertas\s*\{[^}]*max-width:\s*none;[^}]*width:\s*100%;/);
  });

  it('gerak mati saat prefers-reduced-motion', () => {
    const blok = luarToken.slice(luarToken.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(blok).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(blok).toMatch(/transition-duration:\s*0\.01ms !important/);
    expect(blok).toMatch(/\.skeleton\s*\{\s*animation:\s*none/);
  });

  it('fokus dua lapis: outline biru + celah, dan cincin terang di atas pil gelap', () => {
    expect(luarToken).toMatch(/:focus-visible \{[^}]*outline:\s*2px solid var\(--focus-color\)[^}]*box-shadow:\s*0 0 0 2px var\(--bg-surface\)/);
    expect(luarToken).toMatch(/\[aria-current="page"\]:focus-visible[^{]*\{[^}]*--color-primary-300/);
    expect(petaTema.get('--focus-ring')).toMatch(/0 0 0 2px var\(--bg-surface\), 0 0 0 4px var\(--color-primary-600\)/);
  });
});
