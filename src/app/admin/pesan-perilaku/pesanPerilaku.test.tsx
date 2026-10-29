// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, href, ...r }: { children: React.ReactNode; href: string }) => <a href={href} {...r}>{children}</a> }));

import HasilSurveiPage from './page';
import { createClient } from '@/lib/supabase/client';
import { hitungIkmGlobal, hitungSpakGlobal, type BarisMentah } from '@/lib/survei/ringkasan-global';

type Role = 'admin' | 'front_office' | 'petugas';

const PERIODE = { dari: '2026-11-01', sampai: '2026-11-03' };
const spakBaris = (p: number[], waktu = '2026-11-02T03:00:00Z'): BarisMentah => ({
  created_at: waktu,
  p1_tanpa_diskriminasi: p[0], p2_tanpa_kecurangan: p[1], p3_tanpa_imbalan: p[2], p4_tanpa_pungli: p[3], p5_tanpa_percaloan: p[4],
});
const skmBaris = (n: number, waktu = '2026-11-02T03:00:00Z'): BarisMentah => ({
  created_at: waktu,
  u1_persyaratan: n, u2_prosedur: n, u3_waktu: n, u4_biaya: n, u5_produk: n, u6_kompetensi: n, u7_perilaku: n, u8_sarana: n, u9_pengaduan: n,
  u10_transparansi: null, u11_integritas: null,
});

const GLOBAL = {
  dari: PERIODE.dari,
  sampai: PERIODE.sampai,
  spak: hitungSpakGlobal([spakBaris([6, 6, 6, 6, 6]), spakBaris([5, 4, 3, 2, 1])], PERIODE),
  ikm: hitungIkmGlobal([skmBaris(4), skmBaris(3)], PERIODE),
  responseRate: { diundang: 10, mengisi: 4, persen: 40 },
  terpotong: false,
};

const fetchMock = vi.fn();

function pasang(role: Role | null = 'admin', ikmRpc: Array<Record<string, unknown>> = []) {
  const petugas = {
    select: () => petugas,
    eq: () => petugas,
    maybeSingle: async () => ({
      data: role ? { role, layanan_id: role === 'petugas' ? 'l-1' : null, layanan: role === 'petugas' ? { nama: 'Helpdesk OSS' } : null } : null,
      error: null,
    }),
  };
  const rpc = vi.fn(async (nama: string) => (nama === 'ringkasan_ikm' ? { data: ikmRpc, error: null } : { data: null, error: { message: 'rpc tak dikenal' } }));
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: (t: string) => (t === 'petugas' ? petugas : {}),
    rpc,
  });
  return { rpc };
}

const urlRingkasan = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/admin/survei/ringkasan'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T05:00:00Z')); // 12.00 WIB
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify(GLOBAL), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Hasil Survei: admin dan Front Office (global)', () => {
  it.each(['admin', 'front_office'] as const)('%s: memuat IKM global bulan ini tanpa pemecahan per Layanan', async (role) => {
    pasang(role);
    render(<HasilSurveiPage />);

    expect(await screen.findByText('Nilai per unsur pelayanan')).toBeInTheDocument();
    expect(urlRingkasan()).toEqual(['/api/admin/survei/ringkasan?dari=2026-11-01&sampai=2026-11-03']);
    expect(screen.getByRole('heading', { name: /Seluruh Pelayanan/ })).toBeInTheDocument();
    // IKM: (100 + 75) / 2 = 87.5 -> B
    expect(screen.getAllByText('87.5').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/B — Baik/).length).toBeGreaterThan(0);
    // Tidak ada tabel/grafik per Layanan.
    expect(screen.queryByText('IKM per Layanan')).toBeNull();
    expect(screen.queryByText('Layanan Disurvei')).toBeNull();
    expect(screen.queryByText('Tabel IKM per Layanan')).toBeNull();
  });

  it('tab SPAK: dashboard persen (setuju/netral/tidak setuju), indeks, dan tabel per pernyataan', async () => {
    pasang('admin');
    render(<HasilSurveiPage />);
    await screen.findByText('Nilai per unsur pelayanan');

    fireEvent.click(screen.getByRole('tab', { name: 'SPAK' }));

    expect(await screen.findByText('Indeks SPAK')).toBeInTheDocument();
    // 2 responden x 5 = 10 jawaban: rata-rata 4,5, indeks 75, setuju 60%, tidak setuju 20%
    expect(screen.getAllByText('75.0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60.0%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('20.0%').length).toBeGreaterThan(0);
    expect(screen.getByText('Tingkat pengisian').closest('div')).toHaveTextContent('40.0%');
    const tabel = screen.getByRole('region', { name: 'Tabel SPAK per pernyataan' });
    expect(within(tabel).getAllByRole('row')).toHaveLength(1 + 5 + 1); // header + 5 pernyataan + keseluruhan
    expect(screen.queryByText(/Rata-rata SPAK per Unit/)).toBeNull();
  });

  it('filter tanggal: mengubah "Dari tanggal" memuat ulang dengan rentang baru; preset menyetel rentang', async () => {
    pasang('admin');
    render(<HasilSurveiPage />);
    await screen.findByText('Nilai per unsur pelayanan');

    fireEvent.change(screen.getByLabelText('Dari tanggal'), { target: { value: '2026-10-15' } });
    await waitFor(() => expect(urlRingkasan()).toContain('/api/admin/survei/ringkasan?dari=2026-10-15&sampai=2026-11-03'));
    expect((screen.getByLabelText('Periode') as HTMLSelectElement).value).toBe('kustom');

    fireEvent.change(screen.getByLabelText('Periode'), { target: { value: 'tujuh' } });
    await waitFor(() => expect(urlRingkasan()).toContain('/api/admin/survei/ringkasan?dari=2026-10-28&sampai=2026-11-03'));
  });

  it('rentang terbalik (dari setelah sampai) ditolak: tidak memuat ulang', async () => {
    pasang('admin');
    render(<HasilSurveiPage />);
    await screen.findByText('Nilai per unsur pelayanan');
    const awal = urlRingkasan().length;

    fireEvent.change(screen.getByLabelText('Dari tanggal'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('Sampai tanggal'), { target: { value: '2026-10-01' } });
    expect(urlRingkasan()).toHaveLength(awal);
  });

  it('tautan Unduh Excel dan Cetak/PDF membawa rentang yang sedang dipilih', async () => {
    pasang('admin');
    render(<HasilSurveiPage />);
    await screen.findByText('Nilai per unsur pelayanan');

    expect(screen.getByRole('link', { name: /Unduh Excel/ })).toHaveAttribute('href', '/api/admin/survei/export?dari=2026-11-01&sampai=2026-11-03');
    expect(screen.getByRole('link', { name: /Cetak \/ PDF/ })).toHaveAttribute('href', '/admin/pesan-perilaku/cetak?dari=2026-11-01&sampai=2026-11-03');
  });

  it('galat server menampilkan pesan dan tidak menampilkan angka lama', async () => {
    pasang('admin');
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    render(<HasilSurveiPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat hasil survei');
    expect(screen.queryByText('Nilai per unsur pelayanan')).toBeNull();
  });

  it('data kosong: pesan belum ada data (bukan angka palsu)', async () => {
    pasang('admin');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ...GLOBAL, ikm: hitungIkmGlobal([], PERIODE), spak: hitungSpakGlobal([], PERIODE), responseRate: { diundang: 0, mengisi: 0, persen: null } }), { status: 200 }),
    );
    render(<HasilSurveiPage />);
    expect(await screen.findByText('Belum ada data IKM pada periode ini.')).toBeInTheDocument();
  });
});

describe('Hasil Survei: petugas layanan', () => {
  it('hanya IKM Layanannya sendiri; tanpa tab SPAK, tanpa unduhan, tanpa memanggil rute global', async () => {
    const { rpc } = pasang('petugas', [
      { layanan_id: 'l-1', unit: 'layanan', nama: 'Helpdesk OSS', ikm: 90, responden: 12 },
      { layanan_id: 'l-2', unit: 'layanan', nama: 'Sertifikasi Halal', ikm: 65, responden: 4 },
    ]);
    render(<HasilSurveiPage />);

    expect(await screen.findByText('Data ini hanya untuk layanan Helpdesk OSS. Setiap ekspor tercatat.')).toBeInTheDocument();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('ringkasan_ikm', { p_start: '2026-11-01', p_end: '2026-11-03' }));
    expect(await screen.findAllByText('Helpdesk OSS')).not.toHaveLength(0);
    expect(screen.queryByText('Sertifikasi Halal')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'SPAK' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Unduh/ })).toBeNull();
    expect(urlRingkasan()).toHaveLength(0);
  });
});

describe('Hasil Survei: peran tidak diketahui', () => {
  it('menampilkan galat, tidak membuka data apa pun', async () => {
    pasang(null);
    render(<HasilSurveiPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Peran Anda tidak dapat dipastikan');
    expect(urlRingkasan()).toHaveLength(0);
  });
});
