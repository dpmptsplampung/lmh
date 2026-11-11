// @vitest-environment jsdom
// Pengaturan Website (site_settings): beranda publik membaca wa_number/contact_* dari cache server, jadi simpan yang
// BERHASIL harus membuang cache beranda (rencana 4.5); simpan yang gagal tidak boleh memanggilnya.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

type DbError = { message: string; code?: string };

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  segarkan: vi.fn(),
  upserts: [] as Array<{ rows: Array<{ key: string; value: string }>; opsi: Record<string, unknown> }>,
  state: {
    rows: [] as Array<{ key: string; value: string }>,
    selectError: null as DbError | null,
    upsertError: null as DbError | null,
  },
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/data/klien/segarkanPublik', async (impor) => ({
  ...(await impor<typeof import('@/lib/data/klien/segarkanPublik')>()),
  segarkanPublik: h.segarkan,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => Promise.resolve({ data: h.state.selectError ? null : h.state.rows, error: h.state.selectError }),
      upsert: (rows: Array<{ key: string; value: string }>, opsi: Record<string, unknown>) => {
        h.upserts.push({ rows, opsi });
        return Promise.resolve({ error: h.state.upsertError });
      },
    }),
  }),
}));

import AdminSettingsPage from './page';

const simpan = () => fireEvent.click(screen.getByRole('button', { name: /Simpan Pengaturan/i }));
const tungguForm = () => screen.findByLabelText(/Nomor WhatsApp/);

describe('Admin Pengaturan Website', () => {
  beforeEach(() => {
    h.toast.mockClear();
    h.segarkan.mockReset();
    h.upserts.length = 0;
    // URL FOILA wajib (required + type=url): isi agar validasi form native lolos.
    h.state.rows = [
      { key: 'foila_url', value: 'https://foila.example.go.id' },
      { key: 'wa_number', value: '6281234567890' },
    ];
    h.state.selectError = null;
    h.state.upsertError = null;
  });
  afterEach(cleanup);

  it('simpan berhasil: upsert enam kunci onConflict key, lalu segarkanPublik("publik-beranda") sekali', async () => {
    render(<AdminSettingsPage />);
    fireEvent.change(await tungguForm(), { target: { value: '6289999999999' } });
    simpan();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Pengaturan berhasil disimpan!', 'success'));
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0].opsi).toEqual({ onConflict: 'key' });
    expect(h.upserts[0].rows.map((r) => r.key)).toEqual([
      'foila_url', 'wa_number', 'wa_default_message', 'contact_address', 'contact_hours', 'contact_email',
    ]);
    expect(h.upserts[0].rows.find((r) => r.key === 'wa_number')?.value).toBe('6289999999999');
    expect(h.segarkan).toHaveBeenCalledTimes(1);
    expect(h.segarkan).toHaveBeenCalledWith('publik-beranda');
  });

  it('dipanggil SESUDAH upsert dikirim, bukan sebelum', async () => {
    render(<AdminSettingsPage />);
    await tungguForm();
    h.upserts.length = 0;
    let upsertSudahDikirim: boolean | null = null;
    h.segarkan.mockImplementation(() => {
      upsertSudahDikirim = h.upserts.length === 1;
    });
    simpan();
    await waitFor(() => expect(h.segarkan).toHaveBeenCalled());
    expect(upsertSudahDikirim).toBe(true);
  });

  it('simpan berhasil: hanya toast sukses (pembuangan cache tidak menambah toast apa pun)', async () => {
    render(<AdminSettingsPage />);
    await tungguForm();
    simpan();
    await waitFor(() => expect(h.segarkan).toHaveBeenCalled());
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith('Pengaturan berhasil disimpan!', 'success');
  });

  it('error DB saat simpan -> toast gagal, segarkanPublik TIDAK dipanggil', async () => {
    h.state.upsertError = { message: 'boom', code: 'XX000' };
    render(<AdminSettingsPage />);
    await tungguForm();
    simpan();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Gagal menyimpan pengaturan.', 'error'));
    expect(h.upserts).toHaveLength(1);
    expect(h.segarkan).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('gagal memuat pengaturan: tidak ada form untuk disimpan, segarkanPublik TIDAK dipanggil', async () => {
    h.state.selectError = { message: 'timeout', code: '57014' };
    render(<AdminSettingsPage />);
    expect(await screen.findByText('Gagal memuat pengaturan.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Simpan Pengaturan/i })).toBeNull();
    expect(h.upserts).toHaveLength(0);
    expect(h.segarkan).not.toHaveBeenCalled();
  });

  it('memuat saja (tanpa menyimpan) tidak membuang cache', async () => {
    render(<AdminSettingsPage />);
    await tungguForm();
    expect(h.segarkan).not.toHaveBeenCalled();
  });
});
