// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import KoreksiPelayananModal from './KoreksiPelayananModal';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));

const data = {
  tiket_id: 't-1',
  nomor_display: 'A-001',
  form_type: 'oss',
  is_locked: true,
  data_oss: { nama_pemohon: 'Budi', nama_usaha: 'CV Lama', tindak_lanjut: 'Dipandu Mandiri', uraian_solusi: 'ok' },
};

describe('KoreksiPelayananModal', () => {
  const mockFetch = vi.fn();
  const original = global.fetch;
  const onClose = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
    toastMock.mockReset();
    onClose.mockReset();
    onSuccess.mockReset();
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => data });
  });
  afterEach(() => {
    cleanup();
    global.fetch = original;
  });

  const open = async () => {
    render(<KoreksiPelayananModal isOpen tiketId="t-1" onClose={onClose} onSuccess={onSuccess} />);
    return (await screen.findByLabelText(/Nama Usaha/i)) as HTMLInputElement;
  };
  const simpan = () => screen.getByRole('button', { name: /Simpan Koreksi/i });

  it('menampilkan nilai saat ini; tanpa alasan tidak mengirim', async () => {
    const usaha = await open();
    expect(usaha.value).toBe('CV Lama');
    fireEvent.change(usaha, { target: { value: 'CV Baru' } });
    fireEvent.click(simpan());
    expect(await screen.findByRole('alert')).toHaveTextContent(/Alasan koreksi wajib/i);
    expect(mockFetch).toHaveBeenCalledTimes(1); // hanya GET
  });

  it('tanpa perubahan ditolak; alasan kurang dari 5 huruf ditolak', async () => {
    const usaha = await open();
    fireEvent.change(screen.getByLabelText(/Alasan Koreksi/i), { target: { value: 'abc' } });
    fireEvent.click(simpan());
    expect(await screen.findByRole('alert')).toHaveTextContent(/Belum ada data yang diubah/i);
    fireEvent.change(usaha, { target: { value: 'CV Baru' } });
    fireEvent.click(simpan());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/minimal 5 huruf/i));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('PUT hanya berisi kolom yang berubah + alasan, lalu muat ulang & tutup', async () => {
    const usaha = await open();
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, perubahan: {} }) });
    fireEvent.change(usaha, { target: { value: 'CV Baru' } });
    fireEvent.change(screen.getByLabelText(/Uraian Solusi/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Alasan Koreksi/i), { target: { value: 'Salah ketik nama usaha' } });
    fireEvent.click(simpan());
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe('/api/admin/pelayanan/t-1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      perubahan: { nama_usaha: 'CV Baru', uraian_solusi: null },
      alasan: 'Salah ketik nama usaha',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('403 dan 422 menampilkan pesan jelas, modal tetap terbuka', async () => {
    const usaha = await open();
    fireEvent.change(usaha, { target: { value: 'CV Baru' } });
    fireEvent.change(screen.getByLabelText(/Alasan Koreksi/i), { target: { value: 'Salah ketik' } });

    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
    fireEvent.click(simpan());
    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak berwenang/i);

    mockFetch.mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: 'Nama usaha wajib diisi' }) });
    fireEvent.click(simpan());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Nama usaha wajib diisi'));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
