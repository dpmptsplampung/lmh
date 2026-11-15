// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CatatanPembaruan from './CatatanPembaruan';

afterEach(cleanup);

describe('CatatanPembaruan', () => {
  it('menjelaskan pembaruan gagal; Muat ulang memanggil onMuatUlang', () => {
    const onMuatUlang = vi.fn();
    render(<CatatanPembaruan terakhir={null} menyegarkan={false} onMuatUlang={onMuatUlang} />);
    expect(screen.getByText(/Pembaruan terakhir gagal; data di bawah mungkin belum terbaru\./)).toBeInTheDocument();
    expect(screen.queryByText(/Terakhir diperbarui/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
    expect(onMuatUlang).toHaveBeenCalledTimes(1);
  });

  it('menyebut waktu terakhir berhasil (WIB) bila ada', () => {
    render(<CatatanPembaruan terakhir="2026-11-11T03:05:00Z" menyegarkan={false} onMuatUlang={vi.fn()} />);
    expect(screen.getByText(/Terakhir diperbarui .* WIB\./)).toBeInTheDocument();
  });

  it('sedang menyegarkan: tombol berlabel Memuat dan tidak memicu muat ulang ganda', () => {
    const onMuatUlang = vi.fn();
    render(<CatatanPembaruan terakhir={null} menyegarkan onMuatUlang={onMuatUlang} />);
    const tombol = screen.getByRole('button', { name: 'Memuat…' });
    expect(tombol).toBeDisabled();
    fireEvent.click(tombol);
    expect(onMuatUlang).not.toHaveBeenCalled();
  });
});
