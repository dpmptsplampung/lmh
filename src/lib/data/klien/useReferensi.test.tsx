// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Hasil } from '../referensi';
import { TTL_REFERENSI_BAWAAN, buangCacheReferensi, useReferensi } from './useReferensi';

const sukses = <T,>(data: T): Hasil<T> => ({ data, error: null });
const gagal = <T,>(pesan: string): Hasil<T> => ({ data: null, error: pesan });

/** Janji yang diselesaikan dari luar, agar urutan "sedang memuat" dapat diamati. */
function tunda<T>() {
  let selesai!: (v: Hasil<T>) => void;
  const janji = new Promise<Hasil<T>>((r) => {
    selesai = r;
  });
  return { janji, selesai };
}

let sekarang = 1_000_000;
beforeEach(() => {
  sekarang = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => sekarang);
  buangCacheReferensi();
});
afterEach(() => {
  cleanup();
  buangCacheReferensi();
  vi.restoreAllMocks();
});

describe('useReferensi: penggabungan permintaan', () => {
  it('dua komponen dengan kunci sama yang mount bersamaan = satu panggilan pemuat', async () => {
    const { janji, selesai } = tunda<string[]>();
    const pemuat = vi.fn(() => janji);
    const a = renderHook(() => useReferensi('daftar', pemuat));
    const b = renderHook(() => useReferensi('daftar', pemuat));
    expect(a.result.current.memuat).toBe(true);
    expect(b.result.current.memuat).toBe(true);
    expect(pemuat).toHaveBeenCalledTimes(1);

    await act(async () => selesai(sukses(['x', 'y'])));
    expect(a.result.current).toMatchObject({ data: ['x', 'y'], memuat: false, galat: null });
    expect(b.result.current).toMatchObject({ data: ['x', 'y'], memuat: false, galat: null });
    expect(pemuat).toHaveBeenCalledTimes(1);
  });

  it('kunci berbeda memuat sendiri-sendiri', async () => {
    const pemuatA = vi.fn(() => Promise.resolve(sukses('A')));
    const pemuatB = vi.fn(() => Promise.resolve(sukses('B')));
    const a = renderHook(() => useReferensi('a', pemuatA));
    const b = renderHook(() => useReferensi('b', pemuatB));
    await waitFor(() => expect(a.result.current.data).toBe('A'));
    await waitFor(() => expect(b.result.current.data).toBe('B'));
    expect(pemuatA).toHaveBeenCalledTimes(1);
    expect(pemuatB).toHaveBeenCalledTimes(1);
  });

  it('kunci berubah pada komponen yang sama memuat kunci baru', async () => {
    const pemuat = vi.fn((nilai: string) => Promise.resolve(sukses(nilai)));
    const { result, rerender } = renderHook(({ kunci }) => useReferensi(kunci, () => pemuat(kunci!)), {
      initialProps: { kunci: 'satu' as string | null },
    });
    await waitFor(() => expect(result.current.data).toBe('satu'));
    rerender({ kunci: 'dua' });
    expect(result.current.data).toBeNull();
    expect(result.current.memuat).toBe(true);
    await waitFor(() => expect(result.current.data).toBe('dua'));
    expect(pemuat).toHaveBeenCalledTimes(2);
  });
});

describe('useReferensi: cache dan TTL', () => {
  it('mount berikutnya dalam TTL langsung memakai cache tanpa memanggil pemuat lagi', async () => {
    const pemuat = vi.fn(() => Promise.resolve(sukses(['x'])));
    const pertama = renderHook(() => useReferensi('daftar', pemuat));
    await waitFor(() => expect(pertama.result.current.data).toEqual(['x']));
    pertama.unmount();

    sekarang += TTL_REFERENSI_BAWAAN - 1;
    const kedua = renderHook(() => useReferensi('daftar', pemuat));
    expect(kedua.result.current).toMatchObject({ data: ['x'], memuat: false, galat: null });
    expect(pemuat).toHaveBeenCalledTimes(1);
  });

  it('TTL bawaan 5 menit', () => {
    expect(TTL_REFERENSI_BAWAAN).toBe(300_000);
  });

  it('setelah TTL lewat, mount berikutnya memuat ulang dan data lama tetap tampil sampai data baru tiba', async () => {
    const pemuat = vi
      .fn<() => Promise<Hasil<string>>>()
      .mockResolvedValueOnce(sukses('lama'))
      .mockResolvedValueOnce(sukses('baru'));
    const pertama = renderHook(() => useReferensi('daftar', pemuat));
    await waitFor(() => expect(pertama.result.current.data).toBe('lama'));
    pertama.unmount();

    sekarang += TTL_REFERENSI_BAWAAN;
    const kedua = renderHook(() => useReferensi('daftar', pemuat));
    expect(kedua.result.current.data).toBe('lama');
    expect(kedua.result.current.memuat).toBe(false); // pembaruan diam-diam: tidak ada kedipan "memuat"
    await waitFor(() => expect(kedua.result.current.data).toBe('baru'));
    expect(pemuat).toHaveBeenCalledTimes(2);
  });

  it('ttlMs per pemanggilan menggantikan bawaan', async () => {
    const pemuat = vi.fn(() => Promise.resolve(sukses('x')));
    const pertama = renderHook(() => useReferensi('daftar', pemuat, { ttlMs: 1000 }));
    await waitFor(() => expect(pertama.result.current.data).toBe('x'));
    pertama.unmount();

    sekarang += 999;
    const dalam = renderHook(() => useReferensi('daftar', pemuat, { ttlMs: 1000 }));
    await waitFor(() => expect(dalam.result.current.memuat).toBe(false));
    expect(pemuat).toHaveBeenCalledTimes(1);
    dalam.unmount();

    sekarang += 1000;
    const luar = renderHook(() => useReferensi('daftar', pemuat, { ttlMs: 1000 }));
    await waitFor(() => expect(pemuat).toHaveBeenCalledTimes(2));
    luar.unmount();
  });
});

describe('useReferensi: ttlMs 0 = tanpa cache (hanya penggabungan permintaan bersamaan)', () => {
  it('dua komponen yang mount bersamaan tetap satu panggilan', async () => {
    const { janji, selesai } = tunda<string>();
    const pemuat = vi.fn(() => janji);
    const a = renderHook(() => useReferensi('daftar', pemuat, { ttlMs: 0 }));
    const b = renderHook(() => useReferensi('daftar', pemuat, { ttlMs: 0 }));
    expect(pemuat).toHaveBeenCalledTimes(1);
    await act(async () => selesai(sukses('x')));
    expect(a.result.current.data).toBe('x');
    expect(b.result.current.data).toBe('x');
  });

  it('setelah semua pelanggan lepas, mount berikutnya memuat dari awal dan tidak melihat data lama', async () => {
    const pemuat = vi
      .fn<() => Promise<Hasil<string>>>()
      .mockResolvedValueOnce(sukses('lama'))
      .mockResolvedValueOnce(sukses('baru'));
    const pertama = renderHook(() => useReferensi('daftar', pemuat, { ttlMs: 0 }));
    await waitFor(() => expect(pertama.result.current.data).toBe('lama'));
    pertama.unmount();

    const kedua = renderHook(() => useReferensi('daftar', pemuat, { ttlMs: 0 }));
    expect(kedua.result.current).toMatchObject({ data: null, memuat: true, galat: null });
    await waitFor(() => expect(kedua.result.current.data).toBe('baru'));
    expect(pemuat).toHaveBeenCalledTimes(2);
  });

  it('pelanggan lepas saat masih memuat: hasilnya tidak tersisa untuk mount berikutnya', async () => {
    const lama = tunda<string>();
    const pemuat = vi
      .fn<() => Promise<Hasil<string>>>()
      .mockReturnValueOnce(lama.janji)
      .mockResolvedValueOnce(sukses('baru'));
    const pertama = renderHook(() => useReferensi('daftar', pemuat, { ttlMs: 0 }));
    pertama.unmount();
    await act(async () => lama.selesai(sukses('lama')));

    const kedua = renderHook(() => useReferensi('daftar', pemuat, { ttlMs: 0 }));
    expect(kedua.result.current).toMatchObject({ data: null, memuat: true });
    await waitFor(() => expect(kedua.result.current.data).toBe('baru'));
  });
});

describe('useReferensi: galat tidak di-cache', () => {
  it('hasil galat ditampilkan, lalu mount berikutnya mencoba lagi (bukan menyajikan galat dari cache)', async () => {
    const pemuat = vi
      .fn<() => Promise<Hasil<string>>>()
      .mockResolvedValueOnce(gagal('putus'))
      .mockResolvedValueOnce(sukses('pulih'));
    const pertama = renderHook(() => useReferensi('daftar', pemuat));
    await waitFor(() => expect(pertama.result.current.galat).toBe('putus'));
    expect(pertama.result.current).toMatchObject({ data: null, memuat: false });
    pertama.unmount();

    const kedua = renderHook(() => useReferensi('daftar', pemuat));
    // Tidak ada sisa galat dari percobaan sebelumnya: langsung kembali ke keadaan memuat.
    expect(kedua.result.current).toMatchObject({ data: null, memuat: true, galat: null });
    await waitFor(() => expect(kedua.result.current.data).toBe('pulih'));
    expect(pemuat).toHaveBeenCalledTimes(2);
  });

  it('pemuat yang melempar/menolak juga menjadi galat bertipe string', async () => {
    const pemuat = vi.fn<() => Promise<Hasil<string>>>().mockRejectedValue(new Error('Failed to fetch'));
    const { result } = renderHook(() => useReferensi('daftar', pemuat));
    await waitFor(() => expect(result.current.galat).toBe('Failed to fetch'));
    expect(result.current.memuat).toBe(false);
  });

  it('galat tanpa pesan tetap terbaca sebagai galat (string tidak kosong)', async () => {
    const pemuat = vi.fn(() => Promise.resolve(gagal<string>('')));
    const { result } = renderHook(() => useReferensi('daftar', pemuat));
    await waitFor(() => expect(result.current.galat).toBeTruthy());
  });

  it('mount ulang setelah galat tidak menampilkan galat lama untuk sesaat', async () => {
    const pemuat = vi.fn(() => Promise.resolve(gagal<string>('putus')));
    const pertama = renderHook(() => useReferensi('daftar', pemuat));
    await waitFor(() => expect(pertama.result.current.galat).toBe('putus'));
    pertama.unmount();
    const kedua = renderHook(() => useReferensi('daftar', pemuat));
    expect(kedua.result.current.galat).toBeNull();
    await waitFor(() => expect(kedua.result.current.galat).toBe('putus'));
  });
});

describe('useReferensi: segarkan dan pembuangan cache', () => {
  it('segarkan() membuang cache kunci itu lalu memuat ulang', async () => {
    const pemuat = vi
      .fn<() => Promise<Hasil<string>>>()
      .mockResolvedValueOnce(sukses('v1'))
      .mockResolvedValueOnce(sukses('v2'));
    const { result } = renderHook(() => useReferensi('daftar', pemuat));
    await waitFor(() => expect(result.current.data).toBe('v1'));

    act(() => result.current.segarkan());
    expect(result.current).toMatchObject({ data: null, memuat: true });
    await waitFor(() => expect(result.current.data).toBe('v2'));
    expect(pemuat).toHaveBeenCalledTimes(2);
  });

  it('segarkan() dua kali beruntun: hasil permintaan lama tidak menimpa yang baru', async () => {
    const lama = tunda<string>();
    const baru = tunda<string>();
    const pemuat = vi.fn<() => Promise<Hasil<string>>>().mockReturnValueOnce(lama.janji).mockReturnValueOnce(baru.janji);
    const { result } = renderHook(() => useReferensi('daftar', pemuat));
    act(() => result.current.segarkan());
    expect(pemuat).toHaveBeenCalledTimes(2);

    await act(async () => baru.selesai(sukses('baru')));
    await act(async () => lama.selesai(sukses('lama')));
    expect(result.current.data).toBe('baru');
  });

  it('segarkan() setelah galat berhasil memulihkan', async () => {
    const pemuat = vi
      .fn<() => Promise<Hasil<string>>>()
      .mockResolvedValueOnce(gagal('putus'))
      .mockResolvedValueOnce(sukses('pulih'));
    const { result } = renderHook(() => useReferensi('daftar', pemuat));
    await waitFor(() => expect(result.current.galat).toBe('putus'));
    act(() => result.current.segarkan());
    await waitFor(() => expect(result.current.data).toBe('pulih'));
    expect(result.current.galat).toBeNull();
  });

  it('buangCacheReferensi(awalan) hanya menandai kunci berawalan itu basi', async () => {
    const pemuatTopik = vi.fn(() => Promise.resolve(sukses('topik')));
    const pemuatLayanan = vi.fn(() => Promise.resolve(sukses('layanan')));
    const a = renderHook(() => useReferensi('topik:l1', pemuatTopik));
    const b = renderHook(() => useReferensi('layanan-ringkas', pemuatLayanan));
    await waitFor(() => expect(a.result.current.data).toBe('topik'));
    await waitFor(() => expect(b.result.current.data).toBe('layanan'));
    a.unmount();
    b.unmount();

    buangCacheReferensi('topik:');
    const a2 = renderHook(() => useReferensi('topik:l1', pemuatTopik));
    const b2 = renderHook(() => useReferensi('layanan-ringkas', pemuatLayanan));
    await waitFor(() => expect(pemuatTopik).toHaveBeenCalledTimes(2));
    expect(pemuatLayanan).toHaveBeenCalledTimes(1);
    expect(b2.result.current.data).toBe('layanan');
    a2.unmount();
    b2.unmount();
  });

  it('buangCacheReferensi() tanpa argumen membuang semuanya', async () => {
    const pemuat = vi.fn(() => Promise.resolve(sukses('x')));
    const a = renderHook(() => useReferensi('k1', pemuat));
    await waitFor(() => expect(a.result.current.data).toBe('x'));
    a.unmount();
    buangCacheReferensi();
    const b = renderHook(() => useReferensi('k1', pemuat));
    expect(b.result.current).toMatchObject({ data: null, memuat: true });
    await waitFor(() => expect(b.result.current.data).toBe('x'));
    expect(pemuat).toHaveBeenCalledTimes(2);
  });
});

describe('useReferensi: kunci null = nonaktif', () => {
  it('tidak memanggil pemuat dan tidak berstatus memuat', () => {
    const pemuat = vi.fn(() => Promise.resolve(sukses('x')));
    const { result } = renderHook(() => useReferensi(null, pemuat));
    expect(result.current).toMatchObject({ data: null, memuat: false, galat: null });
    expect(pemuat).not.toHaveBeenCalled();
    act(() => result.current.segarkan());
    expect(pemuat).not.toHaveBeenCalled();
  });

  it('diaktifkan kemudian (null -> kunci) baru memuat', async () => {
    const pemuat = vi.fn(() => Promise.resolve(sukses('x')));
    const { result, rerender } = renderHook(({ kunci }) => useReferensi(kunci, pemuat), {
      initialProps: { kunci: null as string | null },
    });
    expect(pemuat).not.toHaveBeenCalled();
    rerender({ kunci: 'aktif' });
    await waitFor(() => expect(result.current.data).toBe('x'));
    expect(pemuat).toHaveBeenCalledTimes(1);
  });
});

describe('useReferensi: pemuat terbaru dipakai tanpa memicu muat ulang', () => {
  it('render ulang dengan closure baru tidak memanggil pemuat lagi', async () => {
    const pemuat = vi.fn(() => Promise.resolve(sukses('x')));
    const { result, rerender } = renderHook(() => useReferensi('daftar', () => pemuat()));
    await waitFor(() => expect(result.current.data).toBe('x'));
    rerender();
    rerender();
    expect(pemuat).toHaveBeenCalledTimes(1);
  });

  it('galat + render ulang tidak membuat pemuat dipanggil berulang-ulang', async () => {
    const pemuat = vi.fn(() => Promise.resolve(gagal<string>('putus')));
    const { result, rerender } = renderHook(() => useReferensi('daftar', () => pemuat()));
    await waitFor(() => expect(result.current.galat).toBe('putus'));
    rerender();
    rerender();
    expect(pemuat).toHaveBeenCalledTimes(1);
  });
});
