// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PitaPanggilan from './PitaPanggilan';

const p = { id: '1', layanan_id: 'l1', nomor_display: 'OS-014', label: 'Label dari kejadian', dibuat_at: '2026-11-03T03:00:00Z' };

describe('PitaPanggilan', () => {
  afterEach(cleanup);

  it('tanpa panggilan: wadah live ada, tetapi tidak ada pita', () => {
    render(<PitaPanggilan panggilan={null} namaLayanan={() => undefined} />);
    expect(screen.getByTestId('pita-panggilan')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByText(/Antrean/)).not.toBeInTheDocument();
  });

  it('isi: "Antrean <nomor>, silakan ke <nama tampil>" tanpa kata Loket', () => {
    render(<PitaPanggilan panggilan={p} namaLayanan={() => 'Helpdesk OSS'} />);
    const wadah = screen.getByTestId('pita-panggilan');
    expect(wadah.textContent).toBe('Antrean OS-014 silakan ke Helpdesk OSS');
    expect(wadah.textContent).not.toMatch(/loket/i);
  });

  it('layanan tidak ada di layar: memakai label kejadian panggilan', () => {
    render(<PitaPanggilan panggilan={p} namaLayanan={() => undefined} />);
    expect(screen.getByText('silakan ke Label dari kejadian')).toBeInTheDocument();
  });

  it('tanpa nama tampil atau label: tetap mengarahkan ke layanan tanpa menyebut loket', () => {
    render(<PitaPanggilan panggilan={{ ...p, label: null }} namaLayanan={() => undefined} />);
    expect(screen.getByTestId('pita-panggilan')).toHaveTextContent('Antrean OS-014 silakan ke layanan');
    expect(screen.getByTestId('pita-panggilan')).not.toHaveTextContent(/loket/i);
  });
});
