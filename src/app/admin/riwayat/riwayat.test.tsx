// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));

import RiwayatPage from './page';
import { ringkasPerubahan } from '@/components/admin/riwayat/RiwayatTable';

const item = {
  id: 'a1', actor_id: 'p1', actor_role: 'admin', aksi: 'layanan_ubah', entitas: 'layanan', entitas_id: 'l1', detail: null,
  nilai_lama: { nomor_loket: '2' }, nilai_baru: { nomor_loket: '3' }, created_at: '2026-10-08T03:00:00Z',
  pelaku: { nama: 'Admin Satu', username: 'admin-satu' },
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: string) => {
    const ok = (b: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
    if (url === '/api/admin/petugas') return ok({ akun: [{ id: 'p1', nama: 'Admin Satu' }] });
    return ok({ items: [item], total: 1, page: 1, limit: 50 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(cleanup);

describe('riwayat perubahan', () => {
  it('menampilkan pelaku dan nilai lama → baru', async () => {
    render(<RiwayatPage />);
    expect(await screen.findByText('nomor_loket: 2 → 3')).toBeTruthy();
    expect(screen.getAllByText('Admin Satu').length).toBeGreaterThan(0);
    expect(screen.getByRole('note').textContent).toMatch(/Hanya Admin/);
  });

  it('filter dikirim sebagai query dan kembali ke halaman 1', async () => {
    render(<RiwayatPage />);
    await screen.findByText('nomor_loket: 2 → 3');
    fireEvent.change(screen.getByLabelText('Jenis'), { target: { value: 'layanan' } });
    fireEvent.change(await screen.findByLabelText('Pelaku'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Dari tanggal'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('jenis=layanan'))).toBe(true));
    const url = String(fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/admin/riwayat')).at(-1)![0]);
    expect(url).toContain('orang=p1');
    expect(url).toContain('dari=2026-10-01');
    expect(url).toContain('page=1');
  });

  it('keadaan kosong dan galat', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url === '/api/admin/petugas'
        ? { ok: true, json: () => Promise.resolve({ akun: [] }) }
        : { ok: false, json: () => Promise.resolve({ error: 'Tidak berhak' }) }));
    render(<RiwayatPage />);
    expect(await screen.findByText('Tidak berhak')).toBeTruthy();
  });

  it('ringkasPerubahan: insert, delete, dan nilai panjang dipotong', () => {
    expect(ringkasPerubahan(null, { nama: 'X' })).toEqual(['nama: — → X']);
    expect(ringkasPerubahan({ nama: 'X' }, null)).toEqual(['nama: X → —']);
    expect(ringkasPerubahan({ t: 'a'.repeat(200) }, { t: 'b' })[0].length).toBeLessThan(120);
    expect(ringkasPerubahan(null, null)).toEqual([]);
  });
});
