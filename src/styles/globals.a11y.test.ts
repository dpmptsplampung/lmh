import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(process.cwd(), 'src/styles/globals.css'), 'utf8');

describe('globals.css reduced motion', () => {
  it('disables non-essential motion when prefers-reduced-motion', () => {
    expect(CSS).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(CSS).toMatch(/scroll-behavior:\s*auto/);
    expect(
      /animation-duration:\s*0\.01ms|animation:\s*none/.test(CSS),
    ).toBe(true);
  });
});
