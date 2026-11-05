// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import StatusHariIni from './StatusHariIni';

afterEach(cleanup);

const ITEM = [{ kunci: 'a', nada: 'sukses' as const, label: 'Data terakhir 10.42 WIB' }];

describe('StatusHariIni', () => {
  it('menampilkan item status dan tautan Lihat antrean', () => {
    render(<StatusHariIni item={ITEM} adalahAdmin={false} />);
    expect(screen.getByText('Data terakhir 10.42 WIB')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lihat antrean' })).toHaveAttribute('href', '/admin/antrian');
  });

  it('Kelola layar TV hanya untuk Admin', () => {
    const { rerender } = render(<StatusHariIni item={ITEM} adalahAdmin={false} />);
    expect(screen.queryByRole('link', { name: 'Kelola layar TV' })).toBeNull();
    rerender(<StatusHariIni item={ITEM} adalahAdmin />);
    expect(screen.getByRole('link', { name: 'Kelola layar TV' })).toHaveAttribute('href', '/admin/layar');
  });
});
