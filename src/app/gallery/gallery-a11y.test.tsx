import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(join(process.cwd(), 'src/app/gallery/page.tsx'), 'utf8');
const CSS = readFileSync(join(process.cwd(), 'src/app/gallery/gallery.module.css'), 'utf8');

describe('gallery interactive controls a11y', () => {
  it('peta card is a button or link, not bare div onClick', () => {
    expect(PAGE).not.toMatch(/<div[^>]*className=\{styles\.petaCard\}[^>]*onClick/);
    expect(PAGE).toMatch(/<(button|a)[^>]*className=\{styles\.petaCard\}/);
  });

  it('FOILA success button uses darker green for contrast', () => {
    const foilaBlock = CSS.match(/\.foilaLinkBtn\s*\{[^}]+\}/)?.[0] ?? '';
    expect(foilaBlock).toBeTruthy();
    // white on #10b981 fails AA; darker greens pass with white text
    expect(foilaBlock).toMatch(/background:\s*(#047857|#059669|#065f46)/i);
  });

  it('tautan logo punya nama aksesibel dan grid kartu tidak melebihi lebar layar 320 px', () => {
    expect(PAGE).toMatch(/className=\{styles\.galleryNavBrand\}\s+aria-label="Lampung Maju Hub, ke beranda"/);
    expect(CSS.match(/\.iproGrid\s*\{[^}]+\}/)?.[0]).toMatch(/minmax\(min\(100%,\s*320px\),\s*1fr\)/);
  });
});
