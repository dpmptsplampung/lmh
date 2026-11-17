// @vitest-environment jsdom
// Lihat Data baca-saja Pendataan Khusus (G5b): jawaban final + draf dari GET yang diaudit; state memuat, galat, kosong.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import LihatDataKhususModal from './LihatDataKhususModal';

const fetchMock = vi.fn();
const respons = (status: number, badan: unknown) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(badan) });
const dasar = {
  nama_pemohon: 'Rina Wati', layanan_nama: 'BPJS', dilayani_oleh_nama: 'Budi', status_tiket: 'dilayani',
  form_type: null, data_oss: null, data_perizinan: null, khusus: [], definisi_khusus: [], draf: null,
};
const tiket = { id: 'tk1', nomor_display: 'BP-007' };

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LihatDataKhususModal', () => {
  it('memanggil GET tiket dan menampilkan jawaban final berlabel terbaru, baca-saja (tanpa kolom isian)', async () => {
    fetchMock.mockReturnValue(respons(200, {
      ...dasar, status_tiket: 'selesai',
      khusus: [{ penanganan_id: 'p1', field_id: 'f1', label: 'Nomor Berkas', jenis: 'teks_singkat', nilai: 'KK-1', tersembunyi: false, urut: 0 }],
    }));
    render(<LihatDataKhususModal tiket={tiket} onClose={vi.fn()} />);
    expect(await screen.findByText('Nomor Berkas')).toBeInTheDocument();
    expect(screen.getByText('KK-1')).toBeInTheDocument();
    expect(screen.getByText(/Rina Wati/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/pelayanan/tk1');
  });

  it('menampilkan draf (belum final) dengan label dari definisi_khusus dan "Belum diisi"', async () => {
    fetchMock.mockReturnValue(respons(200, {
      ...dasar,
      definisi_khusus: [
        { id: 'f1', label: 'Nomor Berkas', jenis: 'teks_singkat', tersembunyi: false, urut: 0 },
        { id: 'f2', label: 'Setuju', jenis: 'ya_tidak', tersembunyi: false, urut: 1 },
      ],
      draf: { tiket_id: 'tk1', jawaban: { f1: 'DRAF-1' }, diubah_oleh: 'p1', updated_at: '2026-11-17T01:00:00Z' },
    }));
    render(<LihatDataKhususModal tiket={tiket} onClose={vi.fn()} />);
    expect(await screen.findByText('DRAF-1')).toBeInTheDocument();
    expect(screen.getByText('Belum final')).toBeInTheDocument();
    expect(screen.getByText('Belum diisi')).toBeInTheDocument();
  });

  it('tanpa jawaban maupun draf: keadaan kosong', async () => {
    fetchMock.mockReturnValue(respons(200, dasar));
    render(<LihatDataKhususModal tiket={tiket} onClose={vi.fn()} />);
    expect(await screen.findByText('Belum ada data pendataan')).toBeInTheDocument();
  });

  it('galat server (403): pesan role=alert dari server dan Coba lagi memuat ulang', async () => {
    fetchMock.mockReturnValueOnce(respons(403, { error: 'Anda tidak berhak melihat data ini' }));
    render(<LihatDataKhususModal tiket={tiket} onClose={vi.fn()} />);
    const alert = await screen.findByText('Anda tidak berhak melihat data ini');
    expect(alert.getAttribute('role')).toBe('alert');
    fetchMock.mockReturnValueOnce(respons(200, dasar));
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Belum ada data pendataan')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('galat jaringan: pesan generik; Tutup memanggil onClose', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const onClose = vi.fn();
    render(<LihatDataKhususModal tiket={tiket} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Gagal memuat data pendataan/));
    fireEvent.click(screen.getAllByRole('button', { name: 'Tutup' })[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
