// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import StatistikProfil, { angkaRingkas } from './StatistikProfil';

afterEach(cleanup);

it.each([
  [0, '0'], [999, '999'], [1000, '1 rb'], [1999, '1,9 rb'], [999999, '999,9 rb'],
  [1999999, '1,9 jt'], [1999999999, '1,9 miliar'],
])('meringkas %s tanpa membulatkan ke atas', (value, expected) => {
  expect(angkaRingkas(value)).toBe(expected);
});

it('tetap menampilkan nol dan menyembunyikan Dilihat yang null', () => {
  render(<StatistikProfil suka={0} dilihat={null} baru={false} />);
  expect(screen.getByText('0 Suka', { selector: '.sr-only' })).toBeTruthy();
  expect(screen.queryByText(/Dilihat|Baru/)).toBeNull();
});
