// @vitest-environment jsdom
// Fase 4 (spec §7, Q46): pilihan topik di langkah selesai Helpdesk OSS / Non OSS. Formulir tetap tidak berubah.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import PelayananWizardModal from './PelayananWizardModal';

const { toastMock, topikHasil } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  topikHasil: { data: [] as unknown[], error: null as null | { code: string; message: string } },
}));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) b[m] = () => b;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ ...topikHasil }).then(res, rej);
      return b;
    },
  }),
}));

const DATA_OSS = {
  nama_usaha: 'Toko Rina', tipe_pelaku_usaha: 'perseorangan', status_penanaman_modal: 'tidak_ada', lokasi_usaha: 'Bandar Lampung',
  skala_usaha: 'Mikro', sektor_usaha_kbli: '47111', tindak_lanjut: 'Selesai di Loket (Tuntas)',
  uraian_solusi: 'NIB dibantu terbit.', catatan_internal: '-',
};
const dasar = (over: Record<string, unknown> = {}) => ({
  tiket_id: 't-1', legacy_visit_id: null, nomor_display: 'OS-001', layanan_id: 'l-oss', layanan_nama: 'Helpdesk OSS',
  form_type: 'oss', nama_pemohon: 'Rina', alamat_pemohon: 'Bandar Lampung', no_hp: '081234567890', email: 'rina@example.com',
  keperluan_awal: 'Mengurus NIB', status_tiket: 'dilayani', dilayani_oleh: 'p1', dilayani_oleh_nama: null, boleh_ubah: true,
  is_locked: false, status_draft: 'belum_diisi', dari_eskalasi: true, data_oss: { ...DATA_OSS }, ...over,
});

describe('PelayananWizardModal: topik di langkah selesai', () => {
  const mockFetch = vi.fn();
  const asli = global.fetch;
  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
    toastMock.mockReset();
    topikHasil.data = [{ id: 't1', nama: 'Konsultasi NIB', urut: 0 }, { id: 't2', nama: 'Lainnya', urut: 999 }];
    topikHasil.error = null;
  });
  afterEach(() => { cleanup(); global.fetch = asli; });

  const buka = async (over: Record<string, unknown> = {}) => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => dasar(over) });
    render(<PelayananWizardModal isOpen tiketId="t-1" onClose={vi.fn()} onSuccess={vi.fn()} />);
    await screen.findByDisplayValue('Rina');
    fireEvent.click(screen.getByRole('button', { name: /^3\./ }));
  };
  const posts = () => mockFetch.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');

  it('menampilkan pilihan topik layanan di langkah 3 (berlabel, wajib)', async () => {
    await buka();
    const sel = (await screen.findByLabelText('Topik penanganan')) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBe(3));
    expect(sel.getAttribute('aria-required')).toBe('true');
  });

  it('Layanan punya topik tetapi belum dipilih: galat role=alert dan tidak ada POST', async () => {
    await buka();
    const sel = (await screen.findByLabelText('Topik penanganan')) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBe(3));
    fireEvent.click(screen.getByRole('button', { name: /Selesaikan Antrian/i }));
    const alert = await screen.findByText('Topik penanganan wajib dipilih.');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(sel.getAttribute('aria-invalid')).toBe('true');
    expect(posts()).toHaveLength(0);
  });

  it('topik terpilih dikirim sebagai topik_id; isi formulir tetap sama', async () => {
    await buka();
    const sel = (await screen.findByLabelText('Topik penanganan')) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBe(3));
    fireEvent.change(sel, { target: { value: 't1' } });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    fireEvent.click(screen.getByRole('button', { name: /Selesaikan Antrian/i }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = JSON.parse((posts()[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ nama_usaha: 'Toko Rina', uraian_solusi: 'NIB dibantu terbit.', topik_id: 't1' });
    expect(body).not.toHaveProperty('catatan_penanganan');
  });

  it('tanpa topik aktif (atau gagal dimuat): tidak tampil, tidak wajib, topik_id tidak dikirim', async () => {
    topikHasil.data = [];
    await buka();
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    fireEvent.click(screen.getByRole('button', { name: /Selesaikan Antrian/i }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.queryByLabelText('Topik penanganan')).toBeNull();
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string)).not.toHaveProperty('topik_id');
  });

  it('baca-saja: tanpa pilihan topik', async () => {
    await buka({ boleh_ubah: false });
    expect(screen.queryByLabelText('Topik penanganan')).toBeNull();
  });
});
