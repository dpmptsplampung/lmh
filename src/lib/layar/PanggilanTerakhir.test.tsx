// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import PanggilanTerakhir from './PanggilanTerakhir';

afterEach(cleanup);
describe('PanggilanTerakhir', () => {
  it('menampilkan nomor dan nama tampil empat kejadian, tanpa region pengumuman tambahan', () => {
    render(<PanggilanTerakhir riwayat={Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`, layanan_id: `l${i}`, nomor_display: `OS-00${i}`,
      label: 'Nama lama', dibuat_at: '2026-11-03T03:00:00Z',
    }))} namaLayanan={id => id === 'l0' ? 'OSS Terpadu' : undefined} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(within(screen.getAllByRole('listitem')[0]).getByText('OS-000')).toBeInTheDocument();
    expect(screen.getByText('OSS Terpadu')).toBeInTheDocument();
    expect(screen.getAllByText('Nama lama')).toHaveLength(3);
    expect(document.querySelector('[aria-live="polite"]')).toBeNull();
  });
  it('tetap menyediakan bilah riwayat saat kosong agar ukuran kisi layanan stabil', () => {
    render(<PanggilanTerakhir riwayat={[]} namaLayanan={() => undefined} />);
    expect(screen.getByRole('complementary', { name: 'Panggilan terakhir hari ini' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Panggilan terakhir' })).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(document.querySelector('[aria-live]')).toBeNull();
  });
});
