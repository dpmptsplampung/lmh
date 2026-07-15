// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

describe('service worker runtime cache safety', () => {
  it('bypasses every health endpoint before any response interception', () => {
    const bypass = source.indexOf("url.pathname.startsWith('/api/health/')");
    const firstRespondWith = source.indexOf('event.respondWith', source.indexOf("self.addEventListener('fetch'"));
    expect(bypass).toBeGreaterThan(-1);
    expect(bypass).toBeLessThan(firstRespondWith);
    expect(source.slice(bypass, firstRespondWith)).toMatch(/return\s*;/);
  });

  it('guards every runtime cache write against Cache-Control no-store', () => {
    expect(source).toMatch(/function isCacheableResponse[\s\S]*cache-control[\s\S]*no-store/);
    const cacheWrites = source.match(/cache\.put\(/g) ?? [];
    const guardedWrites = source.match(/isCacheableResponse\(fresh\)[\s\S]{0,80}cache\.put\(/g) ?? [];
    expect(cacheWrites.length).toBeGreaterThan(0);
    expect(guardedWrites).toHaveLength(cacheWrites.length);
  });
});
