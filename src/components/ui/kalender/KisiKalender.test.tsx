// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KisiKalender, { type KisiKalenderProps } from './KisiKalender';

afterEach(cleanup);

function pasang(props: Partial<KisiKalenderProps> = {}) {
  const onFokus = vi.fn();
  const onPilih = vi.fn();
  const onSorot = vi.fn();
  render(<KisiKalender fokus="2026-11-04" hariIni="2026-11-04" onFokus={onFokus} onPilih={onPilih} onSorot={onSorot} {...props} />);
  return { onFokus, onPilih, onSorot };
}

const hari = (nama: string) => screen.getByRole('button', { name: new RegExp(`^${nama}`) });

describe('KisiKalender', () => {
  it('berpola grid: judul bulan, tujuh kepala kolom dari Senin, abbr nama panjang', () => {
    pasang();
    const grid = screen.getByRole('grid', { name: 'November 2026' });
    const kepala = within(grid).getAllByRole('columnheader');
    expect(kepala.map((k) => k.textContent)).toEqual(['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']);
    expect(kepala[0]).toHaveAttribute('abbr', 'Senin');
    // 30 hari, 1 Nov 2026 = Minggu.
    expect(within(grid).getAllByRole('gridcell').filter((c) => c.querySelector('button'))).toHaveLength(30);
  });

  it('hari ini ditandai lewat aria-current dan teks nama, hanya fokus yang bisa di-Tab', () => {
    pasang();
    const h = hari('4 November 2026');
    expect(h).toHaveAttribute('aria-current', 'date');
    expect(h).toHaveAttribute('aria-label', '4 November 2026, hari ini');
    expect(h).toHaveAttribute('tabindex', '0');
    expect(hari('5 November 2026')).toHaveAttribute('tabindex', '-1');
    expect(hari('5 November 2026')).not.toHaveAttribute('aria-current');
  });

  it('terpilih ditandai aria-selected pada selnya', () => {
    pasang({ terpilih: '2026-11-10' });
    expect(hari('10 November 2026').closest('td')).toHaveAttribute('aria-selected', 'true');
    expect(hari('11 November 2026').closest('td')).toHaveAttribute('aria-selected', 'false');
  });

  it('klik memilih; hari di luar min/max tidak memilih dan diberi keterangan teks', () => {
    const { onPilih } = pasang({ min: '2026-11-03', max: '2026-11-20' });
    fireEvent.click(hari('10 November 2026'));
    expect(onPilih).toHaveBeenCalledWith('2026-11-10');
    onPilih.mockClear();
    const luar = hari('2 November 2026');
    expect(luar).toHaveAttribute('aria-disabled', 'true');
    expect(luar).toHaveAttribute('aria-label', '2 November 2026, tidak tersedia');
    fireEvent.click(luar);
    fireEvent.click(hari('25 November 2026'));
    expect(onPilih).not.toHaveBeenCalled();
  });

  it('panah, Home/End, PageUp/PageDown, Shift+PageUp/PageDown menggeser fokus', () => {
    const { onFokus } = pasang();
    const h = hari('4 November 2026');
    const kirim = (key: string, shiftKey = false) => {
      onFokus.mockClear();
      fireEvent.keyDown(h, { key, shiftKey });
      return onFokus.mock.calls[0]?.[0];
    };
    expect(kirim('ArrowRight')).toBe('2026-11-05');
    expect(kirim('ArrowLeft')).toBe('2026-11-03');
    expect(kirim('ArrowDown')).toBe('2026-11-11');
    expect(kirim('ArrowUp')).toBe('2026-10-28');
    expect(kirim('Home')).toBe('2026-11-02');
    expect(kirim('End')).toBe('2026-11-08');
    expect(kirim('PageUp')).toBe('2026-10-04');
    expect(kirim('PageDown')).toBe('2026-12-04');
    expect(kirim('PageUp', true)).toBe('2025-11-04');
    expect(kirim('PageDown', true)).toBe('2027-11-04');
    expect(kirim('a')).toBeUndefined();
  });

  it('gerak papan ketik dijepit ke min/max', () => {
    const { onFokus } = pasang({ min: '2026-11-01', max: '2026-11-30' });
    fireEvent.keyDown(hari('4 November 2026'), { key: 'PageDown' });
    expect(onFokus).toHaveBeenLastCalledWith('2026-11-30');
    fireEvent.keyDown(hari('4 November 2026'), { key: 'PageUp' });
    expect(onFokus).toHaveBeenLastCalledWith('2026-11-01');
  });

  it('Enter dan Spasi memilih sekali; hari tidak tersedia tidak dipilih', () => {
    const { onPilih } = pasang({ max: '2026-11-04' });
    const h = hari('4 November 2026');
    fireEvent.keyDown(h, { key: 'Enter' });
    fireEvent.keyDown(h, { key: ' ' });
    expect(onPilih).toHaveBeenCalledTimes(2);
    expect(onPilih).toHaveBeenCalledWith('2026-11-04');
    onPilih.mockClear();
    fireEvent.keyDown(hari('10 November 2026'), { key: 'Enter' });
    expect(onPilih).not.toHaveBeenCalled();
  });

  it('tombol bulan berlabel, menggeser fokus sebulan, dan aria-disabled di ujung batas', () => {
    const { onFokus } = pasang({ min: '2026-11-01', max: '2027-01-31' });
    const mundur = screen.getByRole('button', { name: 'Bulan sebelumnya' });
    const maju = screen.getByRole('button', { name: 'Bulan berikutnya' });
    expect(mundur).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(mundur);
    expect(onFokus).not.toHaveBeenCalled();
    expect(maju).not.toHaveAttribute('aria-disabled');
    fireEvent.click(maju);
    expect(onFokus).toHaveBeenCalledWith('2026-12-04');
  });

  it('tepi bulan: 31 Januari ke Februari dipangkas, Desember ke Januari ganti tahun', () => {
    const { onFokus } = pasang({ fokus: '2027-01-31', hariIni: '2027-01-31' });
    fireEvent.click(screen.getByRole('button', { name: 'Bulan berikutnya' }));
    expect(onFokus).toHaveBeenLastCalledWith('2027-02-28');
    cleanup();
    const b = pasang({ fokus: '2026-12-15' });
    expect(screen.getByRole('grid', { name: 'Desember 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bulan berikutnya' }));
    expect(b.onFokus).toHaveBeenCalledWith('2027-01-15');
  });

  it('Februari kabisat memuat 29 hari', () => {
    pasang({ fokus: '2028-02-10', hariIni: '2028-02-10' });
    expect(hari('29 Februari 2028')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^30 Februari/ })).toBeNull();
  });

  it('rentang terikat: ujung diberi keterangan teks, hari di antaranya terpilih', () => {
    pasang({ rentang: { dari: '2026-11-03', sampai: '2026-11-06' } });
    expect(hari('3 November 2026')).toHaveAttribute('aria-label', '3 November 2026, awal rentang');
    expect(hari('6 November 2026')).toHaveAttribute('aria-label', '6 November 2026, akhir rentang');
    expect(hari('4 November 2026').closest('td')).toHaveAttribute('aria-selected', 'true');
    expect(hari('7 November 2026').closest('td')).toHaveAttribute('aria-selected', 'false');
  });

  it('rentang menunggu: hanya awal terpilih, pratinjau mengikuti sorot dan tidak ikut aria-selected', () => {
    const { onSorot } = pasang({ rentang: { dari: '2026-11-03', sampai: null }, sorot: '2026-11-07' });
    expect(hari('3 November 2026').closest('td')).toHaveAttribute('aria-selected', 'true');
    expect(hari('5 November 2026').closest('td')).toHaveAttribute('aria-selected', 'false');
    expect(hari('5 November 2026').closest('td')?.className).toMatch(/selDalam/);
    expect(hari('8 November 2026').closest('td')?.className).not.toMatch(/selDalam/);
    fireEvent.mouseEnter(hari('9 November 2026'));
    expect(onSorot).toHaveBeenCalledWith('2026-11-09');
    fireEvent.mouseLeave(screen.getByRole('grid'));
    expect(onSorot).toHaveBeenLastCalledWith(null);
  });

  it('rentang menunggu tanpa sorot memakai fokus papan ketik sebagai ujung pratinjau', () => {
    pasang({ fokus: '2026-11-06', rentang: { dari: '2026-11-03', sampai: null } });
    expect(hari('5 November 2026').closest('td')?.className).toMatch(/selDalam/);
  });

  it('fokus tidak valid tidak membuat crash', () => {
    pasang({ fokus: 'salah', hariIni: '2026-11-04' });
    expect(screen.getByRole('grid', { name: 'November 2026' })).toBeInTheDocument();
  });
});
