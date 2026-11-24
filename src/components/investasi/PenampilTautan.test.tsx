// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PenampilDokumen from './PenampilDokumen';

const DOK = '50000000-0000-4000-8000-000000000001';
const kotak = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };

type Balasan = { status?: number; json?: unknown; gagal?: boolean };

/** fetch palsu: /links dijawab `links`; page-image mengembalikan blob kecil dan dicatat. */
function pasangFetch(links: Balasan) {
  const gambar: string[] = [];
  const fn = vi.fn(async (url: string) => {
    if (url.includes('/links')) {
      if (links.gagal) throw new TypeError('jaringan putus');
      return new Response(JSON.stringify(links.json ?? {}), { status: links.status ?? 200 });
    }
    gambar.push(url);
    // Blob jsdom tidak cocok dengan Response Node, jadi balasannya dibuat manual.
    return { ok: true, blob: async () => new Blob(['x'], { type: 'image/webp' }) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, gambar };
}

beforeEach(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:pramuat-${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const buka = (jumlah = 10, kategori = 'Peta Potensi') =>
  render(<PenampilDokumen dokumenId={DOK} judul="Peta" kategori={kategori} jumlahHalaman={jumlah} onTutup={() => {}} />);

describe('lapisan tautan', () => {
  it('tautan internal = tombol yang melompat; tautan luar = <a> dengan rel aman; skema berbahaya tidak dirender', async () => {
    pasangFetch({
      json: {
        versi: 1,
        tautan: [
          { hal: 1, ...kotak, ke: 7 },
          { hal: 1, x: 0.5, y: 0.5, w: 0.2, h: 0.1, url: 'https://contoh.go.id/info' },
          { hal: 1, x: 0.6, y: 0.6, w: 0.1, h: 0.1, url: 'javascript:alert(1)' },
          { hal: 2, ...kotak, ke: 1 },
        ],
      },
    });
    buka();
    const dialog = screen.getByRole('dialog');
    fireEvent.load(within(dialog).getByAltText('Peta, slide 1 dari 10'));
    const internal = await within(dialog).findByRole('button', { name: 'Ke slide 7' });
    expect(internal).toHaveStyle({ left: '10.000%', top: '20.000%', width: '30.000%', height: '10.000%' });
    const luar = within(dialog).getByRole('link', { name: 'Buka tautan luar: contoh.go.id' });
    expect(luar).toHaveAttribute('href', 'https://contoh.go.id/info');
    expect(luar).toHaveAttribute('target', '_blank');
    expect(luar).toHaveAttribute('rel', 'noopener noreferrer');
    expect(dialog.querySelectorAll('a[href^="javascript"]')).toHaveLength(0);
    expect(within(dialog).getAllByRole('link', { name: /Buka tautan luar/ })).toHaveLength(1);
    // tautan halaman 2 tidak muncul di halaman 1
    expect(within(dialog).queryByRole('button', { name: 'Ke slide 1' })).toBeNull();

    fireEvent.click(internal);
    expect(within(dialog).getByAltText('Peta, slide 7 dari 10')).toBeInTheDocument();
    expect(within(dialog).getByRole('spinbutton', { name: 'Ke slide' })).toHaveValue(7);
  });

  it('tautan ke slide di luar jangkauan diabaikan', async () => {
    const { fn } = pasangFetch({ json: { versi: 1, tautan: [{ hal: 1, ...kotak, ke: 50 }, { hal: 1, ...kotak, ke: 2 }] } });
    buka();
    const dialog = screen.getByRole('dialog');
    fireEvent.load(within(dialog).getByAltText('Peta, slide 1 dari 10'));
    await within(dialog).findByRole('button', { name: 'Ke slide 2' });
    expect(within(dialog).queryByRole('button', { name: 'Ke slide 50' })).toBeNull();
    expect(fn.mock.calls.filter(([u]) => String(u).includes('/links'))).toHaveLength(1);
  });

  it.each([
    ['jaringan putus', { gagal: true }],
    ['404', { status: 404 }],
    ['500', { status: 500 }],
    ['bentuk salah', { json: { versi: 9 } }],
  ] as [string, Balasan][])('gagal ambil tautan (%s) tidak merusak pembacaan', async (_n, balasan) => {
    const { fn } = pasangFetch(balasan);
    buka();
    const dialog = screen.getByRole('dialog');
    fireEvent.load(within(dialog).getByAltText('Peta, slide 1 dari 10'));
    await waitFor(() => expect(fn).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(within(dialog).queryByRole('button', { name: /^Ke slide \d+$/ })).toBeNull();
    expect(within(dialog).queryByRole('link', { name: /Buka tautan luar/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: /Berikutnya/ }));
    expect(within(dialog).getByAltText('Peta, slide 2 dari 10')).toBeInTheDocument();
  });

  it('dokumen belum siap tidak mengambil tautan', () => {
    const { fn } = pasangFetch({});
    buka(0);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('kecepatan terasa', () => {
  it('memramuat hanya tetangga (berikutnya lalu sebelumnya) setelah slide aktif siap, tidak sebelum', async () => {
    const { gambar } = pasangFetch({});
    buka(10);
    const dialog = screen.getByRole('dialog');
    await act(async () => { await Promise.resolve(); });
    expect(gambar).toEqual([]);
    fireEvent.load(within(dialog).getByAltText('Peta, slide 1 dari 10'));
    await waitFor(() => expect(gambar).toHaveLength(1));
    expect(gambar[0]).toContain('page=2');

    fireEvent.click(within(dialog).getByRole('button', { name: /Berikutnya/ }));
    fireEvent.load(within(dialog).getByAltText('Peta, slide 2 dari 10'));
    // dari slide 2: berikutnya (3) lalu sebelumnya (1); slide 2 sudah ada, tidak diambil ulang
    await waitFor(() => expect(gambar).toHaveLength(3));
    expect(gambar.map(u => Number(/page=(\d+)/.exec(u)?.[1]))).toEqual([2, 3, 1]);
    // tidak pernah memramuat lebih dari tetangga
    expect(gambar.some(u => /page=(?:[4-9]|10)\b/.test(u))).toBe(false);
  });

  it('halaman yang sudah dipramuat dipakai sebagai blob saat pindah; sisa blob dilepas saat penampil ditutup', async () => {
    const { gambar } = pasangFetch({});
    const { unmount } = buka(10);
    const dialog = screen.getByRole('dialog');
    fireEvent.load(within(dialog).getByAltText('Peta, slide 1 dari 10'));
    await waitFor(() => expect(gambar).toHaveLength(1));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    fireEvent.click(within(dialog).getByRole('button', { name: /Berikutnya/ }));
    expect(within(dialog).getByAltText('Peta, slide 2 dari 10')).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('gambar lama bertahan (beserta tautannya) sampai gambar baru siap', async () => {
    pasangFetch({ json: { versi: 1, tautan: [{ hal: 1, ...kotak, ke: 5 }] } });
    buka(10);
    const dialog = screen.getByRole('dialog');
    fireEvent.load(within(dialog).getByAltText('Peta, slide 1 dari 10'));
    await within(dialog).findByRole('button', { name: 'Ke slide 5' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Berikutnya/ }));
    // slide 2 belum siap: gambar lama (alt kosong) masih ada dan tautannya tetap bisa diklik
    expect(dialog.querySelectorAll('img[alt=""]')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Ke slide 5' })).toBeInTheDocument();
    expect(within(dialog).getByText('Memuat slide 2…')).toBeInTheDocument();
    fireEvent.load(within(dialog).getByAltText('Peta, slide 2 dari 10'));
    expect(dialog.querySelectorAll('img[alt=""]')).toHaveLength(0);
    expect(within(dialog).queryByRole('button', { name: 'Ke slide 5' })).toBeNull();
  });
});
