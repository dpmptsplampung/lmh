// @vitest-environment jsdom
// Kontrak useKetersediaan (tugas 9.2): muat layanan (galat != kosong), estimasi per layanan, dan periksaTanggal ke server.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({ klien: true })) }));
vi.mock('@/lib/data/reservasi', () => ({
  muatLayananReservasi: vi.fn(),
  muatEstimasiAntrean: vi.fn(),
  cekHariLibur: vi.fn(),
  cekLayananBuka: vi.fn(),
  muatJadwalBerikutnya: vi.fn(),
}));

import {
  cekHariLibur,
  cekLayananBuka,
  muatEstimasiAntrean,
  muatJadwalBerikutnya,
  muatLayananReservasi,
} from '@/lib/data/reservasi';
import { useKetersediaan } from './useKetersediaan';

const ok = <T,>(data: T) => ({ data, error: null }) as const;
const galat = { data: null, error: { pesan: '', kode: null, asli: new Error('x') } } as const;
const layananA = { id: 'l-1', nama: 'Helpdesk OSS' };

beforeEach(() => {
  vi.mocked(muatLayananReservasi).mockReset().mockResolvedValue(ok([layananA]));
  vi.mocked(muatEstimasiAntrean).mockReset().mockResolvedValue(ok({ antre_count: 4, estimasi_tunggu_total_menit: 20 }));
  vi.mocked(cekHariLibur).mockReset().mockResolvedValue(ok(false));
  vi.mocked(cekLayananBuka).mockReset().mockResolvedValue(ok(true));
  vi.mocked(muatJadwalBerikutnya).mockReset().mockResolvedValue(ok('2099-01-05'));
});

describe('muatLayanan', () => {
  it('sukses: daftar terisi, tanpa galat; memuat kembali false', async () => {
    const { result } = renderHook(() => useKetersediaan(''));
    await act(() => result.current.muatLayanan());
    expect(result.current.layanan).toEqual([layananA]);
    expect(result.current.layananGalat).toBe(false);
    expect(result.current.layananMemuat).toBe(false);
  });

  it('galat: daftar dikosongkan dan layananGalat true (beda dari kosong yang sah); muat ulang memulihkan', async () => {
    vi.mocked(muatLayananReservasi).mockResolvedValueOnce(galat);
    const { result } = renderHook(() => useKetersediaan(''));
    await act(() => result.current.muatLayanan());
    expect(result.current.layanan).toEqual([]);
    expect(result.current.layananGalat).toBe(true);
    await act(() => result.current.muatLayanan());
    expect(result.current.layananGalat).toBe(false);
    expect(result.current.layanan).toEqual([layananA]);
  });

  it('daftar kosong yang sah: bukan galat', async () => {
    vi.mocked(muatLayananReservasi).mockResolvedValue(ok([]));
    const { result } = renderHook(() => useKetersediaan(''));
    await act(() => result.current.muatLayanan());
    expect(result.current.layanan).toEqual([]);
    expect(result.current.layananGalat).toBe(false);
  });
});

describe('estimasi antrean', () => {
  it('tanpa layanan terpilih tidak memanggil data; terpilih memuat; ganti/kosongkan layanan membersihkan', async () => {
    const { result, rerender } = renderHook(({ id }) => useKetersediaan(id), { initialProps: { id: '' } });
    expect(muatEstimasiAntrean).not.toHaveBeenCalled();
    rerender({ id: 'l-1' });
    await waitFor(() => expect(result.current.estimasi).toEqual({ antre_count: 4, estimasi_tunggu_total_menit: 20 }));
    expect(vi.mocked(muatEstimasiAntrean).mock.calls[0][1]).toBe('l-1');
    rerender({ id: '' });
    expect(result.current.estimasi).toBeNull();
  });

  it('galat atau tanpa baris = null; respons basi (layanan sudah berganti) diabaikan', async () => {
    vi.mocked(muatEstimasiAntrean).mockResolvedValue(galat);
    const { result, rerender } = renderHook(({ id }) => useKetersediaan(id), { initialProps: { id: 'l-1' } });
    await waitFor(() => expect(muatEstimasiAntrean).toHaveBeenCalled());
    expect(result.current.estimasi).toBeNull();

    let lepas: (v: ReturnType<typeof ok>) => void = () => undefined;
    vi.mocked(muatEstimasiAntrean).mockReset().mockImplementationOnce(
      () => new Promise((res) => { lepas = res as typeof lepas; }),
    ).mockResolvedValue(ok(null));
    rerender({ id: 'l-2' });
    rerender({ id: 'l-3' });
    await act(async () => lepas(ok({ antre_count: 9, estimasi_tunggu_total_menit: 99 })));
    expect(result.current.estimasi).toBeNull();
  });
});

describe('periksaTanggal', () => {
  const pasang = async () => {
    const hook = renderHook(() => useKetersediaan(''));
    await act(() => hook.result.current.muatLayanan());
    return hook.result;
  };

  it('bertemu: akhir pekan ditolak tanpa membaca hari_libur', async () => {
    const r = await pasang();
    const pesan = await r.current.periksaTanggal({ tujuan: 'bertemu_seseorang', layanan_id: '', tanggal_rencana: '2026-11-14' });
    expect(pesan).toBe('Reservasi hanya tersedia pada hari kerja (Senin–Jumat). Mau tanya dulu? Live chat tersedia.');
    expect(cekHariLibur).not.toHaveBeenCalled();
  });

  it('bertemu: hari libur ditolak; bukan libur lolos; galat baca = tidak menolak', async () => {
    const r = await pasang();
    const p = { tujuan: 'bertemu_seseorang', layanan_id: '', tanggal_rencana: '2026-11-16' } as const;
    vi.mocked(cekHariLibur).mockResolvedValueOnce(ok(true));
    expect(await r.current.periksaTanggal(p)).toBe('Kantor libur pada tanggal tersebut.');
    expect(await r.current.periksaTanggal(p)).toBeNull();
    vi.mocked(cekHariLibur).mockResolvedValueOnce(galat);
    expect(await r.current.periksaTanggal(p)).toBeNull();
  });

  it('loket: buka = lolos tanpa membaca hari_libur; Sabtu tidak ditolak klien', async () => {
    const r = await pasang();
    expect(await r.current.periksaTanggal({ tujuan: 'loket', layanan_id: 'l-1', tanggal_rencana: '2026-11-14' })).toBeNull();
    expect(vi.mocked(cekLayananBuka).mock.calls[0].slice(1)).toEqual(['l-1', '2026-11-14']);
    expect(cekHariLibur).not.toHaveBeenCalled();
  });

  it('loket: tutup (false) = pesan dengan nama layanan + jadwal terdekat; tanpa jadwal = pesan live chat', async () => {
    const r = await pasang();
    const p = { tujuan: 'loket', layanan_id: 'l-1', tanggal_rencana: '2026-11-16' } as const;
    vi.mocked(cekLayananBuka).mockResolvedValue(ok(false));
    expect(await r.current.periksaTanggal(p)).toMatch(/^Helpdesk OSS di kantor DPMPTSP tidak beroperasi pada tanggal itu\. Jadwal terdekat:/);
    vi.mocked(muatJadwalBerikutnya).mockResolvedValueOnce(galat);
    expect(await r.current.periksaTanggal(p)).toBe(
      'Helpdesk OSS tidak beroperasi pada tanggal itu. Silakan tanya lewat live chat untuk jadwal pasti.',
    );
  });

  it('loket: layanan tak ada di daftar memakai "Layanan ini"; galat RPC (atau null) tidak menolak', async () => {
    const r = await pasang();
    vi.mocked(cekLayananBuka).mockResolvedValueOnce(ok(false));
    vi.mocked(muatJadwalBerikutnya).mockResolvedValueOnce(ok(null));
    expect(await r.current.periksaTanggal({ tujuan: 'loket', layanan_id: 'l-x', tanggal_rencana: '2026-11-16' })).toMatch(/^Layanan ini tidak beroperasi/);
    const p = { tujuan: 'loket', layanan_id: 'l-1', tanggal_rencana: '2026-11-16' } as const;
    vi.mocked(cekLayananBuka).mockResolvedValueOnce(galat);
    expect(await r.current.periksaTanggal(p)).toBeNull();
    vi.mocked(cekLayananBuka).mockResolvedValueOnce(ok(null));
    expect(await r.current.periksaTanggal(p)).toBeNull();
  });

  it('loket tanpa layanan dan tujuan kosong: tidak memeriksa apa pun', async () => {
    const r = await pasang();
    expect(await r.current.periksaTanggal({ tujuan: 'loket', layanan_id: '', tanggal_rencana: '2026-11-16' })).toBeNull();
    expect(await r.current.periksaTanggal({ tujuan: '', layanan_id: '', tanggal_rencana: '2026-11-16' })).toBeNull();
    expect(cekLayananBuka).not.toHaveBeenCalled();
    expect(cekHariLibur).not.toHaveBeenCalled();
  });
});
