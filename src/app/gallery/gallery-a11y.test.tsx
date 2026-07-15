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
});
