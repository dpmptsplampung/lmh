// @vitest-environment jsdom
// FilterAntrian (tab saringan status).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FilterAntrian from './FilterAntrian';

afterEach(cleanup);

describe('FilterAntrian', () => {
  it('tiga tab dengan satu terpilih; memilih tab memanggil onGanti dengan kuncinya', () => {
    const onGanti = vi.fn();
    render(<FilterAntrian aktif="aktif" onGanti={onGanti} />);
    expect(screen.getByRole('tablist', { name: 'Saringan status antrean' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Aktif' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Selesai' })).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByRole('tab', { name: 'Semua' }));
    expect(onGanti).toHaveBeenCalledWith('semua');
  });

  it('tanpa prop layanan (Petugas): tidak ada pilihan Layanan', () => {
    render(<FilterAntrian aktif="aktif" onGanti={vi.fn()} />);
    expect(screen.queryByRole('combobox', { name: 'Layanan' })).toBeNull();
  });

  it('Admin/FO: pilihan Layanan dengan "Semua layanan"; memilih memanggil onGanti(id), kembali ke semua = null', () => {
    const onGanti = vi.fn();
    const layanan = { nilai: null, opsi: [{ id: 'l-1', nama: 'Helpdesk OSS' }, { id: 'l-2', nama: 'Non OSS' }], onGanti };
    const { rerender } = render(<FilterAntrian aktif="aktif" onGanti={vi.fn()} layanan={layanan} />);
    const pilih = screen.getByRole('combobox', { name: 'Layanan' }) as HTMLSelectElement;
    expect(pilih.value).toBe('');
    expect(Array.from(pilih.options).map((o) => o.text)).toEqual(['Semua layanan', 'Helpdesk OSS', 'Non OSS']);
    fireEvent.change(pilih, { target: { value: 'l-2' } });
    expect(onGanti).toHaveBeenLastCalledWith('l-2');
    rerender(<FilterAntrian aktif="aktif" onGanti={vi.fn()} layanan={{ ...layanan, nilai: 'l-2' }} />);
    expect((screen.getByRole('combobox', { name: 'Layanan' }) as HTMLSelectElement).value).toBe('l-2');
    fireEvent.change(screen.getByRole('combobox', { name: 'Layanan' }), { target: { value: '' } });
    expect(onGanti).toHaveBeenLastCalledWith(null);
  });
});
