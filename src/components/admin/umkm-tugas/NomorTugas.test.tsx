// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NomorTugas from './NomorTugas';

const nomor = '081299998888';
const ok = () => ({ ok: true, json: async () => ({ data: { nomor } }) });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(async () => ok()); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('nomor privat per tugas', () => {
  it('membaca hanya setelah klik, tanpa cache atau penyimpanan browser, lalu bersih saat berpindah', async () => {
    const simpan = vi.spyOn(Storage.prototype, 'setItem');
    const view = render(<NomorTugas key="a" id="a" />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Lihat nomor' }));
    const node = await screen.findByText(nomor);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/umkm-tugas/a/kontak', expect.objectContaining({ method: 'POST', cache: 'no-store' }));
    view.rerender(<NomorTugas key="b" id="b" />);
    expect(node.textContent).toBe('');
    expect(screen.queryByText(nomor)).toBeNull();
    expect(simpan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Lihat nomor' }));
    await screen.findByText(nomor);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    view.unmount();
    simpan.mockRestore();
  });

  it('membatalkan permintaan dan membuang respons terlambat setelah keluar', async () => {
    let selesai!: (value: ReturnType<typeof ok>) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => { selesai = resolve; }));
    const view = render(<NomorTugas id="a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Lihat nomor' }));
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => selesai(ok()));
    render(<NomorTugas id="a" />);
    expect(screen.queryByText(nomor)).toBeNull();
  });

  it('membersihkan node saat meninggalkan halaman dan meminta ulang bila dibuka lagi', async () => {
    render(<NomorTugas id="a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Lihat nomor' }));
    const node = await screen.findByText(nomor);
    fireEvent(window, new Event('pagehide'));
    await waitFor(() => expect(node.textContent).toBe(''));
    expect(screen.queryByText(nomor)).toBeNull();
  });
});
