// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import SpakPanel, { type SpakRow } from './SpakPanel';
import { PERTANYAAN_SPAK } from '@/lib/survei/pertanyaan';

afterEach(cleanup);

const baris = (sebagian: Partial<SpakRow> = {}): SpakRow => ({
  layanan_id: 'l-1',
  unit: 'layanan',
  nama: 'Helpdesk OSS',
  responden: 3,
  p1: 5.5,
  p2: 4,
  p3: '3.25',
  p4: 2.04,
  p5: 1,
  ...sebagian,
});

describe('SpakPanel', () => {
  it('menampilkan kelima pernyataan SPAK dengan teks lengkap (sekali saja)', () => {
    render(<SpakPanel rows={[baris()]} periodLabel="Bulan Ini" />);
    for (const p of PERTANYAAN_SPAK) {
      expect(screen.getAllByText(p.teks)).toHaveLength(1);
    }
    // Kolom tabel diberi kode pernyataan; teks lengkap tersedia sebagai title.
    for (const p of PERTANYAAN_SPAK) {
      const th = screen.getByRole('columnheader', { name: p.kunci.toUpperCase() });
      expect(th).toHaveAttribute('title', p.teks);
    }
  });

  it('rata-rata per pernyataan per unit dengan satu desimal', () => {
    render(<SpakPanel rows={[baris()]} periodLabel="Bulan Ini" />);
    const tr = screen.getByRole('row', { name: /Helpdesk OSS/ });
    const sel = within(tr).getAllByRole('cell').map((c) => c.textContent);
    expect(sel).toEqual(['Helpdesk OSS', '3', '5.5', '4.0', '3.3', '2.0', '1.0']);
  });

  it('menampilkan "—" bila unit tidak punya responden atau nilainya kosong', () => {
    render(
      <SpakPanel
        rows={[baris({ responden: 0, p1: null, p2: null, p3: null, p4: null, p5: null }), baris({ layanan_id: 'l-2', nama: 'Halal', p3: null })]}
        periodLabel="Bulan Ini"
      />,
    );
    const kosong = within(screen.getByRole('row', { name: /Helpdesk OSS/ })).getAllByRole('cell').map((c) => c.textContent);
    expect(kosong).toEqual(['Helpdesk OSS', '0', '—', '—', '—', '—', '—']);
    const sebagian = within(screen.getByRole('row', { name: /Halal/ })).getAllByRole('cell').map((c) => c.textContent);
    expect(sebagian[4]).toBe('—');
    expect(sebagian[3]).toBe('4.0');
  });

  it('baris Semua unit = rata-rata tertimbang jumlah responden', () => {
    render(
      <SpakPanel
        rows={[
          baris({ responden: 2, p1: 6, p2: 6, p3: 6, p4: 6, p5: 6 }),
          baris({ layanan_id: null, unit: 'fo', nama: 'Front Office', responden: 1, p1: 3, p2: 3, p3: 3, p4: 3, p5: 3 }),
          baris({ layanan_id: 'l-3', nama: 'Kosong', responden: 0, p1: null, p2: null, p3: null, p4: null, p5: null }),
        ]}
        periodLabel="Bulan Ini"
      />,
    );
    const tr = screen.getByRole('row', { name: /Semua unit/ });
    const sel = within(tr).getAllByRole('cell').map((c) => c.textContent);
    expect(sel).toEqual(['Semua unit', '3', '5.0', '5.0', '5.0', '5.0', '5.0']);
  });

  it('tanpa data: pesan kosong dan tanpa baris Semua unit', () => {
    render(<SpakPanel rows={[]} periodLabel="Bulan Ini" />);
    expect(screen.getByText(/Belum ada data SPAK/i)).toBeInTheDocument();
    expect(screen.queryByText('Semua unit')).not.toBeInTheDocument();
  });
});
