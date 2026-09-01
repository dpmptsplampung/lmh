import { describe, it, expect } from 'vitest';
import { escapeIlikeWildcards } from './query';

describe('escapeIlikeWildcards', () => {
  it('escapes % and _', () => {
    expect(escapeIlikeWildcards('100%')).toBe('100\\%');
    expect(escapeIlikeWildcards('a_b')).toBe('a\\_b');
    expect(escapeIlikeWildcards('a%b_c')).toBe('a\\%b\\_c');
  });

  it('leaves normal chars unchanged', () => {
    expect(escapeIlikeWildcards('budi')).toBe('budi');
  });
});
