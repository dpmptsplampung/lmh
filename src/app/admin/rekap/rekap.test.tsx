// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div><h1>{title}</h1>{children}</div>
  ),
}));
const params = vi.hoisted(() => ({ nilai: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => params.nilai }));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import AdminRekapPage from './page';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

const LINGKUP = {
  label: 'Hanya data yang Anda tangani sendiri.',
  opsi_layanan: [],
  unit_opsi: ['fo'],
};

function rute(map: Record<string, unknown>) {
  mockFetch.mockImplementation((url: string) => {
    const bagian = new URL(url, 'http://x').searchParams.get('bagian') ?? '';
    const isi = map[bagian];
    if (isi instanceof Response) return Promise.resolve(isi);
    return json(isi ?? {});
  });
}

describe('/admin/rekap (terpadu)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    params.nilai = new URLSearchParams();
  });
  afterEach(() => cleanup());

  it('menampilkan lingkup, definisi dilayani, tiga bagian, dan tanpa tombol Rollup', async () => {
    rute({
      lingkup: LINGKUP,
      harian: {
        rows: [{ tanggal: '2026-10-20', unit: 'fo', layanan_id: null, layanan_nama: null, tatap_muka: 2, live_chat: 1, jumlah: 3 }],
        ringkasan: { jumlah: 3, tatap_muka: 2, live_chat: 1, per_unit: [] },
      },
    });
    render(<AdminRekapPage />);
    expect(await screen.findByText(/Hanya data yang Anda tangani sendiri/)).toBeInTheDocument();
    expect(screen.getByText(/Dilayani = tahap pelayanan berstatus selesai/)).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Rekap Harian', 'Data Pelayanan', 'Kinerja Petugas']);
    expect(await screen.findByText('20/10/2026')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Front Office' })).toBeInTheDocument();
    expect(screen.queryByText(/Rollup/i)).not.toBeInTheDocument();
    // FO biasa: hanya satu unit -> tanpa pilihan Unit/Layanan.
    expect(screen.queryByLabelText('Unit')).not.toBeInTheDocument();
  });

  it('?bagian=data&unit=fo (redirect Rekap FO) membuka Data Pelayanan dengan filter unit', async () => {
    params.nilai = new URLSearchParams('bagian=data&unit=fo');
    rute({
      lingkup: { ...LINGKUP, unit_opsi: ['fo', 'layanan'], opsi_layanan: [{ id: 'L1', nama: 'OSS', form_pendataan: 'oss' }] },
      data: {
        total: 1, form_type: null,
        rows: [{ pelayanan_id: 'x1', tanggal: '2026-10-20', unit: 'fo', kanal: 'live_chat', pengunjung_nama: 'Andi', hasil: 'selesai' }],
      },
    });
    render(<AdminRekapPage />);
    expect(await screen.findByText('Andi')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Data Pelayanan/ })).toHaveAttribute('aria-selected', 'true');
    const urlData = mockFetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes('bagian=data'))!;
    expect(urlData).toContain('unit=fo');
    expect(screen.getByRole('button', { name: /Unduh Excel/ })).toBeInTheDocument();
    expect(screen.getByText('Live Chat')).toBeInTheDocument();
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('fo');
  });

  it('migrasi belum diterapkan: pemberitahuan jelas, tanpa crash', async () => {
    rute({
      lingkup: new Response(JSON.stringify({ error: 'Rekap terpadu belum tersedia: migrasi 202610290001 dan 202610290002 belum diterapkan.', kode: 'MIGRASI_BELUM_DITERAPKAN' }), { status: 409 }),
      harian: new Response(JSON.stringify({ error: 'Rekap terpadu belum tersedia: migrasi 202610290001 dan 202610290002 belum diterapkan.', kode: 'MIGRASI_BELUM_DITERAPKAN' }), { status: 409 }),
    });
    render(<AdminRekapPage />);
    expect(await screen.findByRole('status')).toHaveTextContent(/migrasi 202610290001/);
  });

  it('pindah ke Kinerja Petugas memuat bagian kinerja', async () => {
    rute({
      lingkup: LINGKUP,
      harian: { rows: [], ringkasan: { jumlah: 0, tatap_muka: 0, live_chat: 0, per_unit: [] } },
      kinerja: { rows: [{ penangan_id: 'p1', penangan_nama: 'Sari', unit: 'fo', layanan_id: null, layanan_nama: null, jumlah: 4, live_chat: 1, rata_durasi_menit: 7.5 }] },
    });
    render(<AdminRekapPage />);
    fireEvent.click(await screen.findByRole('tab', { name: /Kinerja Petugas/ }));
    expect(await screen.findByText('Sari')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('7,5 mnt')).toBeInTheDocument());
  });
});
