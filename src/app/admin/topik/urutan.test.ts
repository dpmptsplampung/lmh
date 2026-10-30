import { describe, it, expect } from 'vitest';
import { bisaGeser, hitungGeser } from './urutan';

const D = [
  { id: 'a', urut: 1 },
  { id: 'b', urut: 2 },
  { id: 'c', urut: 5 },
  { id: 'z', urut: 99 },
];

describe('urutan topik', () => {
  it('menukar urut dua topik bertetangga', () => {
    expect(hitungGeser(D, 1, -1)).toEqual([{ id: 'b', urut: 1 }, { id: 'a', urut: 2 }]);
    expect(hitungGeser(D, 1, 1)).toEqual([{ id: 'b', urut: 5 }, { id: 'c', urut: 2 }]);
  });

  it('batas tepi dan topik terkunci (>= 99) tidak bergeser', () => {
    expect(bisaGeser(D, 0, -1)).toBe(false);
    expect(bisaGeser(D, 2, 1)).toBe(false);
    expect(bisaGeser(D, 3, -1)).toBe(false);
    expect(hitungGeser(D, 3, -1)).toEqual([]);
    expect(hitungGeser(D, 2, 1)).toEqual([]);
  });

  it('urut kembar: topik biasa dinomori ulang 1..n sesuai urutan baru, "Lainnya" tidak disentuh', () => {
    const kembar = [{ id: 'a', urut: 3 }, { id: 'b', urut: 3 }, { id: 'c', urut: 3 }, { id: 'z', urut: 99 }];
    expect(hitungGeser(kembar, 2, -1)).toEqual([{ id: 'a', urut: 1 }, { id: 'c', urut: 2 }]);
  });
});
