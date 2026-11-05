// Laporan cetak Pesan Perilaku: angka global (IKM per unsur, SPAK per pernyataan dengan persen, tingkat pengisian, saran, pengaduan).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { hitungIkmGlobal, hitungSpakGlobal, type BarisMentah } from '@/lib/survei/ringkasan-global';

const PERIODE = { dari: '2026-10-01', sampai: '2026-10-31' };
const spak = (p: number[]): BarisMentah => ({
  created_at: '2026-10-05T03:00:00Z', p1_tanpa_diskriminasi: p[0], p2_tanpa_kecurangan: p[1], p3_tanpa_imbalan: p[2], p4_tanpa_pungli: p[3], p5_tanpa_percaloan: p[4],
});
const skm = (n: number): BarisMentah => ({
  created_at: '2026-10-05T03:00:00Z',
  u1_persyaratan: n, u2_prosedur: n, u3_waktu: n, u4_biaya: n, u5_produk: n, u6_kompetensi: n, u7_perilaku: n, u8_sarana: n, u9_pengaduan: n,
  u10_transparansi: null, u11_integritas: null,
});
const GLOBAL = {
  spak: hitungSpakGlobal([spak([6, 6, 6, 6, 3]), spak([6, 6, 6, 6, 3])], PERIODE),
  ikm: hitungIkmGlobal([skm(4), skm(3)], PERIODE), // (100 + 75) / 2 = 87.5
  responseRate: { diundang: 20, mengisi: 10, persen: 50 },
  terpotong: false,
};

const sumber = vi.hoisted(() => ({
  rpcGalat: {} as Record<string, { code?: string; message: string } | undefined>,
  saran: { data: null as unknown[] | null, error: null as { code?: string; message: string } | null, count: null as number | null },
}));
const DATA: Record<string, unknown[]> = {
  ringkasan_pengaduan: [{ jalur: 'layanan', sumber: 'wizard', status: 'baru', jumlah: 2 }, { jalur: 'layanan', sumber: 'publik', status: 'baru', jumlah: 1 }],
  ringkasan_saran: [{ layanan_id: 'a', unit: 'layanan', nama: 'Layanan OSS', jumlah: 1 }],
};
const params = new URLSearchParams();
vi.mock('next/navigation', () => ({ useSearchParams: () => params }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: async (nama: string) => (sumber.rpcGalat[nama] ? { data: null, error: sumber.rpcGalat[nama] } : { data: DATA[nama] ?? [], error: null }),
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'gte', 'lt', 'order']) q[m] = () => q;
      q.limit = async () => ({
        data: sumber.saran.data ?? [{ id: 's1', isi: 'Tambah kursi tunggu', created_at: '2026-10-28T03:00:00Z', pelapor_nama: null, unit: 'layanan', layanan: { nama: 'Layanan OSS' } }],
        error: sumber.saran.error,
        count: sumber.saran.count,
      });
      return q;
    },
  }),
}));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import CetakPesanPerilakuPage from './page';

const fetchMock = vi.fn();
beforeEach(() => {
  [...params.keys()].forEach((k) => params.delete(k));
  sumber.rpcGalat = {};
  sumber.saran = { data: null, error: null, count: null };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(GLOBAL), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CetakPesanPerilakuPage', () => {
  it('menampilkan angka IKM, SPAK + persen, tingkat pengisian, saran, dan pengaduan secara GLOBAL', async () => {
    render(<CetakPesanPerilakuPage />);
    await waitFor(() => expect(screen.getByText('Laporan Pesan Perilaku', { selector: 'h2' })).toBeInTheDocument());
    await screen.findByText(/gabungan seluruh pelayanan/);

    expect(screen.getAllByText('87.5').length).toBeGreaterThan(0); // IKM
    // SPAK: (6x4 + 3) / 5 = 5.40 ; indeks 90.0 ; setuju 100%
    expect(screen.getAllByText('5.40').length).toBeGreaterThan(0);
    expect(screen.getAllByText('90.0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('80.0%').length).toBeGreaterThan(0); // 4 dari 5 butir bernilai 6; butir 5 bernilai 3 -> setuju 80%
    expect(screen.getAllByText('50.0%').length).toBeGreaterThan(0); // tingkat pengisian
    expect(screen.getByText('Tambah kursi tunggu')).toBeInTheDocument();
    expect(screen.getByText('Tautan publik')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cetak/ })).toBeEnabled();
    // Tanpa pemecahan per unit.
    expect(screen.queryByText(/per Unit/)).toBeNull();
    expect(screen.queryByText('Front Office')).toBeNull();
  });

  it('periode diambil dari query ?dari=&sampai= (dikirim dari halaman Hasil Survei)', async () => {
    params.set('dari', '2026-09-01');
    params.set('sampai', '2026-09-30');
    render(<CetakPesanPerilakuPage />);
    await screen.findByText(/gabungan seluruh pelayanan/);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/survei/ringkasan?dari=2026-09-01&sampai=2026-09-30');
    expect(screen.getByText(/Periode 1 September 2026 s\.d\. 30 September 2026/)).toBeInTheDocument();
  });

  it('tombol cetak memanggil window.print; kontrol disembunyikan dan batang punya label angka untuk cetak hitam putih', async () => {
    const cetak = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<CetakPesanPerilakuPage />);
    expect(screen.getByRole('button', { name: /Cetak/ })).toBeDisabled();
    await screen.findByText(/gabungan seluruh pelayanan/);

    const tombol = screen.getByRole('button', { name: 'Cetak / Simpan PDF' });
    fireEvent.click(tombol);
    expect(cetak).toHaveBeenCalledTimes(1);
    expect(tombol.closest('[data-cetak="sembunyi"]')).not.toBeNull();
    const kembali = screen.getByRole('link', { name: 'Kembali' });
    expect(kembali).toHaveAttribute('href', '/admin/pesan-perilaku');
    expect(kembali.closest('[data-cetak="sembunyi"]')).not.toBeNull();
    const laporan = document.getElementById('laporan-cetak')!;
    expect(laporan.tagName).toBe('ARTICLE');
    expect(within(laporan).queryByRole('button')).toBeNull();
    for (const batang of within(laporan).getAllByRole('img')) {
      expect(batang).toHaveTextContent(/^\d+\.\d$|^—$/);
    }
    cetak.mockRestore();
  });

  it('query tidak sah diabaikan (jatuh ke bulan ini)', async () => {
    params.set('dari', 'bukan-tanggal');
    params.set('sampai', '2026-09-30');
    render(<CetakPesanPerilakuPage />);
    await screen.findByText(/gabungan seluruh pelayanan/);
    expect(fetchMock.mock.calls[0][0]).not.toContain('bukan-tanggal');
  });

  it('C-01: galat RPC pengaduan (bukan migrasi) tidak dicetak sebagai nol: laporan diblokir dan ada tombol coba lagi', async () => {
    sumber.rpcGalat.ringkasan_pengaduan = { code: '57014', message: 'timeout' };
    render(<CetakPesanPerilakuPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Gagal memuat/);
    expect(screen.queryByText(/gabungan seluruh pelayanan/)).toBeNull();
    expect(screen.queryByText(/Tidak ada pengaduan pada periode ini/)).toBeNull();
    expect(screen.getByRole('button', { name: /Cetak/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Coba lagi/ })).toBeInTheDocument();
  });

  it('C-01: galat query saran juga memblokir laporan', async () => {
    sumber.saran.error = { code: '500', message: 'boom' };
    render(<CetakPesanPerilakuPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Gagal memuat/);
    expect(screen.queryByText('Tambah kursi tunggu')).toBeNull();
    expect(screen.getByRole('button', { name: /Cetak/ })).toBeDisabled();
  });

  it('C-01: migrasi saran/pengaduan belum diterapkan => bagian itu tertulis belum tersedia, bukan nol, dan laporan tetap bisa dicetak', async () => {
    sumber.rpcGalat.ringkasan_pengaduan = { code: 'PGRST202', message: 'no function' };
    sumber.rpcGalat.ringkasan_saran = { code: 'PGRST202', message: 'no function' };
    sumber.saran.error = { code: 'PGRST205', message: 'no table' };
    render(<CetakPesanPerilakuPage />);
    await screen.findByText(/gabungan seluruh pelayanan/);
    expect(screen.getByText(/Data pengaduan belum tersedia/)).toBeInTheDocument();
    expect(screen.getByText(/Data saran belum tersedia/)).toBeInTheDocument();
    expect(screen.queryByText(/Tidak ada pengaduan pada periode ini/)).toBeNull();
    expect(screen.queryByText(/Tidak ada saran pada periode ini/)).toBeNull();
    expect(screen.getByRole('button', { name: /Cetak/ })).toBeEnabled();
  });

  it('C-02: galat saat memuat ulang periode lain membersihkan data lama; angka lama tidak tampil berlabel periode baru', async () => {
    render(<CetakPesanPerilakuPage />);
    await screen.findByText(/gabungan seluruh pelayanan/);
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    fireEvent.click(screen.getByRole('button', { name: /^Rentang tanggal:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hari ini' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Gagal memuat/);
    expect(screen.queryByText(/Periode /)).toBeNull();
    expect(screen.queryByText('Tambah kursi tunggu')).toBeNull();
    expect(screen.getByRole('button', { name: /Cetak/ })).toBeDisabled();
  });

  it('C-02: coba lagi memuat ulang dan laporan kembali', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    render(<CetakPesanPerilakuPage />);
    await screen.findByRole('alert');
    fetchMock.mockResolvedValue(new Response(JSON.stringify(GLOBAL), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    await screen.findByText(/gabungan seluruh pelayanan/);
    expect(screen.getByRole('button', { name: /Cetak/ })).toBeEnabled();
  });

  it('migrasi ringkasan survei belum diterapkan: catatan khusus tanpa angka atau kertas laporan, lalu dapat dicoba lagi', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'MIGRASI_BELUM_DITERAPKAN' }), { status: 409 }));
    render(<CetakPesanPerilakuPage />);
    expect(await screen.findByRole('note')).toHaveTextContent(/pembaruan basis data belum diterapkan/);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.getElementById('laporan-cetak')).toBeNull();
    expect(screen.getByRole('button', { name: /Cetak/ })).toBeDisabled();

    fetchMock.mockResolvedValue(new Response(JSON.stringify(GLOBAL), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await screen.findByText(/gabungan seluruh pelayanan/);
    expect(screen.getByRole('button', { name: /Cetak/ })).toBeEnabled();
  });

  it('B-02: saran melebihi batas dicetak dengan catatan "menampilkan N dari M saran terbaru"', async () => {
    DATA.ringkasan_saran = [{ layanan_id: 'a', unit: 'layanan', nama: 'Layanan OSS', jumlah: 450 }];
    sumber.saran.data = Array.from({ length: 300 }, (_, i) => ({ id: `s${i}`, isi: `Saran ke-${i}`, created_at: '2026-10-28T03:00:00Z', pelapor_nama: null, unit: 'fo', layanan: null }));
    sumber.saran.count = 450;
    render(<CetakPesanPerilakuPage />);
    await screen.findByText(/gabungan seluruh pelayanan/);
    expect(screen.getByText(/menampilkan 300 dari 450 saran terbaru/i)).toBeInTheDocument();
    DATA.ringkasan_saran = [{ layanan_id: 'a', unit: 'layanan', nama: 'Layanan OSS', jumlah: 1 }];
  });

  it('B-02: bila semua saran tampil tidak ada catatan terpotong', async () => {
    render(<CetakPesanPerilakuPage />);
    await screen.findByText(/gabungan seluruh pelayanan/);
    expect(screen.queryByText(/menampilkan .* dari .* saran terbaru/i)).toBeNull();
  });

  it('B-11: rentang belum lengkap atau dibatalkan tidak memicu permintaan baru', async () => {
    params.set('dari', '2026-09-10');
    params.set('sampai', '2026-09-30');
    render(<CetakPesanPerilakuPage />);
    await screen.findByText(/gabungan seluruh pelayanan/);
    const jumlah = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /^Rentang tanggal:/ }));
    fireEvent.click(screen.getByRole('button', { name: /^15 September 2026/ }));
    expect(screen.getByRole('button', { name: 'Terapkan' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock.mock.calls.length).toBe(jumlah);
  });

  it('B-11: rentang dipilih mundur menjadi urut sebelum memuat laporan', async () => {
    params.set('dari', '2026-09-10');
    params.set('sampai', '2026-09-30');
    render(<CetakPesanPerilakuPage />);
    await screen.findByText(/gabungan seluruh pelayanan/);
    const jumlah = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /^Rentang tanggal:/ }));
    fireEvent.click(screen.getByRole('button', { name: /^20 September 2026/ }));
    fireEvent.click(screen.getByRole('button', { name: /^10 September 2026/ }));
    expect(fetchMock.mock.calls).toHaveLength(jumlah);
    fireEvent.click(screen.getByRole('button', { name: 'Terapkan' }));
    await waitFor(() => expect(fetchMock.mock.calls).toHaveLength(jumlah + 1));
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/admin/survei/ringkasan?dari=2026-09-10&sampai=2026-09-20');
    expect(await screen.findByText(/Periode 10 September 2026 s\.d\. 20 September 2026/)).toBeInTheDocument();
  });

  it('B-03: catatan ambang IKM memakai tabel resmi (88,31 / 76,61 / 65,00)', async () => {
    render(<CetakPesanPerilakuPage />);
    await screen.findByText(/gabungan seluruh pelayanan/);
    expect(screen.getByText(/A ≥ 88,31; B ≥ 76,61; C ≥ 65,00; D di bawah 65,00/)).toBeInTheDocument();
    expect(screen.getByText(/PermenPANRB No\. 14 Tahun 2017/)).toBeInTheDocument();
  });
});
