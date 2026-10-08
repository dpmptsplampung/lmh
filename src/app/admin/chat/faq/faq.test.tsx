// @vitest-environment jsdom
// RBAC Tahap 0: bot hidup/mati (layanan.chatbot_aktif) = Admin saja.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  layananUpdate: vi.fn(),
  state: {
    role: 'petugas' as string | null, // null = baris petugas tidak ditemukan
    updateResult: { data: [{ id: 'l1' }] as { id: string }[] | null, error: null as { message: string } | null },
  },
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => {
  const builder = (table: string) => {
    let op: 'select' | 'update' = 'select';
    const result = () => {
      if (table === 'layanan' && op === 'update') return h.state.updateResult;
      if (table === 'layanan') return { data: [{ id: 'l1', nama: 'Helpdesk OSS', chatbot_aktif: true }], error: null };
      return { data: [], error: null };
    };
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.update = (values: unknown) => {
      op = 'update';
      h.layananUpdate(table, values);
      return b;
    };
    b.maybeSingle = () =>
      Promise.resolve({ data: table === 'petugas' && h.state.role ? { role: h.state.role } : null });
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

import AdminFAQPage from './page';

describe('admin FAQ: toggle bot hanya untuk Admin', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.layananUpdate.mockClear();
    h.state.role = 'petugas';
    h.state.updateResult = { data: [{ id: 'l1' }], error: null };
  });
  afterEach(cleanup);

  it.each(['petugas', 'front_office'])('%s: status bot read-only, tanpa tombol toggle, dengan penjelasan', async (role) => {
    h.state.role = role;
    render(<AdminFAQPage />);
    expect(await screen.findByText(/Pengaturan bot dikelola Admin/)).toBeTruthy();
    expect(screen.getByText(/gunakan tombol Ambil alih di Live Chat/)).toBeTruthy();
    expect(screen.getByTestId('bot-status').textContent).toContain('AKTIF');
    expect(screen.queryByRole('button', { name: /AKTIF|NONAKTIF/ })).toBeNull();
    expect(h.layananUpdate).not.toHaveBeenCalled();
  });

  it('role tidak terbukti (baris petugas tidak ada): tolak dulu, tidak ada toggle', async () => {
    h.state.role = null;
    render(<AdminFAQPage />);
    expect(await screen.findByText(/Pengaturan bot dikelola Admin/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /AKTIF|NONAKTIF/ })).toBeNull();
    expect(h.layananUpdate).not.toHaveBeenCalled();
  });

  it('admin: tombol toggle ada dan memperbarui layanan.chatbot_aktif', async () => {
    h.state.role = 'admin';
    render(<AdminFAQPage />);
    const btn = await screen.findByRole('button', { name: /AKTIF \(On\)/ });
    expect(screen.queryByText(/Pengaturan bot dikelola Admin/)).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(h.layananUpdate).toHaveBeenCalledWith('layanan', { chatbot_aktif: false }));
    expect(await screen.findByRole('button', { name: /NONAKTIF \(Off\)/ })).toBeTruthy();
    expect(h.toast).toHaveBeenCalledWith('Status chatbot layanan berhasil diperbarui', 'success');
  });

  it('admin: update 0 baris (ditolak RLS diam-diam) -> galat jujur, status tidak berubah', async () => {
    h.state.role = 'admin';
    h.state.updateResult = { data: [], error: null };
    render(<AdminFAQPage />);
    fireEvent.click(await screen.findByRole('button', { name: /AKTIF \(On\)/ }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal memperbarui status chatbot'), 'error'),
    );
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
    expect(screen.getByRole('button', { name: /AKTIF \(On\)/ })).toBeTruthy();
  });
});
