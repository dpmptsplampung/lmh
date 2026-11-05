// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import StatusKosong from './StatusKosong';

afterEach(cleanup);

describe('StatusKosong', () => {
  it('judul berupa teks, ikon dekoratif, aksi tampil', () => {
    const { container } = render(
      <StatusKosong ikon={Inbox} judul="Belum ada kunjungan" isi="Data muncul setelah check-in." aksi={<button type="button">Registrasi</button>} />,
    );
    expect(screen.getByText('Belum ada kunjungan')).toBeInTheDocument();
    expect(screen.getByText('Data muncul setelah check-in.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrasi' })).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
