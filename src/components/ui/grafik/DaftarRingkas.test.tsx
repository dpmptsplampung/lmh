// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DaftarRingkas from './DaftarRingkas';

afterEach(cleanup);

const ITEM = [
  { kunci: '1', judul: 'Pengaduan PGD-001', deskripsi: 'Pelayanan lambat', waktu: '09.15', lencana: { nada: 'peringatan' as const, label: 'Baru' }, href: '/admin/pengaduan' },
  { kunci: '2', judul: 'Saran SRN-004', waktu: '08.40' },
];

describe('DaftarRingkas', () => {
  it('daftar item dengan lencana bertulisan, waktu, dan tautan', () => {
    render(<DaftarRingkas judul="Aktivitas terbaru" item={ITEM} lihatSemua={{ href: '/admin/pengaduan', label: 'Semua pengaduan' }} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Baru')).toBeInTheDocument();
    expect(screen.getByText('09.15')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pengaduan PGD-001/ })).toHaveAttribute('href', '/admin/pengaduan');
    expect(screen.getByRole('link', { name: 'Semua pengaduan' })).toBeInTheDocument();
  });
  it('kosong menggantikan daftar dan menyembunyikan Lihat semua', () => {
    render(<DaftarRingkas judul="Aktivitas" item={[]} kosong={<p>Tidak ada aktivitas</p>} lihatSemua={{ href: '/x' }} />);
    expect(screen.getByText('Tidak ada aktivitas')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('memuat menampilkan kerangka', () => {
    render(<DaftarRingkas judul="Aktivitas" item={[]} memuat />);
    expect(screen.getByText('Memuat Aktivitas')).toBeInTheDocument();
  });
});
