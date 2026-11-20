import { describe, expect, it } from 'vitest';

import { pilihYatim, ringkasan, yatim } from '../../../scripts/bersihkan-raw-investasi/lib.mjs';

const UID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOC = '11111111-1111-4111-8111-111111111111';
const SEKARANG = Date.parse('2026-11-21T00:00:00Z');
const jam = (n: number) => new Date(SEKARANG - n * 3600_000);
const raw = `investment-docs/raw/${UID}/${DOC}.pdf`;

describe('sapu raw investasi', () => {
  it('memilih hanya raw sah yang lebih tua dari 24 jam', () => {
    expect(yatim({ key: raw, lastModified: jam(25) }, SEKARANG)).toBe(true);
    expect(yatim({ key: raw, lastModified: jam(23) }, SEKARANG)).toBe(false);
  });
  it('tidak pernah memilih src/, pages/, atau pola kunci tak sah', () => {
    for (const key of [`investment-docs/src/${DOC}.pdf`, `investment-docs/pages/${DOC}/1.png`, `investment-docs/raw/${DOC}.pdf`,
      `investment-docs/raw/${UID}/${DOC}.html`, `investment-docs/raw/../x.pdf`, `lain/raw/${UID}/${DOC}.pdf`]) {
      expect(yatim({ key, lastModified: jam(999) }, SEKARANG)).toBe(false);
    }
  });
  it('meringkas jumlah dan byte', () => {
    const t = pilihYatim([{ key: raw, lastModified: jam(30), ukuran: 2048 }, { key: `investment-docs/src/${DOC}.pdf`, lastModified: jam(30), ukuran: 9 }], SEKARANG);
    expect(ringkasan(t)).toEqual({ jumlah: 1, byte: 2048 });
  });
});
