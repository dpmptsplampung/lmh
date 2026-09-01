// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RekapTiketDetailPanel from './RekapTiketDetailPanel';
import type { RekapTicketRow } from '@/lib/rekap/excel';

const baseRow: RekapTicketRow = {
  id: 't-1',
  nomor_display: 'A-001',
  tanggal: '2026-08-31',
  waktu_terbit: '2026-08-31T01:00:00Z',
  waktu_mulai_layan: '2026-08-31T01:05:00Z',
  waktu_selesai: '2026-08-31T01:20:00Z',
  status: 'selesai',
  kunjungan: { nama: 'Budi', asal: 'walk_in', qr_token: null },
  petugas: { nama: 'Andi' },
  form_type: 'oss',
  pelayanan_oss: {
    id: 'p-1',
    nama_pemohon: 'Budi',
    nama_usaha: 'Usaha A',
    tipe_pelaku_usaha: 'perseorangan',
    status_penanaman_modal: 'PMDN',
    lokasi_usaha: 'Bandar Lampung',
    skala_usaha: 'Mikro',
    sektor_usaha_kbli: '47111',
    tindak_lanjut: 'disposisi',
    uraian_solusi: 'Solusi X',
    catatan_internal: null,
  },
  pelayanan_perizinAN: null,
};

describe('RekapTiketDetailPanel', () => {
  afterEach(() => cleanup());

  it('renders nothing when tiket is null', () => {
    const { container } = render(<RekapTiketDetailPanel tiket={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders tiket header and basic fields', () => {
    render(<RekapTiketDetailPanel tiket={baseRow} onClose={() => {}} />);
    expect(screen.getByText(/A-001/)).toBeInTheDocument();
    // "Budi" appears in both Identitas section (kunjungan.nama) and OSS section (nama_pemohon)
    expect(screen.getAllByText(/Budi/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Andi/)).toBeInTheDocument();
  });

  it('renders OSS section when form_type is oss', () => {
    render(<RekapTiketDetailPanel tiket={baseRow} onClose={() => {}} />);
    expect(screen.getByText(/Usaha A/)).toBeInTheDocument();
    expect(screen.getByText(/PMDN/)).toBeInTheDocument();
  });

  it('calls onClose when X button clicked', () => {
    const onClose = vi.fn();
    render(<RekapTiketDetailPanel tiket={baseRow} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /tutup/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape pressed', () => {
    const onClose = vi.fn();
    render(<RekapTiketDetailPanel tiket={baseRow} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows "tidak ada pendataan" when no form_type', () => {
    const row: RekapTicketRow = { ...baseRow, form_type: null, pelayanan_oss: null, pelayanan_perizinAN: null };
    render(<RekapTiketDetailPanel tiket={row} onClose={() => {}} />);
    expect(screen.getByText(/tidak memiliki data pendataan/i)).toBeInTheDocument();
  });
});
