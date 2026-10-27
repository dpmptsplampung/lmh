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

  it('Fase 4: kolom Pendataan Khusus Layanan terpilih tampil di tabel (isian tersembunyi yang pernah diisi ikut)', async () => {
    params.nilai = new URLSearchParams('bagian=data');
    rute({
      lingkup: { ...LINGKUP, unit_opsi: ['fo', 'layanan'], opsi_layanan: [{ id: 'L1', nama: 'BPJS', form_pendataan: null }] },
      data: {
        total: 1, form_type: null,
        kolom_khusus: [
          { id: 'f1', layanan_id: 'L1', label: 'Jenis kartu', jenis: 'pilihan_tunggal', wajib: true, opsi: ['A', 'B'], urut: 0, tersembunyi: false, pernah_diisi: true },
          { id: 'f2', layanan_id: 'L1', label: 'Puas', jenis: 'ya_tidak', wajib: false, opsi: [], urut: 1, tersembunyi: true, pernah_diisi: true },
        ],
        rows: [{ pelayanan_id: 'x1', sumber: 'penanganan', tanggal: '2026-10-20', unit: 'layanan', kanal: 'live_chat', pengunjung_nama: 'Andi', hasil: 'selesai', khusus: { f1: 'B', f2: true } }],
      },
    });
    render(<AdminRekapPage />);
    expect(await screen.findByText('Andi')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '[Khusus] Jenis kartu' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '[Khusus] Puas' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Ya' })).toBeInTheDocument();
  });

  describe('tab Helpdesk OSS dan Non OSS (terpisah dari Layanan lain)', () => {
    const LINGKUP_ADMIN = {
      label: 'Semua data.',
      unit_opsi: ['fo', 'layanan'],
      opsi_layanan: [
        { id: 'L-OSS', nama: 'Helpdesk OSS', form_pendataan: 'oss' },
        { id: 'L-NON', nama: 'Non OSS (SiCantik)', form_pendataan: 'perizinan' },
        { id: 'L-BAL', nama: 'Balmon', form_pendataan: null },
      ],
    };
    const BARIS_OSS = {
      total: 1, form_type: 'oss', kolom_khusus: [],
      rows: [{ pelayanan_id: 'x1', sumber: 'penanganan', tanggal: '2026-10-20', unit: 'layanan', kanal: 'tatap_muka', pengunjung_nama: 'Budi', hasil: 'selesai', form_type: 'oss', pendataan: { email: 'budi@majujaya.id' } }],
    };
    const urlData = () => mockFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('bagian=data'));

    it('Admin: tab Helpdesk OSS dan Non OSS berdiri sendiri di antara Rekap Harian dan Data Pelayanan', async () => {
      rute({ lingkup: LINGKUP_ADMIN, harian: { rows: [], ringkasan: { jumlah: 0, tatap_muka: 0, live_chat: 0, per_unit: [] } } });
      render(<AdminRekapPage />);
      await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(5));
      expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(
        ['Rekap Harian', 'Helpdesk OSS', 'Non OSS', 'Data Pelayanan', 'Kinerja Petugas'],
      );
    });

    it('tab Helpdesk OSS terkunci ke Layanan berformulir OSS: kolom formulir langsung tampil, tanpa pilihan Unit/Layanan umum', async () => {
      rute({ lingkup: LINGKUP_ADMIN, harian: { rows: [], ringkasan: { jumlah: 0, tatap_muka: 0, live_chat: 0, per_unit: [] } }, data: BARIS_OSS });
      render(<AdminRekapPage />);
      fireEvent.click(await screen.findByRole('tab', { name: /Helpdesk OSS/ }));
      expect(await screen.findByText('Budi')).toBeInTheDocument();
      const u = new URL(urlData()[0], 'http://x').searchParams;
      expect(u.get('unit')).toBe('layanan');
      expect(u.get('layanan_id')).toBe('L-OSS');
      expect(screen.getByRole('columnheader', { name: '[OSS] Email' })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: 'budi@majujaya.id' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Unit')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Layanan')).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Helpdesk OSS/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('button', { name: /Unduh Excel/ })).toBeInTheDocument();
    });

    it('tab Non OSS memuat Layanan berformulir perizinan, bukan Layanan OSS', async () => {
      rute({
        lingkup: LINGKUP_ADMIN,
        harian: { rows: [], ringkasan: { jumlah: 0, tatap_muka: 0, live_chat: 0, per_unit: [] } },
        data: { ...BARIS_OSS, form_type: 'perizinan', rows: [{ ...BARIS_OSS.rows[0], form_type: 'perizinan', pendataan: { email: 'per@contoh.id' } }] },
      });
      render(<AdminRekapPage />);
      fireEvent.click(await screen.findByRole('tab', { name: /Non OSS/ }));
      expect(await screen.findByRole('columnheader', { name: '[Non OSS] Email' })).toBeInTheDocument();
      expect(new URL(urlData()[0], 'http://x').searchParams.get('layanan_id')).toBe('L-NON');
    });

    it('kembali ke Data Pelayanan memakai filter umum lagi (Layanan lain tidak terkunci)', async () => {
      rute({ lingkup: LINGKUP_ADMIN, harian: { rows: [], ringkasan: { jumlah: 0, tatap_muka: 0, live_chat: 0, per_unit: [] } }, data: BARIS_OSS });
      render(<AdminRekapPage />);
      fireEvent.click(await screen.findByRole('tab', { name: /Helpdesk OSS/ }));
      await screen.findByText('Budi');
      fireEvent.click(screen.getByRole('tab', { name: /Data Pelayanan/ }));
      await waitFor(() => expect(urlData().length).toBeGreaterThan(1));
      const terakhir = new URL(urlData().at(-1)!, 'http://x').searchParams;
      expect(terakhir.get('layanan_id')).toBeNull();
      expect(terakhir.get('unit')).toBeNull();
      expect((await screen.findByLabelText('Layanan') as HTMLSelectElement).value).toBe('');
    });

    it('?bagian=oss tanpa Layanan OSS dalam lingkup (Petugas Layanan lain / FO) jatuh ke Data Pelayanan, tanpa tab OSS', async () => {
      params.nilai = new URLSearchParams('bagian=oss');
      rute({
        lingkup: { label: 'Layanan Anda.', unit_opsi: ['layanan'], opsi_layanan: [{ id: 'L-BAL', nama: 'Balmon', form_pendataan: null }] },
        data: { total: 0, form_type: null, rows: [] },
      });
      render(<AdminRekapPage />);
      await waitFor(() => expect(screen.getByRole('tab', { name: /Data Pelayanan/ })).toHaveAttribute('aria-selected', 'true'));
      expect(screen.queryByRole('tab', { name: /Helpdesk OSS/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /Non OSS/ })).not.toBeInTheDocument();
    });

    it('Petugas Helpdesk OSS: hanya tab OSS yang muncul, langsung terkunci ke Layanannya', async () => {
      params.nilai = new URLSearchParams('bagian=oss');
      rute({
        lingkup: { label: 'Layanan Anda.', unit_opsi: ['layanan'], opsi_layanan: [{ id: 'L-OSS', nama: 'Helpdesk OSS', form_pendataan: 'oss' }] },
        data: BARIS_OSS,
      });
      render(<AdminRekapPage />);
      expect(await screen.findByText('Budi')).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: /Non OSS/ })).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Helpdesk OSS/ })).toHaveAttribute('aria-selected', 'true');
      expect(new URL(urlData()[0], 'http://x').searchParams.get('layanan_id')).toBe('L-OSS');
    });

    it('lebih dari satu Layanan berformulir OSS: pilihan Layanan khusus tab itu (tanpa "Semua"), ganti pilihan memuat ulang', async () => {
      rute({
        lingkup: { ...LINGKUP_ADMIN, opsi_layanan: [
          { id: 'L-OSS', nama: 'Helpdesk OSS', form_pendataan: 'oss' },
          { id: 'L-OSS2', nama: 'Helpdesk OSS Cabang', form_pendataan: 'oss' },
          { id: 'L-BAL', nama: 'Balmon', form_pendataan: null },
        ] },
        harian: { rows: [], ringkasan: { jumlah: 0, tatap_muka: 0, live_chat: 0, per_unit: [] } },
        data: BARIS_OSS,
      });
      render(<AdminRekapPage />);
      fireEvent.click(await screen.findByRole('tab', { name: /Helpdesk OSS/ }));
      const pilih = (await screen.findByLabelText('Layanan')) as HTMLSelectElement;
      expect(Array.from(pilih.options).map((o) => o.text)).toEqual(['Helpdesk OSS', 'Helpdesk OSS Cabang']);
      fireEvent.change(pilih, { target: { value: 'L-OSS2' } });
      await waitFor(() => expect(new URL(urlData().at(-1)!, 'http://x').searchParams.get('layanan_id')).toBe('L-OSS2'));
    });
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
