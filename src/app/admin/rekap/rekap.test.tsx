// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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

// Rentang tanggal kini lewat PemilihRentang: buka pemicu lalu pilih pilihan cepat (langsung diterapkan).
function gantiRentang(nama = '30 hari terakhir') {
  fireEvent.click(screen.getByRole('button', { name: /^Rentang tanggal:/ }));
  fireEvent.click(screen.getByRole('button', { name: nama }));
}
const kartuRingkasan = () => screen.getByRole('region', { name: 'Ringkasan periode' });

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
    // Ringkas (bawaan) tidak memuat kolom Kanal; Semua kolom memuatnya.
    expect(screen.queryByRole('columnheader', { name: 'Kanal' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Semua kolom' }));
    expect(screen.getByRole('columnheader', { name: 'Kanal' })).toBeInTheDocument();
    expect(screen.getByText('Live Chat')).toBeInTheDocument();
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('fo');
  });

  it('Ringkas: sel dua baris (tanggal/jam, nama/kontak), badge hasil, dan detail lengkap lewat tombol Detail', async () => {
    params.nilai = new URLSearchParams('bagian=data');
    rute({
      lingkup: { ...LINGKUP, unit_opsi: ['fo', 'layanan'], opsi_layanan: [{ id: 'L1', nama: 'BPJS', form_pendataan: null }] },
      data: {
        total: 1, form_type: null,
        rows: [{
          pelayanan_id: 'x1', sumber: 'penanganan', tanggal: '2026-10-20', unit: 'layanan', layanan_nama: 'BPJS', kanal: 'tatap_muka',
          pengunjung_nama: 'Andi', pengunjung_hp: '0812', pengunjung_email: 'andi@x.id', hasil: 'selesai', topik: 'Kartu hilang',
          keperluan: 'Mengurus kartu yang hilang di jalan', catatan: 'Sudah dibantu', penangan_nama: 'Sari',
          mulai_at: '2026-10-20T02:10:00Z', selesai_at: '2026-10-20T02:25:00Z',
        }],
      },
    });
    render(<AdminRekapPage />);
    expect(await screen.findByText('Andi')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(
      ['Tanggal', 'Pengunjung', 'Unit / Layanan', 'Topik', 'Hasil', 'Petugas', 'Front Office', 'Aksi'],
    );
    expect(screen.getByText('09:10–09:25 · 15 mnt')).toBeInTheDocument();
    expect(screen.getByText('0812 · andi@x.id')).toBeInTheDocument();
    expect(screen.getByText('Selesai')).toBeInTheDocument();
    expect(screen.queryByText('Mengurus kartu yang hilang di jalan')).not.toBeInTheDocument();
    const tombol = screen.getByRole('button', { name: 'Detail pelayanan Andi' });
    expect(tombol).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(tombol);
    expect(tombol).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Mengurus kartu yang hilang di jalan')).toBeInTheDocument();
    expect(screen.getByText('Sudah dibantu')).toBeInTheDocument();
    // Klik baris juga menutup.
    fireEvent.click(screen.getAllByText('Sari')[0]);
    expect(screen.queryByText('Mengurus kartu yang hilang di jalan')).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Semua kolom' }));
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
      expect(u.get('tanpa_form')).toBeNull();
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
      expect(terakhir.get('tanpa_form')).toBe('1');
      const pilih = (await screen.findByLabelText('Layanan')) as HTMLSelectElement;
      expect(pilih.value).toBe('');
      // Layanan berformulir (OSS / Non OSS) tidak ada di pilihan tab umum; datanya hanya di tab masing-masing.
      expect(Array.from(pilih.options).map((o) => o.text)).toEqual(['Semua Layanan', 'Balmon']);
      expect(screen.getByText(/Tidak termasuk Helpdesk OSS dan Non OSS/)).toBeInTheDocument();
    });

    it('Rekap Harian dan Kinerja Petugas tidak mengirim tanpa_form (tetap memuat semua Layanan)', async () => {
      rute({
        lingkup: LINGKUP_ADMIN,
        harian: { rows: [], ringkasan: { jumlah: 0, tatap_muka: 0, live_chat: 0, per_unit: [] } },
        kinerja: { rows: [] },
      });
      render(<AdminRekapPage />);
      await screen.findByRole('tab', { name: /Helpdesk OSS/ });
      fireEvent.click(screen.getByRole('tab', { name: /Kinerja Petugas/ }));
      await waitFor(() => expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('bagian=kinerja'))).toBe(true));
      const semua = mockFetch.mock.calls.map((c) => String(c[0])).filter((u) => /bagian=(harian|kinerja)/.test(u));
      expect(semua.length).toBeGreaterThan(1);
      expect(semua.every((u) => !u.includes('tanpa_form'))).toBe(true);
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
      // Lingkupnya hanya Layanan berformulir: tab Data Pelayanan (Layanan lain) pasti kosong, jadi disembunyikan.
      expect(screen.queryByRole('tab', { name: /Data Pelayanan/ })).not.toBeInTheDocument();
      expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Rekap Harian', 'Helpdesk OSS', 'Kinerja Petugas']);
    });

    it('?bagian=data oleh Petugas Helpdesk OSS (tab Data disembunyikan) jatuh ke tab Helpdesk OSS', async () => {
      params.nilai = new URLSearchParams('bagian=data');
      rute({
        lingkup: { label: 'Layanan Anda.', unit_opsi: ['layanan'], opsi_layanan: [{ id: 'L-OSS', nama: 'Helpdesk OSS', form_pendataan: 'oss' }] },
        data: BARIS_OSS,
      });
      render(<AdminRekapPage />);
      expect(await screen.findByText('Budi')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Helpdesk OSS/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('Petugas Layanan lain + Layanan berformulir tidak ada: Data Pelayanan tetap ada dan meminta tanpa_form', async () => {
      params.nilai = new URLSearchParams('bagian=data');
      rute({
        lingkup: { label: 'Layanan Anda.', unit_opsi: ['layanan'], opsi_layanan: [{ id: 'L-BAL', nama: 'Balmon', form_pendataan: null }] },
        data: { total: 0, form_type: null, rows: [] },
      });
      render(<AdminRekapPage />);
      await waitFor(() => expect(urlData().length).toBeGreaterThan(0));
      expect(new URL(urlData()[0], 'http://x').searchParams.get('tanpa_form')).toBe('1');
      expect(screen.getByRole('tab', { name: /Data Pelayanan/ })).toHaveAttribute('aria-selected', 'true');
      // Tidak ada tab OSS/Non OSS untuknya, jadi catatan "tidak termasuk ..." tidak ditampilkan.
      expect(screen.queryByText(/Tidak termasuk Helpdesk OSS dan Non OSS/)).not.toBeInTheDocument();
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
    expect(await screen.findByText(/migrasi 202610290001/)).toBeInTheDocument();
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

  describe('status muat (B-10, C3-06, B-12)', () => {
    const LINGKUP_ADMIN = {
      label: 'Semua data.',
      unit_opsi: ['fo', 'layanan'],
      opsi_layanan: [
        { id: 'L-OSS', nama: 'Helpdesk OSS', form_pendataan: 'oss' },
        { id: 'L-BAL', nama: 'Balmon', form_pendataan: null },
      ],
    };
    const HARIAN = { rows: [{ tanggal: '2026-10-20', unit: 'fo', layanan_id: null, layanan_nama: null, tatap_muka: 2, live_chat: 1, jumlah: 3 }], ringkasan: { jumlah: 3, tatap_muka: 2, live_chat: 1, per_unit: [] } };

    it('B-10: sebelum data tiba kartu ringkasan menampilkan "—", bukan 0', async () => {
      mockFetch.mockImplementation((url: string) => {
        const bagian = new URL(url, 'http://x').searchParams.get('bagian') ?? '';
        if (bagian === 'lingkup') return json(LINGKUP);
        return new Promise(() => {}); // harian tidak pernah selesai
      });
      render(<AdminRekapPage />);
      await screen.findByText(/Hanya data yang Anda tangani sendiri/);
      // Memuat = kerangka (Skeleton) berlabel, bukan angka 0.
      expect(within(kartuRingkasan()).getByText('Memuat Dilayani (periode)')).toBeInTheDocument();
      expect(within(kartuRingkasan()).queryByText('0')).toBeNull();
    });

    it('B-10: galat memuat harian: kartu "—" dan tabel tidak menyatakan "belum ada pelayanan"', async () => {
      rute({ lingkup: LINGKUP, harian: new Response(JSON.stringify({ error: 'Gagal memuat rekap' }), { status: 500 }) });
      render(<AdminRekapPage />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat rekap');
      expect(within(kartuRingkasan()).getAllByText('—')).toHaveLength(3);
      expect(within(kartuRingkasan()).queryByText('0')).toBeNull();
      expect(screen.queryByText(/Belum ada pelayanan dilayani pada rentang ini/)).toBeNull();
    });

    it('B-10: saat filter diganti isi lama diredupkan dengan penanda terlihat sampai data baru datang', async () => {
      rute({ lingkup: LINGKUP, harian: HARIAN });
      render(<AdminRekapPage />);
      await screen.findByText('20/10/2026');
      let lepas: (r: Response) => void = () => {};
      mockFetch.mockImplementation((url: string) => {
        if (new URL(url, 'http://x').searchParams.get('bagian') === 'harian') return new Promise<Response>((r) => { lepas = r; });
        return json(LINGKUP);
      });
      gantiRentang();
      const panel = screen.getByRole('tabpanel');
      await waitFor(() => expect(panel).toHaveAttribute('aria-busy', 'true'));
      expect(panel).toHaveAttribute('data-memuat', 'true');
      expect(panel).toHaveAttribute('data-redup', 'true');
      lepas(new Response(JSON.stringify(HARIAN), { status: 200 }));
      await waitFor(() => expect(panel).toHaveAttribute('aria-busy', 'false'));
      expect(panel).toHaveAttribute('data-redup', 'false');
    });

    it('C3-06: filter baru gagal => data lama dibuang (tabel dan kartu), bukan tampil di bawah filter baru', async () => {
      rute({ lingkup: LINGKUP, harian: HARIAN });
      render(<AdminRekapPage />);
      await screen.findByText('20/10/2026');
      rute({ lingkup: LINGKUP, harian: new Response(JSON.stringify({ error: 'Gagal memuat rekap' }), { status: 500 }) });
      gantiRentang();
      expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat rekap');
      expect(screen.queryByText('20/10/2026')).toBeNull();
      expect(within(kartuRingkasan()).getAllByText('—')).toHaveLength(3);
      expect(within(kartuRingkasan()).queryByText('0')).toBeNull();
    });

    it('C3-06: galat pada tab Data Pelayanan membuang baris lama', async () => {
      params.nilai = new URLSearchParams('bagian=data');
      const baris = { total: 1, form_type: null, rows: [{ pelayanan_id: 'x1', tanggal: '2026-10-20', unit: 'fo', kanal: 'tatap_muka', pengunjung_nama: 'Andi', hasil: 'selesai' }] };
      rute({ lingkup: { ...LINGKUP, unit_opsi: ['fo', 'layanan'], opsi_layanan: [] }, data: baris });
      render(<AdminRekapPage />);
      await screen.findByText('Andi');
      rute({ lingkup: { ...LINGKUP, unit_opsi: ['fo', 'layanan'], opsi_layanan: [] }, data: new Response('{}', { status: 500 }) });
      fireEvent.click(screen.getByRole('button', { name: /Muat ulang/ }));
      await screen.findByRole('alert');
      expect(screen.queryByText('Andi')).toBeNull();
    });

    it('B-12: filter Layanan di Rekap Harian dan Kinerja memuat SEMUA Layanan; di Data Pelayanan hanya tanpa formulir', async () => {
      rute({ lingkup: LINGKUP_ADMIN, harian: HARIAN, kinerja: { rows: [] }, data: { total: 0, form_type: null, rows: [] } });
      render(<AdminRekapPage />);
      const opsi = async () => Array.from(((await screen.findByLabelText('Layanan')) as HTMLSelectElement).options).map((o) => o.text);
      expect(await opsi()).toEqual(['Semua Layanan', 'Helpdesk OSS', 'Balmon']);
      fireEvent.change(screen.getByLabelText('Layanan'), { target: { value: 'L-OSS' } });
      await waitFor(() => expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('bagian=harian') && String(c[0]).includes('layanan_id=L-OSS'))).toBe(true));
      fireEvent.click(screen.getByRole('tab', { name: /Kinerja Petugas/ }));
      expect(await opsi()).toEqual(['Semua Layanan', 'Helpdesk OSS', 'Balmon']);
      // Pindah ke Data Pelayanan: pilihan OSS tidak sah di sana, jadi dibuang agar tidak terkirim diam-diam.
      fireEvent.click(screen.getByRole('tab', { name: /Data Pelayanan/ }));
      expect(await opsi()).toEqual(['Semua Layanan', 'Balmon']);
      await waitFor(() => expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('bagian=data'))).toBe(true));
      const u = mockFetch.mock.calls.map((c) => String(c[0])).filter((x) => x.includes('bagian=data')).at(-1)!;
      expect(new URL(u, 'http://x').searchParams.get('layanan_id')).toBeNull();
    });

    it('B-11: memilih rentang baru memicu tepat satu permintaan baru dengan dari <= sampai (rentang tak sah tidak bisa dipilih)', async () => {
      rute({ lingkup: LINGKUP, harian: HARIAN });
      render(<AdminRekapPage />);
      await screen.findByText('20/10/2026');
      const urlHarian = () => mockFetch.mock.calls.map((c) => String(c[0])).filter((x) => x.includes('bagian=harian'));
      const sebelum = urlHarian().length;
      gantiRentang('Bulan lalu');
      await waitFor(() => expect(urlHarian().length).toBe(sebelum + 1));
      const q = new URL(urlHarian().at(-1)!, 'http://x').searchParams;
      expect(q.get('dari')! <= q.get('sampai')!).toBe(true);
      expect(q.get('dari')).toMatch(/-01$/);
    });
  });
});

describe('/admin/rekap: ringkasan "dilayani saya / total" (akses FO, migrasi 202611030015)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    params.nilai = new URLSearchParams();
  });
  afterEach(() => cleanup());

  const HARIAN = {
    rows: [],
    ringkasan: { jumlah: 0, tatap_muka: 0, live_chat: 0, per_unit: [] },
  };

  it('menampilkan "45 / 120 (37,5%)" dari body API di Rekap Harian', async () => {
    rute({ lingkup: LINGKUP, harian: { ...HARIAN, dilayani: { saya: 45, total: 120, persen: 37.5 } } });
    render(<AdminRekapPage />);
    expect(await screen.findByText('45 / 120 (37,5%)')).toBeInTheDocument();
    expect(screen.getByText('Dilayani saya / total')).toBeInTheDocument();
  });

  it('dilayani null (migrasi belum diterapkan): ringkasan tidak tampil, rekap lama tetap jalan', async () => {
    rute({ lingkup: LINGKUP, harian: { ...HARIAN, dilayani: null } });
    render(<AdminRekapPage />);
    expect(await screen.findByText(/Dilayani \(periode\)/)).toBeInTheDocument();
    expect(screen.queryByText('Dilayani saya / total')).not.toBeInTheDocument();
  });

  it('Data Pelayanan dan Kinerja Petugas memuat ringkasan dari respons masing-masing', async () => {
    rute({
      lingkup: LINGKUP,
      harian: { ...HARIAN, dilayani: { saya: 1, total: 4, persen: 25 } },
      data: { rows: [], total: 0, form_type: null, dilayani: { saya: 2, total: 8, persen: 25 } },
      kinerja: { rows: [], dilayani: { saya: 3, total: 6, persen: 50 } },
    });
    render(<AdminRekapPage />);
    expect(await screen.findByText('1 / 4 (25%)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Data Pelayanan/ }));
    expect(await screen.findByText('2 / 8 (25%)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Kinerja Petugas/ }));
    expect(await screen.findByText('3 / 6 (50%)')).toBeInTheDocument();
  });

  it('galat memuat rekap: tidak ada angka dilayani yang tersisa dari tab sebelumnya', async () => {
    rute({
      lingkup: LINGKUP,
      harian: { ...HARIAN, dilayani: { saya: 1, total: 4, persen: 25 } },
      kinerja: new Response(JSON.stringify({ error: 'Gagal memuat rekap' }), { status: 500 }),
    });
    render(<AdminRekapPage />);
    expect(await screen.findByText('1 / 4 (25%)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Kinerja Petugas/ }));
    await waitFor(() => expect(screen.queryByText('1 / 4 (25%)')).not.toBeInTheDocument());
  });

  it('kolom "Front Office" menampilkan fo_nama di Data Pelayanan', async () => {
    rute({
      lingkup: LINGKUP,
      data: {
        total: 1, form_type: null,
        rows: [{
          pelayanan_id: 'x1', sumber: 'penanganan', tanggal: '2026-10-20', unit: 'layanan', layanan_nama: 'BPJS', kanal: 'tatap_muka',
          pengunjung_nama: 'Andi', pengunjung_hp: null, pengunjung_email: null, hasil: 'selesai', topik: 'Kartu',
          keperluan: null, catatan: null, penangan_nama: 'Sari', fo_nama: 'Rina FO',
          mulai_at: '2026-10-20T02:10:00Z', selesai_at: '2026-10-20T02:25:00Z',
        }],
      },
    });
    params.nilai = new URLSearchParams('bagian=data');
    render(<AdminRekapPage />);
    expect(await screen.findByRole('cell', { name: 'Rina FO' })).toBeInTheDocument();
  });
});
