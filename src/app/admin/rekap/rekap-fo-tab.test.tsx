// @vitest-environment jsdom
// Kolom "Front Office" pada tab Pendataan Helpdesk OSS dan Non OSS (keputusan CEO 2026-10-14): nama FO diambil dari
// tahap FO pada kunjungan tiket; tiket lama tanpa tahap FO tampil em dash dan rekap tetap tampil bila FO gagal dimuat.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

vi.mock('@/components/admin/RekapLayananTable', () => ({ default: () => <div /> }));
vi.mock('@/components/admin/RekapPenangananTable', () => ({ default: () => <div /> }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/layout/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div><h1>{title}</h1>{children}</div>
  ),
}));

const h = vi.hoisted(() => ({
  oss: [] as Record<string, unknown>[],
  perizinan: [] as Record<string, unknown>[],
  tiket: { data: [] as unknown, error: null as unknown },
  tabel: [] as string[],
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from(tabel: string) {
      h.tabel.push(tabel);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'gte', 'lte', 'order']) b[m] = () => b;
      b.in = () => Promise.resolve(h.tiket);
      b.then = (res: (v: unknown) => unknown) => {
        const data = tabel === 'v_rekap_pelayanan_oss' ? h.oss : tabel === 'v_rekap_pelayanan_perizinan' ? h.perizinan : [];
        return Promise.resolve({ data, error: null }).then(res);
      };
      return b;
    },
  }),
}));

global.fetch = vi.fn(() =>
  Promise.resolve({ ok: true, json: async () => ({ options: [], default_layanan_id: null, is_petugas: false }) }),
) as unknown as typeof fetch;

import AdminRekapPage from './page';

const tahapFo = (nama: string) => [{ tahap_ke: 1, peran_tahap: 'fo', penangan_id: `id-${nama}`, petugas: { nama } }];

function barisOss(id: string, tiketId: string, nomor: string) {
  return {
    id, tiket_id: tiketId, nomor_display: nomor, tanggal: '2026-10-12', nama_pemohon: 'Budi', no_hp: null, nama_usaha: 'Usaha A',
    tipe_pelaku_usaha: null, status_penanaman_modal: null, lokasi_usaha: null, skala_usaha: null, sektor_usaha_kbli: null,
    tindak_lanjut: 'selesai', uraian_solusi: 'Solusi', nama_petugas: 'Rina', status_draft: 'final', is_locked: true,
    created_at: '2026-10-12T02:00:00Z',
  };
}

function barisPerizinan(id: string, tiketId: string, nomor: string) {
  return {
    id, tiket_id: tiketId, nomor_display: nomor, tanggal: '2026-10-12', nama_pemohon: 'Siti', no_hp: null, nama_perusahaan: 'PT Maju',
    opd_teknis: 'DPMPTSP', uraian_permohonan: 'Izin', tindak_lanjut: 'diproses', catatan_petugas: null, nama_petugas: 'Rina',
    status_draft: 'final', is_locked: true, created_at: '2026-10-12T02:00:00Z',
  };
}

describe('/admin/rekap: kolom Front Office pada tab OSS dan Non OSS', () => {
  beforeEach(() => {
    h.oss = [barisOss('o1', 't-baru', 'OS-001'), barisOss('o2', 't-lama', 'OS-002')];
    h.perizinan = [barisPerizinan('p1', 't-baru', 'NO-001'), barisPerizinan('p2', 't-lama', 'NO-002')];
    h.tiket = {
      data: [
        { id: 't-baru', kunjungan: { tahap_fo: tahapFo('Ani FO') } },
        { id: 't-lama', kunjungan: { tahap_fo: [] } },
      ],
      error: null,
    };
    h.tabel = [];
  });
  afterEach(() => cleanup());

  it('tab Helpdesk OSS: kolom Front Office tepat setelah Petugas; tiket lama = em dash', async () => {
    render(<AdminRekapPage />);
    fireEvent.click(await screen.findByRole('button', { name: /pendataan helpdesk oss/i }));
    const baru = (await screen.findByText('OS-001')).closest('tr')!;
    const lama = screen.getByText('OS-002').closest('tr')!;
    const heads = screen.getAllByRole('columnheader').map((c) => c.textContent);
    expect(heads.indexOf('Front Office')).toBe(heads.indexOf('Petugas') + 1);
    const idx = heads.indexOf('Front Office');
    expect(within(baru).getAllByRole('cell')[idx].textContent).toBe('Ani FO');
    expect(within(lama).getAllByRole('cell')[idx].textContent).toBe('—');
    expect(h.tabel).toContain('tiket_antrean');
  });

  it('tab Non OSS: kolom Front Office dan em dash untuk tiket lama', async () => {
    render(<AdminRekapPage />);
    fireEvent.click(await screen.findByRole('button', { name: /non oss \(sicantik lampung\)/i }));
    const baru = (await screen.findByText('NO-001')).closest('tr')!;
    const lama = screen.getByText('NO-002').closest('tr')!;
    const heads = screen.getAllByRole('columnheader').map((c) => c.textContent);
    const idx = heads.indexOf('Front Office');
    expect(idx).toBe(heads.indexOf('Petugas') + 1);
    expect(within(baru).getAllByRole('cell')[idx].textContent).toBe('Ani FO');
    expect(within(lama).getAllByRole('cell')[idx].textContent).toBe('—');
  });

  it('gagal memuat FO: rekap tetap tampil, kolom FO em dash (tidak ada toast galat rekap)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.tiket = { data: null, error: { message: 'rls' } };
    render(<AdminRekapPage />);
    fireEvent.click(await screen.findByRole('button', { name: /pendataan helpdesk oss/i }));
    const baris = (await screen.findByText('OS-001')).closest('tr')!;
    const idx = screen.getAllByRole('columnheader').map((c) => c.textContent).indexOf('Front Office');
    expect(within(baris).getAllByRole('cell')[idx].textContent).toBe('—');
    spy.mockRestore();
  });
});
