// @vitest-environment jsdom
// RBAC Tahap 0: jadwal & libur layanan dikelola Admin saja; FO & petugas hanya melihat.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  writes: vi.fn(),
  state: {
    role: 'petugas' as string,
    upsertError: null as { message: string } | null,
    deleteResult: { data: [{ id: 'x1' }] as { id: string }[], error: null as { message: string } | null },
  },
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => {
  const builder = (table: string) => {
    let op: 'select' | 'delete' = 'select';
    const result = () => {
      if (table === 'layanan') return { data: [{ id: 'l1', nama: 'Helpdesk OSS', is_ptsp: true }], error: null };
      if (table === 'layanan_libur' && op === 'delete') return h.state.deleteResult;
      if (table === 'layanan_libur')
        return { data: [{ id: 'x1', layanan_id: 'l1', tanggal: '2026-12-25', keterangan: 'Natal' }], error: null };
      return { data: [], error: null };
    };
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.upsert = (values: unknown) => {
      h.writes('upsert', table, values);
      return Promise.resolve({ error: h.state.upsertError });
    };
    b.insert = (values: unknown) => {
      h.writes('insert', table, values);
      return Promise.resolve({ error: null });
    };
    b.delete = () => {
      op = 'delete';
      h.writes('delete', table);
      return b;
    };
    b.maybeSingle = () => {
      if (table === 'petugas') return Promise.resolve({ data: { id: 'p1', role: h.state.role } });
      if (table === 'layanan_jadwal')
        return Promise.resolve({
          data: { layanan_id: 'l1', hari_kerja: [1, 2, 3], jam_buka: '08:00:00', jam_tutup: '15:00:00' },
        });
      return Promise.resolve({ data: null });
    };
    b.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise.resolve(result()).then(r, j);
    return b;
  };
  return {
    createClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      from: builder,
    }),
  };
});

import AdminJadwalPage from './page';

describe('admin jadwal: hanya Admin yang boleh mengubah', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.writes.mockClear();
    h.state.role = 'petugas';
    h.state.upsertError = null;
    h.state.deleteResult = { data: [{ id: 'x1' }], error: null };
  });
  afterEach(cleanup);

  it.each(['petugas', 'front_office'])('%s: banner read-only, semua kontrol edit nonaktif/tersembunyi', async (role) => {
    h.state.role = role;
    render(<AdminJadwalPage />);
    expect(await screen.findByText(/Jadwal ini ditetapkan Admin sesuai SOP dan jadwal resmi/)).toBeTruthy();
    expect(screen.getByText(/Hubungi Admin bila ada perubahan/)).toBeTruthy();
    // jadwal tetap terlihat
    expect((screen.getByLabelText(/Jam Tutup/) as HTMLInputElement).value).toBe('15:00');
    expect((screen.getByLabelText(/Jam Buka/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Jam Tutup/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Sen' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Simpan Jadwal/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tambah/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Hapus tanggal libur/ })).toBeNull();
    // klik hari kerja yang disabled tidak mengubah apa pun & tidak menulis
    fireEvent.click(screen.getByRole('button', { name: 'Sen' }));
    expect(h.writes).not.toHaveBeenCalled();
  });

  it('admin: tanpa banner, simpan jadwal memanggil upsert layanan_jadwal', async () => {
    h.state.role = 'admin';
    render(<AdminJadwalPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Simpan Jadwal/ }));
    await waitFor(() => expect(h.writes).toHaveBeenCalledWith('upsert', 'layanan_jadwal', expect.objectContaining({
      layanan_id: 'l1', jam_tutup: '15:00:00', updated_by: 'p1',
    })));
    expect(screen.queryByText(/Jadwal ini ditetapkan Admin/)).toBeNull();
    expect(h.toast).toHaveBeenCalledWith('Jadwal layanan disimpan.', 'success');
  });

  it('admin: simpan gagal -> galat, bukan sukses', async () => {
    h.state.role = 'admin';
    h.state.upsertError = { message: 'denied' };
    render(<AdminJadwalPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Simpan Jadwal/ }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Hanya Admin yang dapat mengubah jadwal'), 'error'),
    );
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('admin: hapus libur 0 baris (ditolak RLS diam-diam) -> galat jujur', async () => {
    h.state.role = 'admin';
    h.state.deleteResult = { data: [], error: null };
    render(<AdminJadwalPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Hapus tanggal libur/ }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Gagal menghapus tanggal libur.', 'error'));
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });
});
