// @vitest-environment jsdom
// Siklus hidup kamera pemindai QR. Memakai html5-qrcode ASLI dengan getUserMedia palsu: yang diperiksa adalah track
// MediaStream benar-benar `stop()` (lampu kamera mati), bukan sekadar pemindai palsu yang dipanggil.
import { StrictMode, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useKameraPemindai } from './useKameraPemindai';

interface TrackPalsu {
  stopped: boolean;
  stop: () => void;
  applyConstraints: () => Promise<void>;
  getSettings: () => Record<string, never>;
}
interface StreamPalsu {
  track: TrackPalsu;
  getTracks: () => TrackPalsu[];
  getVideoTracks: () => TrackPalsu[];
  removeTrack: (t: TrackPalsu) => void;
}

const s = vi.hoisted(() => ({ streams: [] as StreamPalsu[], gum: null as unknown as Mock<(...a: unknown[]) => Promise<unknown>>, tolakApply: false }));

function buatStream(): StreamPalsu {
  const track: TrackPalsu = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
    applyConstraints: () => (s.tolakApply ? Promise.reject(new Error('OverconstrainedError')) : Promise.resolve()),
    getSettings: () => ({}),
  };
  const tracks = [track];
  const stream: StreamPalsu = {
    track,
    getTracks: () => [...tracks],
    getVideoTracks: () => [...tracks],
    removeTrack: (t) => {
      const i = tracks.indexOf(t);
      if (i >= 0) tracks.splice(i, 1);
    },
  };
  s.streams.push(stream);
  return stream;
}
const hidup = () => s.streams.filter((x) => !x.track.stopped).length;

function setVisibilitas(nilai: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: nilai, configurable: true });
}
const kirimVisibilitas = (nilai: 'visible' | 'hidden') => {
  setVisibilitas(nilai);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

function Uji({ aktif = true, onDekode = () => {} }: { aktif?: boolean; onDekode?: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { status, nyalakan } = useKameraPemindai({ aktif, wadahRef: ref, onDekode });
  return (
    <div>
      <div ref={ref} data-testid="wadah" />
      <output data-testid="status">{status}</output>
      <button type="button" onClick={nyalakan}>
        nyalakan
      </button>
    </div>
  );
}
const status = () => screen.getByTestId('status').textContent;

beforeEach(() => {
  s.streams.length = 0;
  s.tolakApply = false;
  s.gum = vi.fn(() => Promise.resolve(buatStream()));
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: (...a: unknown[]) => s.gum(...a), enumerateDevices: async () => [] },
    configurable: true,
  });
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as unknown as HTMLMediaElement['play'];
  setVisibilitas('visible');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  cleanup();
  // beri waktu pembersihan async sesi terakhir (sesi berurutan; tak boleh bocor ke test berikutnya)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  setVisibilitas('visible');
  vi.restoreAllMocks();
});

describe('useKameraPemindai: siklus hidup kamera', () => {
  it('menyala saat aktif (status aktif, satu stream) dan semua track dihentikan saat unmount', async () => {
    const { unmount } = render(<Uji />);
    await waitFor(() => expect(status()).toBe('aktif'));
    expect(s.gum).toHaveBeenCalledTimes(1);
    expect(hidup()).toBe(1);

    unmount();
    expect(hidup()).toBe(0); // sinkron: tidak menunggu pustaka
  });

  it('berpindah tab/state (aktif -> false) mematikan kamera; aktif lagi menyalakannya dengan stream baru', async () => {
    const { rerender } = render(<Uji aktif />);
    await waitFor(() => expect(status()).toBe('aktif'));

    rerender(<Uji aktif={false} />);
    expect(hidup()).toBe(0);
    expect(status()).toBe('mati');

    rerender(<Uji aktif />);
    await waitFor(() => expect(status()).toBe('aktif'));
    expect(s.gum).toHaveBeenCalledTimes(2);
    expect(hidup()).toBe(1);
  });

  it('RACE: unmount sebelum start() selesai -> stream yang tiba belakangan langsung dihentikan', async () => {
    let lepas: (st: StreamPalsu) => void = () => {};
    s.gum = vi.fn(() => new Promise<StreamPalsu>((r) => { lepas = r; }));
    const { unmount } = render(<Uji />);
    await waitFor(() => expect(s.gum).toHaveBeenCalledTimes(1));

    unmount(); // izin kamera masih menunggu
    await act(async () => {
      lepas(buatStream());
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(s.streams).toHaveLength(1);
    expect(hidup()).toBe(0);
  });

  it('start() gagal SETELAH stream diperoleh (stream yatim di pustaka): track tetap dimatikan, status galat', async () => {
    s.tolakApply = true;
    render(<Uji />);
    await waitFor(() => expect(status()).toBe('galat'));
    expect(s.streams).toHaveLength(1);
    expect(hidup()).toBe(0);
  });

  it('visibilitychange -> hidden mematikan kamera; kembali terlihat TIDAK menyalakan lagi; tombol menyalakan', async () => {
    render(<Uji />);
    await waitFor(() => expect(status()).toBe('aktif'));

    kirimVisibilitas('hidden');
    expect(hidup()).toBe(0);
    await waitFor(() => expect(status()).toBe('dijeda'));

    kirimVisibilitas('visible');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(status()).toBe('dijeda');
    expect(s.gum).toHaveBeenCalledTimes(1);
    expect(hidup()).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'nyalakan' }));
    await waitFor(() => expect(status()).toBe('aktif'));
    expect(s.gum).toHaveBeenCalledTimes(2);
    expect(hidup()).toBe(1);
  });

  it('pagehide dan beforeunload mematikan kamera', async () => {
    render(<Uji />);
    await waitFor(() => expect(status()).toBe('aktif'));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(hidup()).toBe(0);
    await waitFor(() => expect(status()).toBe('dijeda'));

    fireEvent.click(screen.getByRole('button', { name: 'nyalakan' }));
    await waitFor(() => expect(status()).toBe('aktif'));
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    expect(hidup()).toBe(0);
  });

  it('dibuka saat dokumen tersembunyi: kamera tidak menyala (tanpa getUserMedia), menunggu tombol', async () => {
    setVisibilitas('hidden');
    render(<Uji />);
    await waitFor(() => expect(status()).toBe('dijeda'));
    expect(s.gum).not.toHaveBeenCalled();
  });

  it('StrictMode (efek dijalankan dua kali): hanya satu getUserMedia, tidak ada instance ganda, mati saat unmount', async () => {
    const { unmount } = render(
      <StrictMode>
        <Uji />
      </StrictMode>,
    );
    await waitFor(() => expect(status()).toBe('aktif'));
    expect(s.gum).toHaveBeenCalledTimes(1);
    expect(hidup()).toBe(1);
    expect(screen.getByTestId('wadah').querySelectorAll('video')).toHaveLength(1);

    unmount();
    expect(hidup()).toBe(0);
  });

  it('nyala-mati cepat selagi izin menunggu: sesi berurutan, tak pernah dua start() bersamaan, akhirnya satu kamera', async () => {
    const menunggu: Array<(st: StreamPalsu) => void> = [];
    s.gum = vi.fn(() => new Promise<StreamPalsu>((r) => { menunggu.push(r); }));
    const { rerender, unmount } = render(<Uji aktif />);
    await waitFor(() => expect(s.gum).toHaveBeenCalledTimes(1));

    rerender(<Uji aktif={false} />);
    rerender(<Uji aktif />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(s.gum).toHaveBeenCalledTimes(1); // sesi kedua menunggu sesi pertama tuntas

    s.gum = vi.fn(() => Promise.resolve(buatStream()));
    await act(async () => {
      menunggu[0](buatStream()); // stream sesi pertama (sudah dibatalkan) -> langsung mati
      await new Promise((r) => setTimeout(r, 80));
    });
    await waitFor(() => expect(status()).toBe('aktif'));
    expect(s.gum).toHaveBeenCalledTimes(1); // gum baru: tepat satu panggilan untuk sesi kedua
    expect(hidup()).toBe(1);

    unmount();
    expect(hidup()).toBe(0);
  });
});
