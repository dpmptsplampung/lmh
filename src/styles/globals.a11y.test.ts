import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(process.cwd(), 'src/styles/globals.css'), 'utf8');

function blockFor(selector: string): string {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]+)\\}');
  return re.exec(CSS)?.[1] ?? '';
}

describe('globals.css touch targets and reduced motion', () => {
  it('ensures .btn has min 44x44 touch target', () => {
    const btn = blockFor('.btn');
    expect(btn).toMatch(/min-height:\s*44px/);
    expect(btn).toMatch(/min-width:\s*44px/);
  });

  it('ensures .btn--icon is at least 44x44', () => {
    const icon = blockFor('.btn--icon');
    expect(icon).toMatch(/min-width:\s*44px/);
    expect(icon).toMatch(/min-height:\s*44px/);
    expect(icon).not.toMatch(/width:\s*36px/);
    expect(icon).not.toMatch(/height:\s*36px/);
  });

  it('does not shrink mobile .btn below touch-friendly min size', () => {
    const btn = blockFor('.btn');
    expect(btn).toMatch(/min-height:\s*44px/);
    const mobile = /@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
    const mobileBtn = /\.btn\s*\{([^}]*)\}/.exec(mobile)?.[1] ?? '';
    if (mobileBtn) {
      expect(mobileBtn).not.toMatch(/min-height:\s*(3[0-9]|[12][0-9])px/);
    }
  });

  it('disables non-essential motion when prefers-reduced-motion', () => {
    expect(CSS).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(CSS).toMatch(/scroll-behavior:\s*auto/);
    expect(
      /animation-duration:\s*0\.01ms|animation:\s*none/.test(CSS),
    ).toBe(true);
  });
});
