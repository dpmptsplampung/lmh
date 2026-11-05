// @vitest-environment jsdom
// Audit T4: layar TV tidak boleh berubah menjadi "Token tidak valid" permanen karena gangguan
// jaringan sesaat; data terakhir dipertahankan; pulih otomatis dengan backoff.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/site-settings', () => ({ getSiteSettings: vi.fn().mockResolvedValue({}) }));

import LayarTokenPage from './page';
import { createClient } from '@/lib/supabase/client';
import { getSiteSettings } from '@/lib/site-settings';
import { backoffMs } from '@/lib/layar/koneksi';
import { hariIsoWIB } from '@/lib/layar/tataLayar';

interface Baris {
  layanan_id: string;
  layanan_nama: string;
  tipe: string;
  antre_count: number;
  dilayani_count: number;
  nomor_sedang_dilayani: number | null;
  nomor_display_dilayani: string | null;
  estimasi_durasi_menit: number;
  estimasi_tunggu_total_menit: number;
  nama_layar?: string | null;
  nama_tampil?: string | null;
  urutan_layar?: number | null;
}

const baris = (over: Partial<Baris> = {}): Baris => ({
  layanan_id: 'l1',
  layanan_nama: 'Helpdesk OSS',
  tipe: 'konsultatif',
  antre_count: 2,
  dilayani_count: 1,
  nomor_sedang_dilayani: null,
  nomor_display_dilayani: null,
  estimasi_durasi_menit: 15,
  estimasi_tunggu_total_menit: 30,
  ...over,
});

const rpc = vi.fn();
const order = vi.fn();
let siaran: (() => void) | null = null;
// Kejadian panggilan_layar yang "ada di database"; polling pita membacanya lewat rantai kueri palsu.
let panggilanDb: Array<{ id: string; layanan_id: string; nomor_display: string; label: string | null; dibuat_at: string }> = [];

function pasangMock() {
  const channelApi = {
    on: vi.fn((tipe: string, _filter: unknown, cb: () => void) => { if (tipe === 'broadcast') siaran = cb; return channelApi; }),
    subscribe: vi.fn(() => channelApi),
  };
  const rantaiPanggilan = (q: { gte?: string; naik?: boolean } = {}) => ({
    select: () => rantaiPanggilan(q),
    gte: (_k: string, v: string) => rantaiPanggilan({ ...q, gte: v }),
    order: (_k: string, o: { ascending: boolean }) => rantaiPanggilan({ ...q, naik: o.ascending }),
    limit: async (n: number) => {
      const data = panggilanDb
        .filter(b => !q.gte || b.dibuat_at >= q.gte)
        .sort((a, b) => (a.dibuat_at < b.dibuat_at ? -1 : 1) * (q.naik ? 1 : -1))
        .slice(0, n);
      return { data, error: null };
    },
  });
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc,
    from: vi.fn((tabel: string) => (tabel === 'panggilan_layar' ? rantaiPanggilan() : { select: vi.fn(() => order()) })),
    channel: vi.fn(() => channelApi),
    removeChannel: vi.fn().mockResolvedValue('ok'),
  });
}

const sukses = (data: Baris[]) => ({ data, error: null });
const gagal = () => ({ data: null, error: new Error('network down') });

// React `use()` membaca promise berstatus 'fulfilled' secara sinkron (tanpa Suspense).
function paramsSiap(token: string) {
  const p = Promise.resolve({ token });
  return Object.assign(p, { status: 'fulfilled' as const, value: { token } });
}

async function renderHalaman() {
  await act(async () => {
    render(<LayarTokenPage params={paramsSiap('tok-abc')} />);
  });
}

// Jumlah pemanggilan validasi token (RPC status buka/tutup layanan ikut memakai `rpc`, tidak dihitung).
const panggilanValidasi = () => rpc.mock.calls.filter(c => c[0] === 'validate_layar_token').length;

async function maju(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe('Layar TV /layar/[token] — ketahanan jaringan (T4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    order.mockReset();
    siaran = null;
    panggilanDb = [];
    pasangMock();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each([' 4820 5917 ', '\t4820\u00a0\n5917\t'])('membuang seluruh spasi dari token %j sebelum validasi RPC', async token => {
    rpc.mockResolvedValue({ data: false, error: null });
    await act(async () => {
      render(<LayarTokenPage params={paramsSiap(token)} />);
    });
    expect(rpc).toHaveBeenCalledWith('validate_layar_token', { p_token: '48205917' });
  });

  it('backoff eksponensial dengan batas atas 30 detik', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20, 1000].map(backoffMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000,
    ]);
  });

  it('token yang dijawab RPC `false` tetap dikenali sebagai tidak valid dan tidak dicoba ulang', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await renderHalaman();

    expect(screen.getByText(/Token tidak valid atau sudah dicabut/)).toBeInTheDocument();
    await maju(120_000);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(order).not.toHaveBeenCalled(); // data antrean tidak pernah diminta
  });

  it('error RPC (jaringan) BUKAN token tidak valid: "Menghubungkan ulang…" lalu pulih otomatis', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
      .mockResolvedValue({ data: true, error: null });
    order.mockResolvedValue(sukses([baris()]));

    await renderHalaman();
    expect(screen.getByText('Menghubungkan ulang…')).toBeInTheDocument();
    expect(screen.queryByText(/Token tidak valid/)).not.toBeInTheDocument();

    await maju(1000); // coba ulang #1 (backoff 1 dtk) — gagal lagi
    expect(panggilanValidasi()).toBe(2);
    expect(screen.queryByText(/Token tidak valid/)).not.toBeInTheDocument();
    await maju(1999); // backoff ke-2 = 2 dtk: belum
    expect(panggilanValidasi()).toBe(2);
    await maju(1); // sekarang
    expect(panggilanValidasi()).toBe(3);

    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    expect(screen.queryByText('Menghubungkan ulang…')).not.toBeInTheDocument();
  });

  it('RPC melempar (fetch gagal) atau menggantung (timeout) juga dianggap gangguan, bukan invalid', async () => {
    rpc
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce(() => new Promise(() => {})) // menggantung selamanya
      .mockResolvedValue({ data: true, error: null });
    order.mockResolvedValue(sukses([baris()]));

    await renderHalaman();
    expect(screen.getByText('Menghubungkan ulang…')).toBeInTheDocument();
    await maju(1000); // percobaan ke-2 menggantung
    expect(screen.queryByText(/Token tidak valid/)).not.toBeInTheDocument();
    await maju(10_000); // batas waktu → gangguan, jadwal ulang 2 dtk
    expect(screen.getByText('Menghubungkan ulang…')).toBeInTheDocument();
    await maju(2000);
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
  });

  it('gangguan saat memuat data: data terakhir TIDAK dihapus, ada status menghubungkan ulang, lalu pulih', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    order
      .mockResolvedValueOnce(sukses([baris({ nomor_display_dilayani: 'OS-014' })]))
      .mockResolvedValueOnce(gagal())
      .mockResolvedValueOnce(gagal())
      .mockResolvedValue(sukses([baris({ nomor_display_dilayani: 'OS-015' })]));

    await renderHalaman();
    expect(screen.getByText('OS-014')).toBeInTheDocument();

    await maju(15_000); // polling → gagal
    expect(screen.getByText('OS-014')).toBeInTheDocument(); // data lama tetap
    expect(screen.getByText(/Menghubungkan ulang… menampilkan data terakhir/)).toBeInTheDocument();
    expect(screen.queryByText(/Token tidak valid/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Gagal memuat/)).not.toBeInTheDocument();

    await maju(1000); // backoff 1 dtk → gagal lagi, data tetap
    expect(screen.getByText('OS-014')).toBeInTheDocument();
    await maju(2000); // backoff 2 dtk → pulih
    expect(screen.getByText('OS-015')).toBeInTheDocument();
    expect(screen.queryByText(/menampilkan data terakhir/)).not.toBeInTheDocument();
  });

  it('data pertama gagal: tampil "Menghubungkan ulang…" (bukan token invalid) lalu pulih', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    order.mockResolvedValueOnce(gagal()).mockResolvedValue(sukses([baris()]));

    await renderHalaman();
    expect(screen.getByText('Menghubungkan ulang…')).toBeInTheDocument();
    await maju(1000);
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
  });

  it('dua siaran identik beruntun hanya memicu satu muat ulang (debounce, tanpa flicker)', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    order.mockResolvedValue(sukses([baris()]));

    await renderHalaman();
    expect(order).toHaveBeenCalledTimes(1);
    expect(siaran).not.toBeNull();

    await act(async () => { siaran?.(); siaran?.(); });
    await maju(100);
    expect(order).toHaveBeenCalledTimes(1); // masih menunggu debounce
    await maju(400);
    expect(order).toHaveBeenCalledTimes(2); // satu muat ulang untuk dua siaran
  });

  it('format nomor 2 huruf (OS-014) tampil utuh; hanya pita kejadian menjadi region panggilan', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    order.mockResolvedValue(sukses([baris({ nomor_display_dilayani: 'OS-014' })]));
    await renderHalaman();
    expect(screen.getByText('OS-014')).toBeInTheDocument();
    expect(document.querySelectorAll('[aria-live="polite"][aria-atomic="true"]')).toHaveLength(1);
    expect(screen.getByTestId('pita-panggilan')).toBeEmptyDOMElement();
  });
});

const SEMUA_HARI = [1, 2, 3, 4, 5, 6, 7].map(hari => ({ hari, jam_mulai: '08:00', jam_selesai: '15:30' }));

type BarisStatus = {
  layanan_id: string;
  buka_sekarang?: boolean;
  libur_keterangan?: string | null;
  jadwal?: Array<{ hari: number; jam_mulai: string; jam_selesai: string }>;
};
const statusRpc = (daftar: BarisStatus[]) => async (nama: string) =>
  nama === 'validate_layar_token'
    ? { data: true, error: null }
    : { data: daftar.map(b => ({ buka_sekarang: false, libur_keterangan: null, jadwal: SEMUA_HARI, ...b })), error: null };

const layananBanyak = (n: number) => Array.from({ length: n }, (_, i) => ({ layanan_id: `id${i}`, layanan_nama: `Layanan ${i}` }));

function siapkanBanyak(n: number, tambahan: Partial<Baris> = {}) {
  const daftar = layananBanyak(n);
  rpc.mockImplementation(statusRpc(daftar.map(d => ({ layanan_id: d.layanan_id }))));
  order.mockResolvedValue(sukses(daftar.map(d => baris({ ...d, antre_count: 0, dilayani_count: 0, ...tambahan }))));
}

// Layar TV (.tim/layar-tv/KONTRAK.md) item 1 dan 2: tampil bila BERJADWAL HARI INI, sepanjang hari; kosong = terang.
describe('Layar TV /layar/[token] — layanan berjadwal hari ini', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    order.mockReset();
    siaran = null;
    panggilanDb = [];
    pasangMock();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('berjadwal hari ini tampil walau sekarang di luar jam buka (buka_sekarang=false)', async () => {
    rpc.mockImplementation(statusRpc([{ layanan_id: 'a', buka_sekarang: false }]));
    order.mockResolvedValue(sukses([baris({ layanan_id: 'a', layanan_nama: 'Helpdesk OSS', antre_count: 0, dilayani_count: 0 })]));
    await renderHalaman();
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
  });

  it('hari ini tidak ada di jadwal: tidak tampil walau buka_sekarang=true', async () => {
    const hariLain = (hariIsoWIB() % 7) + 1;
    rpc.mockImplementation(statusRpc([
      { layanan_id: 'a', buka_sekarang: true },
      { layanan_id: 'b', buka_sekarang: true, jadwal: [{ hari: hariLain, jam_mulai: '08:00', jam_selesai: '15:30' }] },
    ]));
    order.mockResolvedValue(sukses([
      baris({ layanan_id: 'a', layanan_nama: 'Helpdesk OSS' }),
      baris({ layanan_id: 'b', layanan_nama: 'BPJS Kesehatan' }),
    ]));
    await renderHalaman();
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    expect(screen.queryByText('BPJS Kesehatan')).not.toBeInTheDocument();
  });

  it('layanan nonaktif/terarsip (tidak ada di RPC) tidak tampil walau ada di view dan masih ada tiket', async () => {
    rpc.mockImplementation(statusRpc([{ layanan_id: 'a' }]));
    order.mockResolvedValue(sukses([
      baris({ layanan_id: 'a', layanan_nama: 'Helpdesk OSS' }),
      baris({ layanan_id: 'z', layanan_nama: 'Layanan Nonaktif', antre_count: 3, dilayani_count: 1 }),
    ]));
    await renderHalaman();
    expect(screen.queryByText('Layanan Nonaktif')).not.toBeInTheDocument();
  });

  it('tidak ada pengecualian "tutup tetapi masih ada tiket": hari ini tidak berjadwal tetap tersembunyi', async () => {
    const hariLain = (hariIsoWIB() % 7) + 1;
    rpc.mockImplementation(statusRpc([
      { layanan_id: 'a' },
      { layanan_id: 'b', jadwal: [{ hari: hariLain, jam_mulai: '08:00', jam_selesai: '15:30' }] },
    ]));
    order.mockResolvedValue(sukses([
      baris({ layanan_id: 'a', layanan_nama: 'Helpdesk OSS' }),
      baris({ layanan_id: 'b', layanan_nama: 'BPJS Kesehatan', antre_count: 2, dilayani_count: 1 }),
    ]));
    await renderHalaman();
    expect(screen.queryByText('BPJS Kesehatan')).not.toBeInTheDocument();
  });

  it('tidak ada satu pun layanan berjadwal: layar terang polos tanpa teks, header, atau teks berjalan', async () => {
    const hariLain = (hariIsoWIB() % 7) + 1;
    (getSiteSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ running_text_layar: 'Pengumuman' });
    rpc.mockImplementation(statusRpc([
      { layanan_id: 'a', jadwal: [{ hari: hariLain, jam_mulai: '08:00', jam_selesai: '15:30' }] },
    ]));
    order.mockResolvedValue(sukses([baris({ layanan_id: 'a' })]));
    await renderHalaman();
    const terang = screen.getByTestId('layar-kosong');
    expect(terang.textContent).toBe('');
    expect(document.body.textContent).toBe('');
    expect(screen.queryByText('Status Antrean Layanan')).not.toBeInTheDocument();
    expect(screen.queryByText('Pengumuman')).not.toBeInTheDocument();
  });

  it('hari libur kalender: terang, tanpa pesan', async () => {
    rpc.mockImplementation(statusRpc([{ layanan_id: 'a', libur_keterangan: 'Idul Fitri' }]));
    order.mockResolvedValue(sukses([baris({ layanan_id: 'a' })]));
    await renderHalaman();
    expect(screen.getByTestId('layar-kosong')).toBeInTheDocument();
    expect(document.body.textContent).toBe('');
  });

  it('jadwal berubah saat layar menyala: layar menjadi terang pada muat ulang berikutnya, lalu kembali tampil', async () => {
    let berjadwal = true;
    rpc.mockImplementation(async (nama: string) =>
      nama === 'validate_layar_token'
        ? { data: true, error: null }
        : { data: [{ layanan_id: 'a', buka_sekarang: false, libur_keterangan: null, jadwal: berjadwal ? SEMUA_HARI : [] }], error: null },
    );
    order.mockResolvedValue(sukses([baris({ layanan_id: 'a' })]));
    await renderHalaman();
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    berjadwal = false;
    await maju(15_000);
    expect(screen.getByTestId('layar-kosong')).toBeInTheDocument();
    berjadwal = true;
    await maju(15_000);
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
  });

  it('jadwal tidak terbaca (RPC belum ada): semua layanan tampil dan ada tanda kecil, jadwal tidak ditebak', async () => {
    rpc.mockImplementation(async (nama: string) =>
      nama === 'validate_layar_token'
        ? { data: true, error: null }
        : { data: null, error: { message: 'function does not exist' } },
    );
    order.mockResolvedValue(sukses([
      baris({ layanan_id: 'a', layanan_nama: 'Helpdesk OSS' }),
      baris({ layanan_id: 'b', layanan_nama: 'BPJS Kesehatan' }),
    ]));
    await renderHalaman();
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    expect(screen.getByText('BPJS Kesehatan')).toBeInTheDocument();
    expect(screen.getByText('Jadwal belum terbaca')).toBeInTheDocument();
  });

  it('jadwal terbaca: tanda "Jadwal belum terbaca" tidak ada', async () => {
    siapkanBanyak(2);
    await renderHalaman();
    expect(screen.queryByText('Jadwal belum terbaca')).not.toBeInTheDocument();
  });
});

// Item 3: paling banyak 8 kartu per halaman, ganti tiap 8 detik berputar, sisa dirata tengah.
describe('Layar TV /layar/[token] — halaman 8 kartu', () => {
  beforeEach(() => {
    // Area kisi mendatar seperti TV sungguhan (rasio 2,3): 8 kartu = 4 kolom x 2 baris.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: 2300, height: 1000, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} }) as DOMRect,
    );
    vi.useFakeTimers();
    rpc.mockReset();
    order.mockReset();
    siaran = null;
    panggilanDb = [];
    pasangMock();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([[1, '1', '1'], [3, '2', '2'], [6, '3', '2'], [8, '4', '2']])(
    '%i layanan: satu halaman, kisi %s kolom x %s baris, semua kartu ada, tanpa penanda halaman',
    async (n, kolom, barisEks) => {
      siapkanBanyak(n);
      await renderHalaman();
      const kisi = screen.getByTestId('kisi-layanan');
      expect(kisi.style.getPropertyValue('--kolom')).toBe(kolom);
      expect(kisi.style.getPropertyValue('--baris')).toBe(barisEks);
      expect(kisi.querySelectorAll('section')).toHaveLength(n);
      expect(screen.queryByText(/Halaman \d+ dari/)).not.toBeInTheDocument();
    },
  );

  it('12 layanan: halaman 1 berisi 8 kartu, halaman 2 berisi 4, lalu kembali ke halaman 1 tiap 8 detik', async () => {
    siapkanBanyak(12);
    await renderHalaman();
    const kisi = () => screen.getByTestId('kisi-layanan');
    expect(kisi().querySelectorAll('section')).toHaveLength(8);
    expect(kisi().style.getPropertyValue('--kolom')).toBe('4');
    expect(screen.getByText('Halaman 1 dari 2')).toBeInTheDocument();
    expect(screen.getByText('Layanan 0')).toBeInTheDocument();
    expect(screen.queryByText('Layanan 8')).not.toBeInTheDocument();

    await maju(7_999);
    expect(screen.getByText('Halaman 1 dari 2')).toBeInTheDocument();
    await maju(1);
    expect(screen.getByText('Halaman 2 dari 2')).toBeInTheDocument();
    expect(kisi().querySelectorAll('section')).toHaveLength(4);
    // Ukuran kisi tetap (kartu sama besar); kartu sisa digeser ke tengah lewat letak sel.
    expect(kisi().style.getPropertyValue('--kolom')).toBe('4');
    const mulai = [...kisi().querySelectorAll('section')].map(x => (x as HTMLElement).style.gridColumn);
    expect(mulai).toEqual(['1 / span 2', '3 / span 2', '5 / span 2', '7 / span 2']);
    const baris1 = [...kisi().querySelectorAll('section')].map(x => (x as HTMLElement).style.gridRow);
    expect(new Set(baris1).size).toBe(1); // satu baris, tidak menempel di atas: bergeser ke tengah tegak
    expect(baris1[0]).toBe('2 / span 2');
    expect(screen.getByText('Layanan 8')).toBeInTheDocument();

    await maju(8_000);
    expect(screen.getByText('Halaman 1 dari 2')).toBeInTheDocument();
  });

  it('halaman sisa 3 kartu: bergeser setengah kartu ke kanan di baris terakhir', async () => {
    siapkanBanyak(11);
    await renderHalaman();
    await maju(8_000);
    const kol = [...screen.getByTestId('kisi-layanan').querySelectorAll('section')].map(x => (x as HTMLElement).style.gridColumn);
    expect(kol).toEqual(['2 / span 2', '4 / span 2', '6 / span 2']);
  });

  it('pergantian halaman tidak terganggu muat ulang data (hitung mundur tidak diulang)', async () => {
    siapkanBanyak(12);
    await renderHalaman();
    await maju(7_000); // muat ulang tiap 15 dtk, belum; sisa 1 dtk
    await maju(1_000);
    expect(screen.getByText('Halaman 2 dari 2')).toBeInTheDocument();
    await maju(8_000);
    expect(screen.getByText('Halaman 1 dari 2')).toBeInTheDocument();
  });
});

// Item 4 dan 6 dan 7: urutan khusus layar, nama tampil, tanpa "Loket", tanpa estimasi.
describe('Layar TV /layar/[token] — kartu', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    order.mockReset();
    panggilanDb = [];
    pasangMock();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('urutan_layar naik; yang null di akhir menurut nama', async () => {
    rpc.mockImplementation(statusRpc([{ layanan_id: 'a' }, { layanan_id: 'b' }, { layanan_id: 'c' }, { layanan_id: 'd' }]));
    order.mockResolvedValue(sukses([
      baris({ layanan_id: 'a', layanan_nama: 'Zeta', urutan_layar: null }),
      baris({ layanan_id: 'b', layanan_nama: 'Beta', urutan_layar: 2 }),
      baris({ layanan_id: 'c', layanan_nama: 'Alfa', urutan_layar: null }),
      baris({ layanan_id: 'd', layanan_nama: 'Delta', urutan_layar: 1 }),
    ]));
    await renderHalaman();
    const nama = [...screen.getByTestId('kisi-layanan').querySelectorAll('h2')].map(h => h.textContent);
    expect(nama).toEqual(['Delta', 'Beta', 'Alfa', 'Zeta']);
  });

  it('nama_layar dipakai di kartu bila diisi; kosong memakai nama layanan; kata "Loket" tidak muncul', async () => {
    rpc.mockImplementation(statusRpc([{ layanan_id: 'a' }, { layanan_id: 'b' }]));
    order.mockResolvedValue(sukses([
      baris({ layanan_id: 'a', layanan_nama: 'Pelayanan Perizinan Berusaha', nama_layar: 'Perizinan', nama_tampil: 'Perizinan' }),
      baris({ layanan_id: 'b', layanan_nama: 'Helpdesk OSS', nama_layar: null, nama_tampil: 'Helpdesk OSS' }),
    ]));
    await renderHalaman();
    expect(screen.getByText('Perizinan')).toBeInTheDocument();
    expect(screen.getByText('Helpdesk OSS')).toBeInTheDocument();
    expect(screen.queryByText('Pelayanan Perizinan Berusaha')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Loket \d/i);
  });

  it('kartu: nama, nomor yang sedang dilayani, jumlah antre; estimasi tunggu tidak ada', async () => {
    rpc.mockImplementation(statusRpc([{ layanan_id: 'a' }]));
    order.mockResolvedValue(sukses([
      baris({ layanan_id: 'a', antre_count: 7, dilayani_count: 1, nomor_display_dilayani: 'OS-014', estimasi_tunggu_total_menit: 99 }),
    ]));
    await renderHalaman();
    const kartu = screen.getByRole('region', { name: 'Helpdesk OSS' });
    expect(kartu).toHaveTextContent('OS-014');
    expect(kartu).toHaveTextContent('7');
    expect(document.body.textContent).not.toMatch(/estimasi|menit/i);
  });

  it('belum ada yang dilayani: tanda strip, bukan angka nol yang menyesatkan', async () => {
    rpc.mockImplementation(statusRpc([{ layanan_id: 'a' }]));
    order.mockResolvedValue(sukses([baris({ layanan_id: 'a', antre_count: 0, dilayani_count: 0, nomor_display_dilayani: null })]));
    await renderHalaman();
    expect(screen.getByRole('region', { name: 'Helpdesk OSS' })).toHaveTextContent('—');
  });

  it('jam dan tanggal header memakai zona WIB (00.30 WIB = 17.30 UTC hari sebelumnya)', async () => {
    vi.setSystemTime(new Date('2026-11-01T17:30:00Z')); // Senin 2 November 2026 00:30 WIB
    siapkanBanyak(1);
    await renderHalaman();
    await maju(1_000);
    const header = document.querySelector('header')!;
    expect(header.textContent).toMatch(/00\.30\.\d\d/);
    expect(header.textContent).toMatch(/Senin, 2 November 2026/);
  });
});

// Item 5 (sisi layar): pita di atas semua halaman, 5 detik per panggilan, antre, bunyi, tombol "Aktifkan suara".
describe('Layar TV /layar/[token] — pita panggilan dan bunyi', () => {
  const kejadian = (id: string, nomor: string, detik: number, layanan = 'a') => ({
    id, layanan_id: layanan, nomor_display: nomor, label: 'Label lama',
    dibuat_at: new Date(Date.UTC(2026, 10, 3, 3, 0, detik)).toISOString(),
  });
  const pita = () => screen.getByTestId('pita-panggilan');

  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    order.mockReset();
    panggilanDb = [];
    pasangMock();
    rpc.mockImplementation(statusRpc([{ layanan_id: 'a' }]));
    order.mockResolvedValue(sukses([baris({ layanan_id: 'a', layanan_nama: 'Pelayanan', nama_layar: 'Helpdesk', nama_tampil: 'Helpdesk' })]));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('panggilan baru: pita "Antrean <nomor>, silakan ke <nama tampil>" 5 detik di atas, lalu hilang; riwayat tidak diumumkan', async () => {
    panggilanDb = [kejadian('lama', 'OS-001', 1)];
    await renderHalaman();
    expect(pita().textContent).toBe('');
    panggilanDb = [...panggilanDb, kejadian('baru', 'OS-014', 20)];
    await maju(5_000);
    expect(pita().textContent).toBe('Antrean OS-014 silakan ke Helpdesk');
    expect(pita().textContent).not.toMatch(/loket/i);
    await maju(4_999);
    expect(pita().textContent).not.toBe('');
    await maju(1);
    expect(pita().textContent).toBe('');
  });

  it('riwayat awal menampilkan empat nomor hari ini dan nama tampil tanpa mengulang pita atau bingkai baru', async () => {
    vi.setSystemTime(new Date('2026-11-03T03:00:00Z'));
    panggilanDb = Array.from({ length: 6 }, (_, i) => ({
      ...kejadian(`p${i}`, `OS-00${i}`, 0),
      dibuat_at: new Date(Date.now() - i * 1000).toISOString(),
    }));
    await renderHalaman();
    const terakhir = screen.getByRole('complementary', { name: 'Panggilan terakhir hari ini' });
    expect([...terakhir.querySelectorAll('strong')].map(el => el.textContent)).toEqual(['OS-000', 'OS-001', 'OS-002', 'OS-003']);
    expect(terakhir.querySelectorAll('li')).toHaveLength(4);
    expect(terakhir.textContent?.match(/Helpdesk/g)).toHaveLength(4);
    expect(pita()).toBeEmptyDOMElement();
    const kartu = screen.getByRole('region', { name: 'Helpdesk' });
    await maju(1000);
    expect(kartu).not.toHaveAttribute('data-dipanggil');
    expect(pita()).toBeEmptyDOMElement();
  });

  it.each([-120_000, 120_000])('bingkai panggilan baru menyala tepat 30 detik sejak diterima saat jam TV berselisih %i ms', async selisih => {
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 3, 3, 0, 0) + selisih));
    await renderHalaman();
    const kartu = screen.getByRole('region', { name: 'Helpdesk' });
    panggilanDb = [kejadian('baru', 'OS-014', 5)];
    await maju(5_000);
    expect(kartu).toHaveAttribute('data-dipanggil', 'true');
    await maju(28_999);
    expect(kartu).toHaveAttribute('data-dipanggil', 'true');
    await maju(1_000);
    expect(kartu).toHaveAttribute('data-dipanggil', 'true');
    await maju(1);
    expect(kartu).not.toHaveAttribute('data-dipanggil');
    expect(pita()).toBeEmptyDOMElement();
  });

  it('panggilan beruntun antre satu per satu; panggil ulang tiket sama (baris baru) muncul lagi', async () => {
    await renderHalaman();
    panggilanDb = [kejadian('1', 'OS-014', 10), kejadian('2', 'OS-015', 11)];
    await maju(5_000);
    expect(pita().textContent).toContain('OS-014');
    await maju(5_000);
    expect(pita().textContent).toContain('OS-015');
    await maju(5_000);
    expect(pita().textContent).toBe('');
    panggilanDb = [...panggilanDb, kejadian('3', 'OS-014', 40)];
    await maju(5_000);
    expect(pita().textContent).toContain('OS-014');
  });

  it('tombol "Aktifkan suara" ada sebelum diklik dan hilang setelahnya; ding berbunyi saat panggilan', async () => {
    const osilatorDibuat: unknown[] = [];
    class AudioContextPalsu {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume = vi.fn();
      createGain = () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn().mockReturnThis() });
      createOscillator = () => {
        const o = { type: '', frequency: { value: 0 }, connect: vi.fn().mockReturnThis(), start: vi.fn(), stop: vi.fn() };
        osilatorDibuat.push(o);
        return o;
      };
    }
    vi.stubGlobal('AudioContext', AudioContextPalsu);
    await renderHalaman();
    const tombol = screen.getByRole('button', { name: 'Aktifkan suara' });
    panggilanDb = [kejadian('1', 'OS-014', 10)];
    await maju(5_000);
    expect(osilatorDibuat).toHaveLength(0); // belum diaktifkan: diam
    await act(async () => { tombol.click(); });
    expect(screen.queryByRole('button', { name: 'Aktifkan suara' })).not.toBeInTheDocument();
    panggilanDb = [...panggilanDb, kejadian('2', 'OS-015', 30)];
    await maju(7_000); // pita 1 selesai pada detik ke-10, pita 2 tampil dan berbunyi
    expect(pita().textContent).toContain('OS-015');
    expect(osilatorDibuat.length).toBeGreaterThanOrEqual(2);
  });

  it('tanpa Web Audio: tidak ada tombol suara', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    await renderHalaman();
    expect(screen.queryByRole('button', { name: 'Aktifkan suara' })).not.toBeInTheDocument();
  });
});

// Item 8 (sisi layar): teks berjalan memuat 1 sampai 3 pengumuman bergantian.
describe('Layar TV /layar/[token] — teks berjalan', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    order.mockReset();
    panggilanDb = [];
    pasangMock();
    siapkanBanyak(1);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('membaca tiga kunci pengumuman; tampil yang pertama, kosong dilewati', async () => {
    (getSiteSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      running_text_layar: 'Pengumuman satu',
      running_text_layar_2: '   ',
      running_text_layar_3: 'Pengumuman tiga',
    });
    await renderHalaman();
    expect(getSiteSettings).toHaveBeenCalledWith(['running_text_layar', 'running_text_layar_2', 'running_text_layar_3']);
    expect(screen.getByText('Pengumuman satu')).toBeInTheDocument();
    expect(screen.queryByText('Pengumuman tiga')).not.toBeInTheDocument();
    (getSiteSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('tanpa pengumuman: bilah teks berjalan tidak ada', async () => {
    (getSiteSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    await renderHalaman();
    expect(screen.queryByTestId('teks-berjalan')).not.toBeInTheDocument();
  });
});

// Kontrak gaya (jsdom tidak menata letak): layar dikunci satu tinggi tanpa scroll, kartu = wadah ukuran.
describe('Layar TV — kontrak CSS satu layar tanpa scroll', () => {
  const isi = readFileSync(join(process.cwd(), 'src/app/layar/[token]/layar-token.module.css'), 'utf8');

  it('.screen setinggi layar, overflow tersembunyi, tanpa min-height 100vh', () => {
    const screenBlok = /\.screen\s*\{[^}]*\}/.exec(isi)?.[0] ?? '';
    expect(screenBlok).toMatch(/height:\s*100dvh/);
    expect(screenBlok).toMatch(/overflow:\s*hidden/);
    expect(screenBlok).not.toMatch(/min-height:\s*100vh/);
    expect(screenBlok).toMatch(/position:\s*relative/); // pita panggilan menempel di atas layar
  });

  it('kisi berpetak setengah kartu (2 x --kolom/--baris) dan kartu container-type: size', () => {
    expect(isi).toMatch(/grid-template-columns:\s*repeat\(calc\(var\(--kolom/);
    expect(isi).toMatch(/grid-template-rows:\s*repeat\(calc\(var\(--baris/);
    expect(isi).toMatch(/container-type:\s*size/);
    expect(isi).toMatch(/cqh/);
  });

  it('layar terang: latar polos tanpa isi', () => {
    expect(isi).toMatch(/\.layarKosong\s*\{[^}]*background:/);
  });
});
