// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import PageHeader from './PageHeader';

afterEach(cleanup);

describe('PageHeader', () => {
  it('kompatibel dengan pemakaian lama: title, description, children', () => {
    render(
      <PageHeader title="Antrean" description="Panggil dan layani pengunjung.">
        <button type="button">Registrasi Walk-in</button>
      </PageHeader>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Antrean' })).toBeInTheDocument();
    expect(screen.getByText('Panggil dan layani pengunjung.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrasi Walk-in' })).toBeInTheDocument();
  });

  it('hanya satu h1 dan tanpa elemen opsional bila tidak diberikan', () => {
    const { container } = render(<PageHeader title="Dashboard" />);
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(container.querySelector('p')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('meta tampil di bawah deskripsi', () => {
    render(<PageHeader title="Rekap" meta={<span>Menampilkan Perizinan saja</span>} />);
    expect(screen.getByText('Menampilkan Perizinan saja')).toBeInTheDocument();
  });

  it('kembali berupa tautan yang bisa dijangkau', () => {
    render(<PageHeader title="Detail layanan" kembali={{ href: '/admin/layanan', label: 'Kembali ke Layanan' }} />);
    expect(screen.getByRole('link', { name: 'Kembali ke Layanan' })).toHaveAttribute('href', '/admin/layanan');
  });
});
