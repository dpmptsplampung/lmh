// @vitest-environment jsdom
// Cangkang /me: menu pengunjung (4 item + Situs utama + Keluar), widget "Kunjungan saya", lencana Notifikasi.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { todayWIB } from '@/lib/time';

const state = vi.hoisted(() => ({
  path: '/me',
  tabel: {} as Record<string, { data: unknown; error?: unknown; count?: number | null }>,
  user: { id: 'auth-1', email: 'sari@x.id', user_metadata: { full_name: 'Sari' } } as Record<string, unknown> | null,
  keluar: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => state.path }));
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <a href={href} {...rest} onClick={(e) => { onClick?.(); e.preventDefault(); }}>{children}</a>
  ),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/sesi-staf', () => ({ keluarDariSesi: (...a: unknown[]) => state.keluar(...a) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (tabel: string) => {
      const hasil = state.tabel[tabel] ?? { data: [], error: null };
      const b: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'maybeSingle']) b[k] = () => b;
      // `gt(created_at, waktu dilihat)` hanya dipanggil bila sudah ada waktu dilihat: tak ada yang lebih baru.
      let sesudahDilihat = false;
      b.gt = () => {
        sesudahDilihat = true;
        return b;
      };
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ error: null, ...(tabel === 'notifikasi' && sesudahDilihat ? { data: null, count: 0 } : hasil) }).then(res, rej);
      return b;
    },
  }),
}));
vi.mock('@/lib/hooks/useAntreanOffline', () => ({
  useAntreanOffline: () => ({ jumlah: 0, terkirim: false }),
  teksAntreanOffline: () => null,
}));

import CangkangPengunjung from './CangkangPengunjung';
import { teksTanggalKunjungan } from './WidgetKunjunganSaya';
import { KUNCI_NOTIFIKASI_DILIHAT } from '@/lib/pengunjung-nav';

function pasang(path = '/me') {
  state.path = path;
  return render(
    <CangkangPengunjung>
      <h1>Isi halaman</h1>
    </CangkangPengunjung>,
  );
}

const baris = (o: Record<string, unknown> = {}) => ({
  id: 'k-1',
  tanggal: todayWIB(),
  jam_rencana: '09:30:00',
  tujuan: 'loket',
  nama_yang_ditemui: null,
  status: 'menunggu',
  layanan: { nama: 'Helpdesk OSS' },
  tiket_antrean: [{ nomor_display: 'OS-014', tanggal: todayWIB(), status: 'menunggu' }],
  ...o,
});

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  state.tabel = {
    pengunjung: { data: { id: 'pg-1', nama: 'Sari Dewi', email: 'sari@x.id' } },
    kunjungan: { data: [baris()] },
    notifikasi: { data: null, count: 0 },
  };
  state.user = { id: 'auth-1', email: 'sari@x.id', user_metadata: { full_name: 'Sari' } };
  state.keluar.mockReset();
  try { window.localStorage.clear(); } catch { /* abaikan */ }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CangkangPengunjung', () => {
  it('memasang tema dasbor dan menampilkan isi halaman', async () => {
    const { container } = pasang();
    expect(container.querySelector('[data-tema="dasbor"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Isi halaman' })).toBeInTheDocument();
    await screen.findByText('Sari Dewi');
  });

  it('menu pengunjung: 4 item + Situs utama + Keluar; entri aktif mengikuti path', async () => {
    pasang('/me/reservasi');
    const nav = screen.getByRole('navigation', { name: 'Menu pengunjung' });
    expect(within(nav).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Beranda saya', '/me'],
      ['Reservasi', '/me/reservasi'],
      ['Notifikasi', '/me/notifications'],
      ['Chat', '/chat'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Reservasi' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Beranda saya' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Situs utama' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: 'Keluar' })).toBeInTheDocument();
    await screen.findByText('Sari Dewi');
  });

  it('Keluar mengakhiri sesi dulu', async () => {
    pasang();
    fireEvent.click(screen.getByRole('button', { name: 'Keluar' }));
    await waitFor(() => expect(state.keluar).toHaveBeenCalledTimes(1));
  });

  it('tombol menu membuka dan menutup laci (HP)', async () => {
    pasang();
    const tombol = screen.getByRole('button', { name: 'Buka menu' });
    expect(tombol).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(tombol);
    expect(tombol).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Navigasi utama' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(tombol).toHaveAttribute('aria-expanded', 'false'));
  });

  it('lencana Notifikasi hanya muncul bila ada yang belum dilihat', async () => {
    state.tabel.notifikasi = { data: null, count: 3 };
    pasang();
    expect(await screen.findByText(': 3 notifikasi belum dilihat')).toBeInTheDocument();
  });

  it('akun B tetap mendapat lencana setelah akun A membaca pada browser yang sama', async () => {
    state.tabel.notifikasi = { data: null, count: 2 };
    const akunA = pasang('/me/notifications');
    await screen.findByText('Sari Dewi');
    await waitFor(() => expect(screen.queryByText(/notifikasi belum dilihat/)).toBeNull());
    akunA.unmount();
    state.user = { id: 'auth-2', email: 'b@x.id', user_metadata: {} };
    state.tabel.pengunjung = { data: { id: 'pg-2', nama: 'Budi', email: 'b@x.id' } };
    state.tabel.notifikasi = { data: null, count: 3 };
    const akunB = pasang();
    expect(await screen.findByText(': 3 notifikasi belum dilihat')).toBeInTheDocument();
    akunB.unmount();
    state.user = { id: 'auth-1', email: 'sari@x.id', user_metadata: {} };
    state.tabel.pengunjung = { data: { id: 'pg-1', nama: 'Sari Dewi', email: 'sari@x.id' } };
    pasang();
    await screen.findByText('Sari Dewi');
    await waitFor(() => expect(screen.queryByText(/notifikasi belum dilihat/)).toBeNull());
  });

  it('memisahkan lencana ketika akun berganti pada cangkang yang masih terpasang', async () => {
    state.tabel.notifikasi = { data: null, count: 2 };
    pasang('/me/notifications');
    await waitFor(() => expect(window.localStorage.getItem(`${KUNCI_NOTIFIKASI_DILIHAT}:auth-1`)).not.toBeNull());
    state.user = { id: 'auth-2', email: 'b@x.id', user_metadata: {} };
    state.tabel.pengunjung = { data: { id: 'pg-2', nama: 'Budi', email: 'b@x.id' } };
    state.tabel.notifikasi = { data: null, count: 3 };
    state.path = '/me';
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByText(': 3 notifikasi belum dilihat')).toBeInTheDocument();
    expect(window.localStorage.getItem(`${KUNCI_NOTIFIKASI_DILIHAT}:auth-2`)).toBeNull();
  });

  it('mengabaikan waktu baca lama yang tidak memiliki identitas akun', async () => {
    window.localStorage.setItem(KUNCI_NOTIFIKASI_DILIHAT, '2099-01-01T00:00:00.000Z');
    state.tabel.notifikasi = { data: null, count: 4 };
    pasang();
    expect(await screen.findByText(': 4 notifikasi belum dilihat')).toBeInTheDocument();
  });

  it('tanpa lencana jika penyimpanan lokal menolak pembacaan', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('ditolak'); });
    state.tabel.notifikasi = { data: null, count: 4 };
    pasang();
    await screen.findByText('Helpdesk OSS');
    expect(screen.queryByText(/notifikasi belum dilihat/)).toBeNull();
  });

  it('tetap membuka Notifikasi jika penyimpanan lokal menolak penulisan', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('ditolak'); });
    pasang('/me/notifications');
    expect(await screen.findByText('Helpdesk OSS')).toBeInTheDocument();
    expect(screen.queryByText(/notifikasi belum dilihat/)).toBeNull();
  });

  it('tanpa lencana bila tidak ada notifikasi baru', async () => {
    pasang();
    await screen.findByText('Sari Dewi');
    expect(screen.queryByText(/notifikasi belum dilihat/)).toBeNull();
  });

  it('membuka halaman Notifikasi menandai semuanya dilihat', async () => {
    state.tabel.notifikasi = { data: null, count: 2 };
    pasang('/me/notifications');
    await waitFor(() => expect(window.localStorage.getItem(`${KUNCI_NOTIFIKASI_DILIHAT}:auth-1`)).not.toBeNull());
    expect(window.localStorage.getItem(KUNCI_NOTIFIKASI_DILIHAT)).toBeNull();
    expect(screen.queryByText(/notifikasi belum dilihat/)).toBeNull();
  });
});

describe('Widget "Kunjungan saya"', () => {
  it('reservasi hari ini: layanan, tanggal, jam, nomor antrean, tautan Lihat reservasi', async () => {
    pasang();
    const widget = (await screen.findByText('Helpdesk OSS')).closest('section') as HTMLElement;
    expect(within(widget).getByText('Hari ini')).toBeInTheDocument();
    expect(within(widget).getByText('09:30 WIB')).toBeInTheDocument();
    expect(within(widget).getByText('OS-014')).toBeInTheDocument();
    expect(within(widget).getByRole('link', { name: /Lihat reservasi/ })).toHaveAttribute('href', '/me/reservasi');
  });

  it('reservasi hari lain: tanpa nomor antrean', async () => {
    state.tabel.kunjungan = { data: [baris({ tanggal: '2099-01-05', status: 'terjadwal', tiket_antrean: [] })] };
    pasang();
    const widget = (await screen.findByText('Helpdesk OSS')).closest('section') as HTMLElement;
    expect(within(widget).queryByText('Nomor antrean')).toBeNull();
    expect(within(widget).queryByText('Hari ini')).toBeNull();
  });

  it('bertemu seseorang menyebut nama yang ditemui', async () => {
    state.tabel.kunjungan = { data: [baris({ tujuan: 'bertemu_seseorang', nama_yang_ditemui: 'Kepala Bidang', layanan: null })] };
    pasang();
    expect(await screen.findByText('Bertemu Kepala Bidang')).toBeInTheDocument();
  });

  it('belum ada reservasi: pesan ramah + ajakan Buat reservasi', async () => {
    state.tabel.kunjungan = { data: [] };
    pasang();
    expect(await screen.findByText('Belum ada reservasi')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Buat reservasi/ })).toHaveAttribute('href', '/me/reservasi');
  });

  it('memperbarui reservasi saat kembali lewat navigasi tanpa memasang ulang cangkang', async () => {
    state.tabel.kunjungan = { data: [] };
    const { rerender } = pasang('/me/reservasi');
    expect(await screen.findByText('Belum ada reservasi')).toBeInTheDocument();
    state.tabel.kunjungan = { data: [baris()] };
    state.path = '/me';
    rerender(<CangkangPengunjung><h1>Isi halaman</h1></CangkangPengunjung>);
    expect(await screen.findByText('Helpdesk OSS')).toBeInTheDocument();
  });

  it('memperbarui widget saat tab terlihat kembali dan melepas pendengar saat dibongkar', async () => {
    state.tabel.kunjungan = { data: [] };
    const { unmount } = pasang();
    expect(await screen.findByText('Belum ada reservasi')).toBeInTheDocument();
    state.tabel.kunjungan = { data: [baris()] };
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByText('Belum ada reservasi')).toBeInTheDocument();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByText('Helpdesk OSS')).toBeInTheDocument();
    const lepas = vi.spyOn(document, 'removeEventListener');
    unmount();
    expect(lepas).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    vi.restoreAllMocks();
  });

  it('kueri gagal: catatan netral, bukan galat merah (tanpa role alert)', async () => {
    state.tabel.kunjungan = { data: null, error: { message: 'gagal' } };
    pasang();
    expect(await screen.findByText('Data kunjungan belum tersedia')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tanpa profil pengunjung: kosong, tanpa kueri kunjungan', async () => {
    state.tabel.pengunjung = { data: null };
    pasang();
    expect(await screen.findByText('Belum ada reservasi')).toBeInTheDocument();
  });

  it('teksTanggalKunjungan: hari ini atau tanggal pendek WIB', () => {
    expect(teksTanggalKunjungan('2026-11-04', '2026-11-04')).toBe('Hari ini');
    expect(teksTanggalKunjungan('2026-11-06', '2026-11-04')).toMatch(/6 November/);
  });
});
