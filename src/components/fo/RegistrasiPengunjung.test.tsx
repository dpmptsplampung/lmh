// @vitest-environment jsdom
// Halaman Registrasi Pengunjung: tab Walk-in / Scan QR (pola WAI-ARIA), sinkron ke ?tab=, dan kamera Scan QR yang
// benar-benar mati saat berpindah tab. ScanPanel + html5-qrcode ASLI dengan getUserMedia palsu; WalkinPanel dipalsukan.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { buatH, type FakeH } from '@/test/fo-supabase-mock';

const m = vi.hoisted(() => ({
  query: '' as string,
  h: null as unknown as FakeH,
  gum: null as unknown as Mock<(...a: unknown[]) => Promise<unknown>>,
  tracks: [] as { stopped: boolean }[],
  walkinMount: 0,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(m.query),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/supabase/client', async () => {
  const { buatFakeSupabase } = await import('@/test/fo-supabase-mock');
  return { createClient: () => buatFakeSupabase(m.h) };
});
vi.mock('./WalkinPanel', async () => {
  const React = await import('react');
  return {
    default: function WalkinPalsu({ fokusAwal }: { fokusAwal?: boolean }) {
      React.useEffect(() => {
        m.walkinMount += 1;
      }, []);
      return (
        <label>
          Nama pengunjung
          <input data-fokus-awal={String(fokusAwal)} />
        </label>
      );
    },
  };
});

import RegistrasiPengunjung from './RegistrasiPengunjung';

function setVisibilitas(nilai: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: nilai, configurable: true });
}

const tabWalkin = () => screen.getByRole('tab', { name: /Walk-in/ });
const tabScan = () => screen.getByRole('tab', { name: /Scan QR/ });
const hidup = () => m.tracks.filter((t) => !t.stopped).length;

beforeEach(() => {
  m.query = '';
  m.h = buatH();
  m.h.tabel.kunjungan = { data: [], error: null, count: 0 };
  m.tracks.length = 0;
  m.walkinMount = 0;
  m.gum = vi.fn(() => {
    const track = {
      stopped: false,
      stop() {
        this.stopped = true;
      },
      applyConstraints: () => Promise.resolve(),
      getSettings: () => ({}),
    };
    m.tracks.push(track);
    const tracks = [track];
    return Promise.resolve({
      getTracks: () => [...tracks],
      getVideoTracks: () => [...tracks],
      removeTrack: (t: unknown) => {
        const i = tracks.indexOf(t as typeof track);
        if (i >= 0) tracks.splice(i, 1);
      },
    });
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: (...a: unknown[]) => m.gum(...a), enumerateDevices: async () => [] },
    configurable: true,
  });
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as unknown as HTMLMediaElement['play'];
  setVisibilitas('visible');
  window.history.replaceState(null, '', '/admin/fo/registrasi');
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  vi.restoreAllMocks();
});

describe('Registrasi Pengunjung: struktur tab (WAI-ARIA)', () => {
  it('tablist berlabel dengan dua tab; default Walk-in terpilih, tabpanel terhubung (aria-controls/labelledby)', () => {
    render(<RegistrasiPengunjung />);
    expect(screen.getByRole('tablist', { name: /registrasi pengunjung/i })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);

    expect(tabWalkin()).toHaveAttribute('aria-selected', 'true');
    expect(tabScan()).toHaveAttribute('aria-selected', 'false');
    expect(tabWalkin()).toHaveAttribute('tabindex', '0');
    expect(tabScan()).toHaveAttribute('tabindex', '-1');

    const panel = screen.getByRole('tabpanel', { name: /Walk-in/ });
    expect(panel).toHaveAttribute('id', tabWalkin().getAttribute('aria-controls'));
    expect(panel).toHaveAttribute('aria-labelledby', tabWalkin().id);
    expect(screen.getByLabelText('Nama pengunjung')).toBeInTheDocument();
  });

  it('?tab=scan membuka tab Scan QR; nilai tak dikenal jatuh ke Walk-in', async () => {
    m.query = 'tab=scan';
    const { unmount } = render(<RegistrasiPengunjung />);
    expect(tabScan()).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByLabelText(/masukkan token secara manual/i)).toBeInTheDocument();
    unmount();

    m.query = 'tab=ngawur';
    render(<RegistrasiPengunjung />);
    expect(tabWalkin()).toHaveAttribute('aria-selected', 'true');
  });

  it('klik tab mengubah panel dan menyinkronkan URL (?tab=...) lewat replaceState tanpa menambah riwayat', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    const panjangRiwayat = window.history.length;
    render(<RegistrasiPengunjung />);

    fireEvent.click(tabScan());
    expect(tabScan()).toHaveAttribute('aria-selected', 'true');
    expect(replace).toHaveBeenLastCalledWith(null, '', '/admin/fo/registrasi?tab=scan');
    expect(window.location.search).toBe('?tab=scan');
    expect(await screen.findByLabelText(/masukkan token secara manual/i)).toBeInTheDocument();

    fireEvent.click(tabWalkin());
    expect(window.location.search).toBe('?tab=walkin');
    expect(window.history.length).toBe(panjangRiwayat);
  });

  it('navigasi papan ketik: ArrowRight/ArrowLeft (melingkar), Home, End; fokus mengikuti tab terpilih', () => {
    render(<RegistrasiPengunjung />);
    tabWalkin().focus();

    fireEvent.keyDown(tabWalkin(), { key: 'ArrowRight' });
    expect(tabScan()).toHaveAttribute('aria-selected', 'true');
    expect(tabScan()).toHaveFocus();

    fireEvent.keyDown(tabScan(), { key: 'ArrowRight' });
    expect(tabWalkin()).toHaveAttribute('aria-selected', 'true');
    expect(tabWalkin()).toHaveFocus();

    fireEvent.keyDown(tabWalkin(), { key: 'ArrowLeft' });
    expect(tabScan()).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(tabScan(), { key: 'Home' });
    expect(tabWalkin()).toHaveFocus();
    fireEvent.keyDown(tabWalkin(), { key: 'End' });
    expect(tabScan()).toHaveFocus();
  });

  it('formulir walk-in tidak kehilangan isian saat sebentar ke Scan QR; fokus tidak direbut saat berpindah tab', async () => {
    render(<RegistrasiPengunjung />);
    expect(screen.getByLabelText('Nama pengunjung')).toHaveAttribute('data-fokus-awal', 'true');
    fireEvent.change(screen.getByLabelText('Nama pengunjung'), { target: { value: 'Budi' } });

    fireEvent.click(tabScan());
    await screen.findByLabelText(/masukkan token secara manual/i);
    expect(document.getElementById('panel-registrasi-walkin')).toHaveAttribute('hidden');

    fireEvent.click(tabWalkin());
    expect(screen.getByLabelText('Nama pengunjung')).toHaveValue('Budi');
    expect(m.walkinMount).toBe(1); // tidak dipasang ulang
  });

  it('tab Scan QR memuat penanda jumlah reservasi hari ini yang menunggu check-in (satu kueri hitung ringan)', async () => {
    m.h.tabel.kunjungan = { data: [], error: null, count: 3 };
    render(<RegistrasiPengunjung />);
    expect(await within3()).toBeInTheDocument();
    const kueri = m.h.log.find((l) => l.tabel === 'kunjungan')!;
    expect(JSON.stringify(kueri.ops)).toContain('"head":true');
    expect(JSON.stringify(kueri.ops)).toContain('terjadwal');
  });

  it('tanpa reservasi atau kueri gagal: tanpa penanda', async () => {
    m.h.tabel.kunjungan = { data: null, error: { message: 'gagal' } };
    render(<RegistrasiPengunjung />);
    await waitFor(() => expect(m.h.log.some((l) => l.tabel === 'kunjungan')).toBe(true));
    expect(screen.queryByText(/reservasi menunggu check-in/)).toBeNull();
  });
});

const within3 = () => screen.findByText(/3 reservasi menunggu check-in hari ini/);

describe('Registrasi Pengunjung: kamera hanya menyala saat tab Scan QR tampil', () => {
  it('membuka tab Scan QR menyalakan kamera ("Kamera aktif"); pindah ke Walk-in mematikannya ("Kamera mati" tak tampil lagi)', async () => {
    render(<RegistrasiPengunjung />);
    expect(m.gum).not.toHaveBeenCalled(); // tab Walk-in: kamera tidak pernah diminta

    fireEvent.click(tabScan());
    expect(await screen.findByText('Kamera aktif')).toBeInTheDocument();
    expect(m.gum).toHaveBeenCalledTimes(1);
    expect(hidup()).toBe(1);

    fireEvent.click(tabWalkin());
    expect(hidup()).toBe(0); // panel Scan di-unmount -> semua track berhenti
    expect(screen.queryByText('Kamera aktif')).toBeNull();
    expect(screen.queryByLabelText(/masukkan token secara manual/i)).toBeNull();
  });

  it('kembali ke Scan QR menyalakan lagi dengan stream baru, tanpa instance ganda', async () => {
    m.query = 'tab=scan';
    render(<RegistrasiPengunjung />);
    await screen.findByText('Kamera aktif');
    fireEvent.click(tabWalkin());
    expect(hidup()).toBe(0);

    fireEvent.click(tabScan());
    await screen.findByText('Kamera aktif');
    expect(m.gum).toHaveBeenCalledTimes(2);
    expect(hidup()).toBe(1);
    expect(document.querySelectorAll('video')).toHaveLength(1);
  });

  it('unmount halaman (pindah menu) mematikan kamera', async () => {
    m.query = 'tab=scan';
    const { unmount } = render(<RegistrasiPengunjung />);
    await screen.findByText('Kamera aktif');
    unmount();
    expect(hidup()).toBe(0);
  });

  it('halaman tersembunyi mematikan kamera, menampilkan tombol "Nyalakan Kamera", dan tidak menyala lagi sendiri', async () => {
    m.query = 'tab=scan';
    render(<RegistrasiPengunjung />);
    await screen.findByText('Kamera aktif');

    setVisibilitas('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(hidup()).toBe(0);
    expect(await screen.findByText('Kamera mati')).toBeInTheDocument();
    const nyalakan = screen.getByRole('button', { name: /Nyalakan Kamera/ });

    setVisibilitas('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(m.gum).toHaveBeenCalledTimes(1);
    expect(hidup()).toBe(0);

    fireEvent.click(nyalakan);
    expect(await screen.findByText('Kamera aktif')).toBeInTheDocument();
    expect(hidup()).toBe(1);
  });

  it('indikator status kamera berupa region aria-live polite', async () => {
    m.query = 'tab=scan';
    render(<RegistrasiPengunjung />);
    const indikator = await screen.findByText('Kamera aktif');
    expect(indikator.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
  });
});
