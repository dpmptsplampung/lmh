// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

const { insertMock } = vi.hoisted(() => ({ insertMock: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) =>
      table === 'layanan'
        ? {
            select: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    { id: 'l-oss', nama: 'Helpdesk OSS' },
                    { id: 'l-samsat', nama: 'Samsat' },
                  ],
                }),
            }),
          }
        : { insert: insertMock },
  }),
}));

import WalkinWizard from './WalkinWizard';

async function openToStep2(fixedLayananId: string | null = null) {
  render(<WalkinWizard fixedLayananId={fixedLayananId} />);
  fireEvent.click(screen.getByRole('button', { name: /Registrasi Kunjungan Walk-in/i }));
  fireEvent.change(screen.getByLabelText(/Nama Lengkap/i), { target: { value: 'Budi' } });
  fireEvent.change(screen.getByLabelText(/Asal Instansi/i), { target: { value: 'PT Maju' } });
  fireEvent.click(screen.getByRole('button', { name: /Lanjut/i }));
  // daftar layanan dimuat async
  if (!fixedLayananId) await screen.findByRole('button', { name: /Helpdesk OSS/i });
}

const simpan = () => screen.getByRole('button', { name: /Simpan/i });

describe('WalkinWizard langkah 2 (layanan + keperluan)', () => {
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockResolvedValue({ error: null });
  });
  afterEach(cleanup);

  it.each([
    ['details LAYANAN_TUTUP', { message: 'x', details: 'LAYANAN_TUTUP' }],
    ['teks tutup pukul 16.00 WIB', { message: 'Layanan hari ini sudah tutup pukul 16.00 WIB.' }],
  ])('layanan tutup (%s) menampilkan pesan ramah', async (_n, err) => {
    insertMock.mockResolvedValueOnce({ error: err });
    await openToStep2();
    fireEvent.click(screen.getByRole('button', { name: /Helpdesk OSS/i }));
    fireEvent.change(screen.getByLabelText(/Keperluan/i), { target: { value: 'Urus NIB' } });
    fireEvent.click(simpan());
    expect(
      await screen.findByText('Layanan tutup pukul 16.00 WIB, buka kembali pada jam kerja berikutnya.'),
    ).toBeInTheDocument();
  });

  it('klik layanan hanya memilih: tidak submit dan tidak pindah langkah', async () => {
    await openToStep2();
    fireEvent.click(screen.getByRole('button', { name: /Helpdesk OSS/i }));
    expect(insertMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Keperluan/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Helpdesk OSS/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('fokus pindah ke kolom keperluan setelah memilih layanan', async () => {
    await openToStep2();
    fireEvent.click(screen.getByRole('button', { name: /Helpdesk OSS/i }));
    expect(screen.getByLabelText(/Keperluan/i)).toHaveFocus();
  });

  it('Simpan disabled sampai layanan terpilih DAN keperluan terisi (bukan spasi)', async () => {
    await openToStep2();
    expect(simpan()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Keperluan/i), { target: { value: 'Urus NIB' } });
    expect(simpan()).toBeDisabled(); // belum pilih layanan

    fireEvent.click(screen.getByRole('button', { name: /Helpdesk OSS/i }));
    expect(simpan()).toBeEnabled();

    fireEvent.change(screen.getByLabelText(/Keperluan/i), { target: { value: '   ' } });
    expect(simpan()).toBeDisabled();
  });

  it('Enter di kolom keperluan tidak mengirim data', async () => {
    await openToStep2();
    fireEvent.click(screen.getByRole('button', { name: /Helpdesk OSS/i }));
    const box = screen.getByLabelText(/Keperluan/i);
    fireEvent.change(box, { target: { value: 'Urus NIB' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.keyPress(box, { key: 'Enter', charCode: 13 });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('Simpan mengirim sekali (klik ganda tidak dobel) dengan keperluan ter-trim', async () => {
    await openToStep2();
    fireEvent.click(screen.getByRole('button', { name: /Helpdesk OSS/i }));
    fireEvent.change(screen.getByLabelText(/Keperluan/i), { target: { value: '  Urus NIB  ' } });
    const btn = simpan();
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      layanan_id: 'l-oss',
      keperluan: 'Urus NIB',
      nama: 'Budi',
    });
    await screen.findByText(/Registrasi Kunjungan Berhasil/i);
  });

  it('jalur petugas (layanan terkunci): keperluan tetap wajib', async () => {
    await openToStep2('l-samsat');
    expect(simpan()).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Helpdesk OSS/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Keperluan/i), { target: { value: 'Cek pajak' } });
    expect(simpan()).toBeEnabled();
    fireEvent.click(simpan());
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    expect(insertMock.mock.calls[0][0]).toMatchObject({ layanan_id: 'l-samsat', keperluan: 'Cek pajak' });
  });
});
