// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import KelolaLayananPage from './page';

const lay = (o: Record<string, unknown>) => ({
  id: 'l1', nama: 'Helpdesk OSS', tipe: 'layanan', aktif: true, penyerta: false, status_tampilan: 'aktif',
  tampil_di_layar: true, punya_antrean: true, punya_chat: true, chatbot_aktif: true,
  nomor_loket: '2', prefiks_antrean: 'OSS', ...o,
});

let fetchMock: ReturnType<typeof vi.fn>;
function setup(bisaUbah: boolean) {
  fetchMock = vi.fn((url: string) => {
    const ok = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
    if (url === '/api/admin/layanan') return ok({ layanan: [lay({}), lay({ id: 'l2', nama: 'Bank Lampung', status_tampilan: 'coming_soon' })], bisa_ubah: bisaUbah });
    return ok({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
}
const patchCalls = () => fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH');
afterEach(cleanup);

describe('kelola layanan', () => {
  describe('Admin', () => {
    beforeEach(() => setup(true));

    it('menampilkan tabel, keterangan Admin, dan tombol ubah', async () => {
      render(<KelolaLayananPage />);
      expect(await screen.findByText('Bank Lampung')).toBeTruthy();
      expect(screen.getByRole('note').textContent).toMatch(/Admin/);
      expect(screen.getByText('Segera hadir')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Ubah Helpdesk OSS' })).toBeTruthy();
    });

    it('mengganti NAMA meminta konfirmasi dulu, baru mengirim PATCH', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ubah Helpdesk OSS' }));
      fireEvent.change(screen.getByLabelText('Nama layanan'), { target: { value: 'Helpdesk OSS Baru' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      expect(await screen.findByRole('alertdialog')).toBeTruthy();
      expect(patchCalls()).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Ya, ganti nama' }));
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(patchCalls()[0][0]).toBe('/api/admin/layanan/l1');
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ nama: 'Helpdesk OSS Baru' });
    });

    it('ubah non-nama tidak minta konfirmasi dan hanya mengirim field yang berubah', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Ubah Helpdesk OSS' }));
      fireEvent.change(screen.getByLabelText('Di halaman utama / daftar layanan'), { target: { value: 'nonaktif' } });
      fireEvent.click(screen.getByLabelText('Tampil di layar TV'));
      fireEvent.change(screen.getByLabelText('Prefiks antrean'), { target: { value: 'hd' } });
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ status_tampilan: 'nonaktif', tampil_di_layar: false, prefiks: 'HD' });
    });

    it('toggle bot memanggil endpoint /bot', async () => {
      render(<KelolaLayananPage />);
      fireEvent.click(await screen.findByRole('switch', { name: 'Bot Helpdesk OSS' }));
      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(patchCalls()[0][0]).toBe('/api/admin/layanan/l1/bot');
      expect(JSON.parse(patchCalls()[0][1].body)).toEqual({ aktif: false });
    });
  });

  it('Front Office: mode baca saja, tanpa tombol ubah maupun toggle bot', async () => {
    setup(false);
    render(<KelolaLayananPage />);
    expect(await screen.findByText('Bank Lampung')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/hanya untuk dilihat/);
    expect(screen.queryByRole('button', { name: /^Ubah/ })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
