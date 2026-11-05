// @vitest-environment jsdom
// Saran admin/FO: ringkasan klik, penyaring, penandaan "sudah ditinjau", lencana sumber, waktu anonim (migrasi
// 202611030010) dan perilaku saat migrasi 202611030013 (kolom ditinjau_pada + RPC) belum diterapkan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { punyaOp, type Op } from '@/test/fo-supabase-mock';

vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));

const h = vi.hoisted(() => ({
  hasil: vi.fn(),
  rpc: vi.fn(),
  toast: vi.fn(),
  segarkan: vi.fn(),
  log: [] as { tabel: string; kolom: string; opsiSelect: unknown; ops: [string, unknown[]][] }[],
}));

vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/lib/hooks/useNavBadges', () => ({ segarkanBadge: h.segarkan }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: (nama: string, args: unknown) => Promise.resolve(h.rpc(nama, args)),
    from: (tabel: string) => ({
      select: (kolom: string, opsiSelect?: unknown) => {
        const ops: [string, unknown[]][] = [];
        const rantai: Record<string, unknown> = {
          then: (ok: (v: unknown) => unknown, gagal?: (e: unknown) => unknown) => {
            const entri = { tabel, kolom, opsiSelect, ops };
            h.log.push(entri);
            return Promise.resolve(h.hasil(entri)).then(ok, gagal);
          },
        };
        for (const m of ['gte', 'lt', 'order', 'range', 'eq', 'neq', 'is', 'not', 'ilike', 'limit']) {
          rantai[m] = (...a: unknown[]) => { ops.push([m, a]); return rantai; };
        }
        return rantai;
      },
    }),
  }),
}));

import SaranPage from './page';

const baris = (o: Record<string, unknown>) => ({
  id: 's1', isi: 'Tolong tambah kursi', unit: 'fo', pelapor_nama: null, sumber: 'wizard', layanan: null,
  created_at: '2026-11-01T17:00:00Z', anonim: true, ditinjau_pada: null, ...o,
});

const SARAN = [
  baris({ id: 's1' }),
  baris({ id: 's2', isi: 'Loket AC rusak', unit: 'layanan', anonim: false, pelapor_nama: 'Sari', layanan: { nama: 'Loket A' }, created_at: '2026-11-02T05:30:00Z' }),
  baris({ id: 's3', isi: 'Peta lokasi kurang jelas', unit: 'tidak_diketahui', sumber: 'publik', anonim: true, ditinjau_pada: '2026-11-02T08:00:00Z' }),
];

type Entri = (typeof h.log)[number];
const opsDari = (e: Entri) => e.ops as Op[];
const isHead = (e: Entri) => (e.opsiSelect as { head?: boolean } | undefined)?.head === true;
const daftar = () => h.log.filter((e) => e.tabel === 'saran' && !isHead(e) && e.kolom !== 'id');
const hitungan = () => h.log.filter((e) => e.tabel === 'saran' && isHead(e));

/** Semua migrasi sudah diterapkan: daftar, hitungan belum=2/sudah=1, layanan, dan id untuk Tandai semua. */
function jawabanLengkap(e: Entri) {
  if (e.tabel === 'layanan') return { data: [{ id: 'l1', nama: 'Loket A' }], error: null };
  if (isHead(e)) return { count: punyaOp(opsDari(e), 'is', 'ditinjau_pada', null) ? 2 : punyaOp(opsDari(e), 'not', 'ditinjau_pada') ? 1 : 3, error: null };
  if (e.kolom === 'id') return { data: [{ id: 's1' }, { id: 's2' }], error: null };
  return { data: SARAN, count: 3, error: null };
}

beforeEach(() => {
  h.log.length = 0;
  h.hasil.mockReset().mockImplementation(jawabanLengkap);
  h.rpc.mockReset().mockReturnValue({ data: null, error: null });
  h.toast.mockReset();
  h.segarkan.mockReset();
});
afterEach(cleanup);

describe('Saran admin: ringkasan dan penyaring status', () => {
  it('memuat: tampil status memuat lalu angka ringkasan; bawaan = Belum ditinjau', async () => {
    render(<SaranPage />);
    expect(screen.getByRole('status').textContent).toMatch(/Memuat saran/);
    await screen.findByText('Tolong tambah kursi');
    const grup = screen.getByRole('group', { name: /status tinjauan/i });
    expect(within(grup).getByRole('button', { name: /Belum ditinjau/ }).textContent).toMatch(/2/);
    expect(within(grup).getByRole('button', { name: /Sudah ditinjau/ }).textContent).toMatch(/1/);
    expect(within(grup).getByRole('button', { name: /Belum ditinjau/ })).toHaveAttribute('aria-pressed', 'true');
    // daftar bawaan hanya yang belum ditinjau
    expect(punyaOp(opsDari(daftar()[0]), 'is', 'ditinjau_pada', null)).toBe(true);
  });

  it('klik angka "Sudah ditinjau" menyaring ke yang sudah ditinjau dan kembali ke halaman pertama', async () => {
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    h.log.length = 0;
    fireEvent.click(screen.getByRole('button', { name: /Sudah ditinjau/ }));
    await waitFor(() => expect(daftar().length).toBeGreaterThan(0));
    expect(punyaOp(opsDari(daftar()[0]), 'not', 'ditinjau_pada', 'is', null)).toBe(true);
    expect(punyaOp(opsDari(daftar()[0]), 'range', 0, 24)).toBe(true);
    expect(screen.getByRole('button', { name: /Sudah ditinjau/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"Semua" tidak menyaring status', async () => {
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    h.log.length = 0;
    fireEvent.click(screen.getByRole('button', { name: /^Semua/ }));
    await waitFor(() => expect(daftar().length).toBeGreaterThan(0));
    expect(punyaOp(opsDari(daftar()[0]), 'is', 'ditinjau_pada')).toBe(false);
    expect(punyaOp(opsDari(daftar()[0]), 'not', 'ditinjau_pada')).toBe(false);
  });

  it('hitungan ikut penyaring lain (layanan) tetapi tidak ikut status', async () => {
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    await screen.findByRole('option', { name: 'Loket A' });
    h.log.length = 0;
    fireEvent.change(screen.getByLabelText('Layanan'), { target: { value: 'l1' } });
    await waitFor(() => expect(hitungan().length).toBe(2));
    for (const e of hitungan()) expect(punyaOp(opsDari(e), 'eq', 'layanan_id', 'l1')).toBe(true);
  });
});

describe('Saran admin: penyaring layanan, sumber, kata', () => {
  it('rentang kalender memakai hari WIB dan meneruskan pilihan ke kueri yang sama', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T18:30:00Z')); // 1 November, 01.30 WIB.
    try {
      render(<SaranPage />);
      await screen.findByText('Tolong tambah kursi');
      expect(punyaOp(opsDari(daftar()[0]), 'gte', 'created_at', '2026-11-01T00:00:00+07:00')).toBe(true);
      h.log.length = 0;
      fireEvent.click(screen.getByRole('button', { name: /^Rentang tanggal saran:/ }));
      const kalender = screen.getByRole('dialog', { name: 'Rentang tanggal saran' });
      fireEvent.click(within(kalender).getByRole('button', { name: '7 hari terakhir' }));
      await waitFor(() => expect(daftar().length).toBeGreaterThan(0));
      expect(punyaOp(opsDari(daftar().at(-1)!), 'gte', 'created_at', '2026-10-26T00:00:00+07:00')).toBe(true);
      expect(punyaOp(opsDari(daftar().at(-1)!), 'lt', 'created_at', '2026-11-02T00:00:00+07:00')).toBe(true);
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('layanan dan sumber disaring di server', async () => {
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    await screen.findByRole('option', { name: 'Loket A' });

    h.log.length = 0;
    fireEvent.change(screen.getByLabelText('Sumber'), { target: { value: 'publik' } });
    await waitFor(() => expect(daftar().length).toBeGreaterThan(0));
    expect(punyaOp(opsDari(daftar()[0]), 'eq', 'sumber', 'publik')).toBe(true);

    h.log.length = 0;
    fireEvent.change(screen.getByLabelText('Sumber'), { target: { value: 'fo' } });
    await waitFor(() => expect(daftar().length).toBeGreaterThan(0));
    expect(punyaOp(opsDari(daftar()[0]), 'eq', 'sumber', 'wizard')).toBe(true);
    expect(punyaOp(opsDari(daftar()[0]), 'eq', 'unit', 'fo')).toBe(true);

    h.log.length = 0;
    fireEvent.change(screen.getByLabelText('Sumber'), { target: { value: 'layanan' } });
    await waitFor(() => expect(daftar().length).toBeGreaterThan(0));
    expect(punyaOp(opsDari(daftar()[0]), 'eq', 'unit', 'layanan')).toBe(true);
  });

  it('kotak cari: menunggu jeda mengetik, wildcard di-escape', async () => {
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    h.log.length = 0;
    fireEvent.change(screen.getByLabelText('Cari isi saran'), { target: { value: '50%_kursi' } });
    expect(daftar()).toHaveLength(0); // belum ada kueri sebelum jeda
    await waitFor(() => expect(daftar().length).toBeGreaterThan(0), { timeout: 2000 });
    expect(punyaOp(opsDari(daftar()[0]), 'ilike', 'isi', '%50\\%\\_kursi%')).toBe(true);
  });
});

describe('Saran admin: lencana sumber dan status', () => {
  it('sumber dinyatakan jelas; status tiap saran tampil', async () => {
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    // option penyaring Sumber memuat teks yang sama: periksa hanya lencana di dalam kartu
    expect(screen.getByText('Dari survei · Front Office', { selector: 'li span' })).toBeTruthy();
    expect(screen.getByText('Dari survei · Loket A', { selector: 'li span' })).toBeTruthy();
    expect(screen.getByText('Tautan publik', { selector: 'li span' })).toBeTruthy();
    expect(screen.getAllByText('Belum ditinjau', { selector: 'li span' })).toHaveLength(2);
    expect(screen.getByText(/Ditinjau 2 Nov 2026/)).toBeTruthy();
  });
});

describe('Saran admin: menandai sudah ditinjau', () => {
  it('tombol per saran memanggil RPC satu id, memberi tahu, memuat ulang, dan menyegarkan lencana menu', async () => {
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    h.log.length = 0;
    fireEvent.click(screen.getAllByRole('button', { name: /Tandai ditinjau/ })[0]);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('tandai_saran_ditinjau', { p_ids: ['s1'], p_ditinjau: true }));
    await waitFor(() => expect(h.segarkan).toHaveBeenCalled());
    expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/ditandai/i), 'success');
    await waitFor(() => expect(daftar().length).toBeGreaterThan(0)); // dimuat ulang
  });

  it('saran yang sudah ditinjau tidak punya tombol tandai', async () => {
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    expect(screen.getAllByRole('button', { name: /Tandai ditinjau/ })).toHaveLength(2); // s1 dan s2, bukan s3
  });

  it('"Tandai semua" meminta konfirmasi dengan jumlah, lalu mengirim semua id yang cocok', async () => {
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    fireEvent.click(screen.getByRole('button', { name: /Tandai semua/ }));
    expect(await screen.findByText(/Tandai 2 saran/)).toBeTruthy();
    expect(h.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Ya, tandai/ }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('tandai_saran_ditinjau', { p_ids: ['s1', 's2'], p_ditinjau: true }));
    // id diambil dengan penyaring yang sama dan hanya yang belum ditinjau
    const ambilId = h.log.find((e) => e.kolom === 'id' && !isHead(e))!;
    expect(punyaOp(opsDari(ambilId), 'is', 'ditinjau_pada', null)).toBe(true);
    await waitFor(() => expect(h.segarkan).toHaveBeenCalled());
  });

  it('"Tandai semua" lebih dari 500 id dikirim per batch 500 (batas RPC)', async () => {
    const banyak = Array.from({ length: 620 }, (_, i) => ({ id: `x${i}` }));
    h.hasil.mockImplementation((e: Entri) => e.kolom === 'id' && !isHead(e) ? { data: banyak, error: null } : jawabanLengkap(e));
    h.rpc.mockImplementation((_n: string, a: { p_ids: string[] }) => ({ data: a.p_ids.length, error: null }));
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    fireEvent.click(screen.getByRole('button', { name: /Tandai semua/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Ya, tandai/ }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(2));
    expect(h.rpc.mock.calls.map((c) => (c[1] as { p_ids: string[] }).p_ids.length)).toEqual([500, 120]);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('620 saran ditandai sudah ditinjau.', 'success'));
  });

  it('"Tandai semua" bisa dibatalkan', async () => {
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    fireEvent.click(screen.getByRole('button', { name: /Tandai semua/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Batal/ }));
    expect(screen.queryByText(/Tandai 2 saran/)).toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('UI-01: himpunan id dibekukan saat konfirmasi disiapkan; kiriman yang masuk sesudahnya tidak ikut', async () => {
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    fireEvent.click(screen.getByRole('button', { name: /Tandai semua/ }));
    expect(await screen.findByText(/Tandai 2 saran/)).toBeTruthy();
    // sesudah konfirmasi tampil, saran ketiga masuk: pengambilan id berikutnya akan memuatnya
    h.hasil.mockImplementation((e: Entri) => e.kolom === 'id' && !isHead(e) ? { data: [{ id: 's1' }, { id: 's2' }, { id: 's-baru' }], error: null } : jawabanLengkap(e));
    fireEvent.click(screen.getByRole('button', { name: /Ya, tandai/ }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('tandai_saran_ditinjau', { p_ids: ['s1', 's2'], p_ditinjau: true });
    expect(h.log.filter((e) => e.kolom === 'id' && !isHead(e))).toHaveLength(1);
  });

  it('UI-01: mengganti penyaring membuang himpunan beku (konfirmasi hilang, id baru diambil saat dibuka lagi)', async () => {
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    fireEvent.click(screen.getByRole('button', { name: /Tandai semua/ }));
    await screen.findByText(/Tandai 2 saran/);
    fireEvent.change(screen.getByLabelText('Sumber'), { target: { value: 'publik' } });
    expect(screen.queryByText(/Tandai 2 saran/)).toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('UI-08: lebih dari 1000 sasaran diambil per halaman tanpa batas diam-diam; jumlah konfirmasi = jumlah yang dikirim', async () => {
    const semuaId = Array.from({ length: 1001 }, (_, i) => ({ id: `x${i}` }));
    h.hasil.mockImplementation((e: Entri) => {
      if (e.kolom === 'id' && !isHead(e)) {
        const r = opsDari(e).find((o) => o[0] === 'range');
        if (!r) return { data: semuaId, error: null }; // tanpa range = terpotong 1000 diam-diam
        const [a, b] = r[1] as [number, number];
        return { data: semuaId.slice(a, b + 1), error: null };
      }
      return jawabanLengkap(e);
    });
    h.rpc.mockImplementation((_n: string, a: { p_ids: string[] }) => ({ data: a.p_ids.length, error: null }));
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    fireEvent.click(screen.getByRole('button', { name: /Tandai semua/ }));
    expect(await screen.findByText(/Tandai 1001 saran/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ya, tandai/ }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('1001 saran ditandai sudah ditinjau.', 'success'));
    const terkirim = h.rpc.mock.calls.flatMap((c) => (c[1] as { p_ids: string[] }).p_ids);
    expect(terkirim).toHaveLength(1001);
    expect(new Set(terkirim).size).toBe(1001);
    // urutan stabil (kiriman baru ke ujung) dan tanpa limit()
    const ambil = h.log.filter((e) => e.kolom === 'id' && !isHead(e));
    expect(ambil.length).toBe(2);
    for (const e of ambil) expect(opsDari(e).some((o) => o[0] === 'limit')).toBe(false);
  });

  it('UI-08: gagal mengambil id saat menyiapkan konfirmasi: pesan galat, tanpa konfirmasi', async () => {
    h.hasil.mockImplementation((e: Entri) => e.kolom === 'id' && !isHead(e) ? { data: null, error: { code: '500', message: 'x' } } : jawabanLengkap(e));
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    fireEvent.click(screen.getByRole('button', { name: /Tandai semua/ }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Gagal menandai saran. Coba lagi.', 'error'));
    expect(screen.queryByRole('group', { name: /Konfirmasi tandai semua/ })).toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('RPC gagal: pesan galat, daftar tidak berubah', async () => {
    h.rpc.mockReturnValue({ data: null, error: { code: '500', message: 'x' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    fireEvent.click(screen.getAllByRole('button', { name: /Tandai ditinjau/ })[0]);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/Gagal menandai/), 'error'));
    expect(h.segarkan).not.toHaveBeenCalled();
  });

  it('RPC belum ada (migrasi belum diterapkan): pesan jelas, bukan galat umum', async () => {
    h.rpc.mockReturnValue({ data: null, error: { code: 'PGRST202', message: 'no function' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    fireEvent.click(screen.getAllByRole('button', { name: /Tandai ditinjau/ })[0]);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/belum aktif/i), 'error'));
  });
});

describe('Saran admin: migrasi belum diterapkan', () => {
  const tanpaTinjau = (e: Entri) => e.kolom.includes('ditinjau_pada')
    ? { data: null, count: null, error: { code: '42703', message: 'column saran.ditinjau_pada does not exist' } }
    : { data: [baris({ created_at: '2026-11-02T05:30:00Z', anonim: false, ditinjau_pada: undefined })], count: 1, error: null };

  it('kolom ditinjau_pada belum ada: daftar tetap tampil, tanpa tombol tandai dan ringkasan, dengan keterangan', async () => {
    h.hasil.mockImplementation((e: Entri) => e.tabel === 'layanan' ? { data: [], error: null } : tanpaTinjau(e));
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    expect(screen.queryByRole('button', { name: /Tandai/ })).toBeNull();
    expect(screen.queryByRole('group', { name: /status tinjauan/i })).toBeNull();
    expect(screen.getByRole('note').textContent).toMatch(/penandaan.*belum aktif/i);
    expect(screen.queryByRole('alert')).toBeNull();
    // tanpa penyaring status: tidak ada operasi is/not pada ditinjau_pada pada kueri yang berhasil
    expect(punyaOp(opsDari(daftar().at(-1)!), 'is', 'ditinjau_pada')).toBe(false);
  });

  it('kolom anonim juga belum ada (0010): ulang tanpa kolom, tampil seperti sebelumnya', async () => {
    h.hasil.mockImplementation((e: Entri) => e.tabel === 'layanan' ? { data: [], error: null }
      : e.kolom.includes('anonim')
        ? { data: null, count: null, error: { code: '42703', message: 'column saran.anonim does not exist' } }
        : { data: [baris({ anonim: undefined, created_at: '2026-11-02T05:30:00Z' })], count: 1, error: null });
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    const kolomDipakai = daftar().map((e) => e.kolom);
    expect(kolomDipakai).toHaveLength(3);
    expect(kolomDipakai[2]).not.toContain('anonim');
    expect(screen.getByText(/12[.:]30 WIB/)).toBeTruthy();
    expect(screen.getByText(/· Anonim/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Saran admin: waktu', () => {
  it('anonim: tanggal WIB saja, tanpa jam dan tanpa "WIB"', async () => {
    h.hasil.mockImplementation((e: Entri) => e.tabel === 'saran' && !isHead(e) && e.kolom !== 'id'
      ? { data: [baris({ anonim: true })], error: null } : jawabanLengkap(e));
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    expect(screen.getByText(/2 Nov 2026/)).toBeTruthy();
    expect(screen.queryByText(/00[.:]00/)).toBeNull();
  });

  it('tidak anonim: tanggal dan jam WIB, nama pelapor', async () => {
    h.hasil.mockImplementation((e: Entri) => e.tabel === 'saran' && !isHead(e) && e.kolom !== 'id'
      ? { data: [baris({ anonim: false, pelapor_nama: 'Sari', created_at: '2026-11-02T05:30:00Z' })], error: null } : jawabanLengkap(e));
    render(<SaranPage />);
    await screen.findByText('Tolong tambah kursi');
    expect(screen.getByText(/2 Nov 2026.*12[.:]30 WIB/)).toBeTruthy();
    expect(screen.getByText(/· Sari$/)).toBeTruthy();
  });
});

describe('Saran admin: state', () => {
  it('kosong menurut status', async () => {
    h.hasil.mockImplementation((e: Entri) => e.tabel === 'layanan' ? { data: [], error: null }
      : isHead(e) ? { count: 0, error: null } : { data: [], error: null });
    render(<SaranPage />);
    expect(await screen.findByText(/Tidak ada saran yang belum ditinjau/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Tandai semua/ })).toBeNull();
  });

  it('galat: pesan dan tombol Coba lagi yang memuat ulang', async () => {
    h.hasil.mockImplementation((e: Entri) => e.tabel === 'layanan' ? { data: [], error: null }
      : { data: null, count: null, error: { code: '500', message: 'x' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SaranPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Gagal memuat saran/);
    h.hasil.mockImplementation(jawabanLengkap);
    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));
    await screen.findByText('Tolong tambah kursi');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});


// UI-10: teks lencana "Belum ditinjau" kecil (--text-xs) harus >= 4,5:1 di atas latarnya.
describe('Saran admin: kontras lencana Belum ditinjau', () => {
  it('warna teks dan latar lencana memenuhi 4,5:1', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(process.cwd(), 'src/components/ui/Lencana.module.css'), 'utf8');
    const globals = readFileSync(resolve(process.cwd(), 'src/styles/tema-dasbor.css'), 'utf8');
    const token = (nama: string): string => {
      const m = globals.match(new RegExp(`--${nama}:\\s*([^;]+);`));
      expect(m, nama).toBeTruthy();
      const v = m![1].trim();
      const ref = v.match(/^var\(--([\w-]+)\)$/);
      return ref ? token(ref[1]) : v;
    };
    const blok = css.match(/\.peringatan\s*\{([^}]*)\}/)![1];
    const warna = (prop: string) => {
      const m = blok.match(new RegExp(`${prop}:\\s*var\\(--([\\w-]+)\\)`));
      expect(m, prop).toBeTruthy();
      return token(m![1]);
    };
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const a = lum(warna('color')), b = lum(warna('background'));
    const rasio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    expect(rasio).toBeGreaterThanOrEqual(4.5);
  });
});
