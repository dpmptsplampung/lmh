// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getSystemPrompt } from './gemini';

describe('getSystemPrompt', () => {
  it('allows greeting and general answers, escalates only when needed', () => {
    const p = getSystemPrompt('DPMPTSP Lampung');
    expect(p).toMatch(/sapaan|salam|halo/i);
    expect(p).toMatch(/eskalasi/i);
    expect(p).not.toMatch(/JANGAN PERNAH berspekulasi.*halo/i); // greeting must not be blocked
  });
});
