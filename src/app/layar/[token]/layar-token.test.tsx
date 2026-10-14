// @vitest-environment jsdom
// Audit T4: layar TV tidak boleh berubah menjadi "Token tidak valid" permanen karena gangguan
// jaringan sesaat; data terakhir dipertahankan; pulih otomatis dengan backoff.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/site-settings', () => ({ getSiteSettings: vi.fn().mockResolvedValue({}) }));

import LayarTokenPage from './page';
import { createClient } from '@/lib/supabase/client';
import { backoffMs } from '@/lib/layar/koneksi';

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

function pasangMock() {
  const channelApi = {
    on: vi.fn((_tipe: string, _filter: unknown, cb: () => void) => { siaran = cb; return channelApi; }),
    subscribe: vi.fn(() => channelApi),
  };
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc,
    from: vi.fn(() => ({ select: vi.fn(() => ({ order })) })),
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

async function maju(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe('Layar TV /layar/[token] — ketahanan jaringan (T4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    order.mockReset();
    siaran = null;
    pasangMock();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Token tidak valid/)).not.toBeInTheDocument();
    await maju(1999); // backoff ke-2 = 2 dtk: belum
    expect(rpc).toHaveBeenCalledTimes(2);
    await maju(1); // sekarang
    expect(rpc).toHaveBeenCalledTimes(3);

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

  it('format nomor 2 huruf (OS-014) tampil utuh dan diumumkan lewat region aria-live polite', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    order
      .mockResolvedValueOnce(sukses([baris({ nomor_display_dilayani: null })]))
      .mockResolvedValue(sukses([baris({ nomor_display_dilayani: 'OS-014' })]));

    await renderHalaman();
    const live = document.querySelector('[aria-live="polite"][aria-atomic="true"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe(''); // muat pertama tidak diumumkan

    await maju(15_000);
    expect(screen.getByText('OS-014')).toBeInTheDocument();
    expect(live?.textContent).toBe('Nomor OS-014 dipanggil di Helpdesk OSS');
  });
});
