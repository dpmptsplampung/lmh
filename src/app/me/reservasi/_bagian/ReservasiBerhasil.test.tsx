// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/QRCode', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr">{value}</div>,
}));

import ReservasiBerhasil from './ReservasiBerhasil';

afterEach(cleanup);

describe('ReservasiBerhasil', () => {
  it('menampilkan QR dari token, tautan ke beranda, dan "Buat Reservasi Lain" memanggil callback', () => {
    const onBuatLagi = vi.fn();
    render(<ReservasiBerhasil qrToken={'a'.repeat(32)} onBuatLagi={onBuatLagi} />);
    expect(screen.getByTestId('qr')).toHaveTextContent('a'.repeat(32));
    expect(screen.getByRole('link', { name: 'Kembali ke Beranda saya' })).toHaveAttribute('href', '/me');
    expect(screen.getByText(/tersimpan di daftar Reservasi Saya/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Buat Reservasi Lain' }));
    expect(onBuatLagi).toHaveBeenCalled();
  });
});
