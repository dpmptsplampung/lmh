// @vitest-environment jsdom
// RBAC Tahap 0: bot hidup/mati (layanan.chatbot_aktif) = Admin saja.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  layananUpdate: vi.fn(),
  faqInsert: vi.fn(),
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
    b.insert = (values: unknown) => {
      h.faqInsert(table, values);
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
    h.faqInsert.mockClear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
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

describe('admin FAQ: petugas wajib menyatakan tanggung jawab (sekali per sesi)', () => {
  beforeEach(() => {
    h.faqInsert.mockClear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
  });
  afterEach(cleanup);

  const isiForm = async () => {
    fireEvent.change(await screen.findByLabelText(/Pertanyaan/), { target: { value: 'Syarat NIB?' } });
    fireEvent.change(screen.getByLabelText(/Jawaban/), { target: { value: 'KTP dan NPWP.' } });
  };

  it('petugas: tanpa centang, simpan ditolak; setelah dicentang tersimpan dan tidak ditanya lagi', async () => {
    h.state.role = 'petugas';
    const { container } = render(<AdminFAQPage />);
    await screen.findByText(/menjadi tanggung jawab Anda sebagai petugas/);
    await isiForm();
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    expect(await screen.findByText(/Centang pernyataan tanggung jawab/)).toBeTruthy();
    expect(h.faqInsert).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: /Saya memahami dan bertanggung jawab/ }));
    fireEvent.submit(form);
    await waitFor(() => expect(h.faqInsert).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('lmh_faq_tanggung_jawab')).toBe('1');
    await waitFor(() => expect(screen.queryByText(/menjadi tanggung jawab Anda sebagai petugas/)).toBeNull());
  });

  it('petugas: tombol hapus FAQ tidak tersedia', async () => {
    h.state.role = 'petugas';
    render(<AdminFAQPage />);
    expect(await screen.findByText(/Penghapusan permanen hanya oleh Admin/)).toBeTruthy();
  });

  it('admin: tidak ada peringatan dan simpan langsung', async () => {
    h.state.role = 'admin';
    const { container } = render(<AdminFAQPage />);
    await screen.findByRole('button', { name: /AKTIF \(On\)/ });
    expect(screen.queryByText(/menjadi tanggung jawab Anda sebagai petugas/)).toBeNull();
    await isiForm();
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(h.faqInsert).toHaveBeenCalledTimes(1));
  });
});
