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

function pantauUnduhan() {
  const buatUrl = vi.fn<(blob: Blob) => string>(() => 'blob:survei-uji');
  const cabutUrl = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = buatUrl;
    static revokeObjectURL = cabutUrl;
  });
  const berkas: { href: string; nama: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    berkas.push({ href: this.href, nama: this.download });
  });
  return { buatUrl, cabutUrl, berkas };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T05:00:00Z')); // 12.00 WIB
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(GLOBAL), { status: 200 }));
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

    expect(await screen.findByText('Nilai per unsur pelayanan', {}, { timeout: 20000 })).toBeInTheDocument();
    expect(urlRingkasan()).toEqual(['/api/admin/survei/ringkasan?dari=2026-11-01&sampai=2026-11-03']);
    expect(screen.getByRole('heading', { name: /Seluruh Pelayanan/ })).toBeInTheDocument();
    // IKM: (100 + 75) / 2 = 87.5 -> B
    expect(screen.getAllByText('87.5').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/B — Baik/).length).toBeGreaterThan(0);
    // Tidak ada tabel/grafik per Layanan.
    expect(screen.queryByText('IKM per Layanan')).toBeNull();
    expect(screen.queryByText('Layanan Disurvei')).toBeNull();
    expect(screen.queryByText('Tabel IKM per Layanan')).toBeNull();
  }, 30000);

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
    expect(screen.getByText('Tingkat pengisian')).toBeInTheDocument();
    expect(screen.getByText('Tingkat pengisian').closest('div')?.parentElement).toHaveTextContent('40.0%');
    expect(screen.getByText('4 mengisi dari 10 diundang')).toBeInTheDocument();
    const tabel = screen.getByRole('table', { name: 'Tabel SPAK per pernyataan' });
    expect(within(tabel).getAllByRole('row')).toHaveLength(1 + 5 + 1); // header + 5 pernyataan + keseluruhan
    expect(screen.queryByText(/Rata-rata SPAK per Unit/)).toBeNull();
  });

  it('PP-2: butir SPAK tanpa jawaban tidak digambar sebagai nol; nol yang terjawab tetap tampil', async () => {
    pasang('admin');
    const spak = hitungSpakGlobal([{ ...spakBaris([6, 6, 1, 6, 6]), p2_tanpa_kecurangan: null }], PERIODE);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...GLOBAL, spak }), { status: 200 }));
    render(<HasilSurveiPage />);
    await screen.findByText('Nilai per unsur pelayanan');
    fireEvent.click(screen.getByRole('tab', { name: 'SPAK' }));

    const tabel = screen.getByRole('table', { name: 'Tabel SPAK per pernyataan' });
    const kosong = within(tabel).getByRole('row', { name: /^P2 / });
    expect(within(kosong).getAllByText('—')).toHaveLength(5);
    expect(within(tabel).getByRole('row', { name: /^P3 / })).toHaveTextContent('0.0%');
    for (const label of ['Persentase setuju per pernyataan', 'Sebaran jawaban per nilai 1 sampai 6']) {
      const grafik = screen.getByRole('group', { name: label });
      expect(within(grafik).getByText('P3')).toBeInTheDocument();
      expect(within(grafik).queryByText('P2')).toBeNull();
    }
  });

  it('filter kalender menerapkan rentang kustom; preset tetap menyetel rentang', async () => {
    pasang('admin');
    render(<HasilSurveiPage />);
    await screen.findByText('Nilai per unsur pelayanan');

    fireEvent.click(screen.getByRole('button', { name: /^Rentang tanggal:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Bulan sebelumnya' }));
    fireEvent.click(screen.getByRole('button', { name: /^15 Oktober 2026/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Bulan berikutnya' }));
    fireEvent.click(screen.getByRole('button', { name: /^3 November 2026/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }));
    await waitFor(() => expect(urlRingkasan()).toContain('/api/admin/survei/ringkasan?dari=2026-10-15&sampai=2026-11-03'));
    expect((screen.getByLabelText('Periode') as HTMLSelectElement).value).toBe('kustom');

    fireEvent.change(screen.getByLabelText('Periode'), { target: { value: 'tujuh' } });
    await waitFor(() => expect(urlRingkasan()).toContain('/api/admin/survei/ringkasan?dari=2026-10-28&sampai=2026-11-03'));
  });

  it('rentang belum lengkap dan Batal tidak memuat ulang', async () => {
    pasang('admin');
    render(<HasilSurveiPage />);
    await screen.findByText('Nilai per unsur pelayanan');
    const awal = urlRingkasan().length;

    fireEvent.click(screen.getByRole('button', { name: /^Rentang tanggal:/ }));
    fireEvent.click(screen.getByRole('button', { name: /^10 November 2026/ }));
    expect(screen.getByRole('button', { name: 'Terapkan' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(urlRingkasan()).toHaveLength(awal);
  });

  it('tanggal dipilih mundur dinormalkan kalender dan hanya dimuat setelah Terapkan', async () => {
    pasang('admin');
    render(<HasilSurveiPage />);
    await screen.findByText('Nilai per unsur pelayanan');
    const jumlah = urlRingkasan().length;

    fireEvent.click(screen.getByRole('button', { name: /^Rentang tanggal:/ }));
    fireEvent.click(screen.getByRole('button', { name: /^20 November 2026/ }));
    fireEvent.click(screen.getByRole('button', { name: /^10 November 2026/ }));
    expect(urlRingkasan()).toHaveLength(jumlah);
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }));
    await waitFor(() => expect(urlRingkasan()).toHaveLength(jumlah + 1));
    expect(urlRingkasan().at(-1)).toBe('/api/admin/survei/ringkasan?dari=2026-11-10&sampai=2026-11-20');
  });

  it('tautan Unduh Excel dan Cetak/PDF membawa rentang yang sedang dipilih', async () => {
    pasang('admin');
    render(<HasilSurveiPage />);
    await screen.findByText('Nilai per unsur pelayanan');

    expect(screen.getByRole('link', { name: /Unduh Excel/ })).toHaveAttribute('href', '/api/admin/survei/export?dari=2026-11-01&sampai=2026-11-03');
    expect(screen.getByRole('link', { name: /Unduh Excel/ })).toHaveAttribute('download');
    expect(screen.getByRole('link', { name: /Cetak \/ PDF/ })).toHaveAttribute('href', '/admin/pesan-perilaku/cetak?dari=2026-11-01&sampai=2026-11-03');
    expect(screen.getByRole('link', { name: 'Laporan & Cetak' })).toHaveAttribute('href', '/admin/pesan-perilaku/cetak');
    expect(screen.getByRole('link', { name: 'Kembali ke Dasbor' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: 'Saran' })).toHaveAttribute('href', '/admin/saran');
    expect(screen.getByRole('link', { name: 'Pengaduan' })).toHaveAttribute('href', '/admin/pengaduan');
  });

  it.each([
    { status: 409, tipe: 'application/json', isi: '{"kode":"MIGRASI_BELUM_DITERAPKAN"}', pesan: /pembaruan basis data belum diterapkan/ },
    { status: 500, tipe: 'application/json', isi: '{"error":"galat"}', pesan: /Gagal mengunduh Excel/ },
    { status: 200, tipe: 'application/json', isi: '{"error":"galat"}', pesan: /Gagal mengunduh Excel/ },
    { status: 200, tipe: 'text/html', isi: '<html>Masuk kembali</html>', pesan: /Gagal mengunduh Excel/ },
    { status: 200, tipe: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', isi: 'PK', pesan: /Gagal mengunduh Excel/ },
    { status: 200, tipe: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', isi: '', lampiran: true, pesan: /Gagal mengunduh Excel/ },
  ])('PP-3: unduhan $status $tipe menampilkan galat di halaman tanpa menyimpan respons', async ({ status, tipe, isi, pesan, lampiran }) => {
    pasang('admin');
    const { buatUrl, berkas } = pantauUnduhan();
    render(<HasilSurveiPage />);
    await screen.findByText('Nilai per unsur pelayanan');
    fetchMock.mockResolvedValue(new Response(isi, { status, headers: { 'Content-Type': tipe, ...(lampiran ? { 'Content-Disposition': 'attachment; filename="survei.xlsx"' } : {}) } }));

    fireEvent.click(screen.getByRole('link', { name: 'Unduh Excel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(pesan);
    expect(buatUrl).not.toHaveBeenCalled();
    expect(berkas).toEqual([]);
    expect(screen.getByText('Nilai per unsur pelayanan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Unduh Excel' })).not.toHaveAttribute('aria-busy', 'true');
  });

  it('PP-3: gagal jaringan dapat dicoba lagi; hanya lampiran Excel valid yang diunduh dengan periode terpilih', async () => {
    pasang('admin');
    const { buatUrl, cabutUrl, berkas } = pantauUnduhan();
    render(<HasilSurveiPage />);
    await screen.findByText('Nilai per unsur pelayanan');
    fireEvent.change(screen.getByLabelText('Periode'), { target: { value: 'tujuh' } });
    await waitFor(() => expect(urlRingkasan()).toContain('/api/admin/survei/ringkasan?dari=2026-10-28&sampai=2026-11-03'));
    await screen.findByText('Nilai per unsur pelayanan');
    fetchMock.mockRejectedValueOnce(new TypeError('Network error'));
    fireEvent.click(screen.getByRole('link', { name: 'Unduh Excel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Gagal mengunduh Excel/);
    expect(buatUrl).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([80, 75, 3, 4]), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="survei.xlsx"',
      },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));

    await waitFor(() => expect(berkas).toEqual([{ href: 'blob:survei-uji', nama: 'survei-2026-10-28-sd-2026-11-03.xlsx' }]));
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/admin/survei/export?dari=2026-10-28&sampai=2026-11-03');
    expect(buatUrl).toHaveBeenCalledTimes(1);
    expect(buatUrl.mock.calls[0][0]).toMatchObject({ size: 4, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await waitFor(() => expect(cabutUrl).toHaveBeenCalledWith('blob:survei-uji'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: 'Unduh Excel' })).not.toHaveAttribute('aria-busy', 'true');
  });

  it('PP-3: klik berulang saat unduhan berlangsung hanya mengirim satu permintaan', async () => {
    pasang('admin');
    const { buatUrl } = pantauUnduhan();
    render(<HasilSurveiPage />);
    await screen.findByText('Nilai per unsur pelayanan');
    let selesai!: (res: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { selesai = resolve; }));
    const tombol = screen.getByRole('link', { name: 'Unduh Excel' });
    fireEvent.click(tombol);
    expect(tombol).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(tombol);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/admin/survei/export'))).toHaveLength(1);
    selesai(new Response('{}', { status: 500 }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Gagal mengunduh Excel/);
    expect(buatUrl).not.toHaveBeenCalled();
  });

  it('galat server menampilkan pesan dan tidak menampilkan angka lama', async () => {
    pasang('admin');
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    render(<HasilSurveiPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat hasil survei');
    expect(screen.queryByText('Nilai per unsur pelayanan')).toBeNull();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(GLOBAL), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Nilai per unsur pelayanan')).toBeInTheDocument();
  });

  it('data kosong: pesan belum ada data (bukan angka palsu)', async () => {
    pasang('admin');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ...GLOBAL, ikm: hitungIkmGlobal([], PERIODE), spak: hitungSpakGlobal([], PERIODE), responseRate: { diundang: 0, mengisi: 0, persen: null } }), { status: 200 }),
    );
    render(<HasilSurveiPage />);
    expect(await screen.findByText('Belum ada data IKM pada periode ini.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'SPAK' }));
    expect(screen.getByText('Belum ada data SPAK pada periode ini.')).toBeInTheDocument();
  });

  it('migrasi ringkasan belum tersedia ditandai khusus, tanpa angka nol dan bisa dicoba lagi', async () => {
    pasang('admin');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'MIGRASI_BELUM_DITERAPKAN' }), { status: 409 }));
    render(<HasilSurveiPage />);
    expect(await screen.findByRole('note')).toHaveTextContent(/pembaruan basis data belum diterapkan/);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Responden')).toBeNull();
    expect(screen.queryByText('Belum ada data IKM pada periode ini.')).toBeNull();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(GLOBAL), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Nilai per unsur pelayanan')).toBeInTheDocument();
  });
});

describe('Hasil Survei: petugas layanan', () => {
  it.each([
    { code: 'PGRST202', message: 'no function', peran: 'note', pesan: /pembaruan basis data belum diterapkan/ },
    { code: '57014', message: 'timeout', peran: 'alert', pesan: /Gagal memuat data IKM/ },
  ])('galat RPC $code terpisah dari hasil kosong dan bisa dicoba lagi', async ({ code, message, peran, pesan }) => {
    const { rpc } = pasang('petugas', [{ layanan_id: 'l-1', unit: 'layanan', nama: 'Helpdesk OSS', ikm: 90, responden: 12 }]);
    rpc.mockRejectedValueOnce({ code, message });
    render(<HasilSurveiPage />);
    const catatan = await screen.findByText(pesan);
    expect(catatan.closest('[role]')).toHaveAttribute('role', peran);
    expect(screen.queryByText('Total Responden')).toBeNull();
    expect(screen.queryByText('Belum ada data layanan')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Total Responden')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '12' })).toBeInTheDocument();
  });

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
