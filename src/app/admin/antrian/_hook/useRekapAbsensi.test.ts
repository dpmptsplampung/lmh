// @vitest-environment jsdom
// Kontrak useRekapAbsensi (tugas 5.3): rekap absen dibaca hanya saat bagian dibuka (tiap kali dibuka), Petugas dibatasi ke
// Layanannya, galat diam-diam kosong, unduh CSV berisi BOM.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({ klien: true })) }));
vi.mock('@/lib/data/antrean', async (asli) => ({
  ...(await asli<typeof import('@/lib/data/antrean')>()),
  muatAbsensiRekap: vi.fn(),
}));

import { muatAbsensiRekap, type BarisAbsensi, type HasilAntrean, type ProfilPetugasAntrean } from '@/lib/data/antrean';
import { useRekapAbsensi } from './useRekapAbsensi';

const absen = (over: Partial<BarisAbsensi> = {}): BarisAbsensi => ({
  id: 'a-1', petugas_id: 'p-1', tanggal: '2026-11-04', jam_masuk: '2026-11-04T01:00:00.000Z', jam_pulang: null,
  status: 'approved', petugas: { nama: 'Rina' }, ...over,
});
const ok = (d: BarisAbsensi[]): HasilAntrean<BarisAbsensi[]> => ({ data: d, error: null });
const profil = (role: string, layanan_id = 'l-1'): ProfilPetugasAntrean =>
  ({ id: 'p-9', role, layanan_id, layanan: { nama: 'Helpdesk OSS' } });

const pasang = (currentUser: ProfilPetugasAntrean | null, tanggal = '2026-11-04') =>
  renderHook((p: { tanggal: string; currentUser: ProfilPetugasAntrean | null }) => useRekapAbsensi(p), {
    initialProps: { tanggal, currentUser },
  });

beforeEach(() => {
  vi.mocked(muatAbsensiRekap).mockReset().mockResolvedValue(ok([absen()]));
});

describe('useRekapAbsensi', () => {
  it('tertutup di awal dan tidak membaca apa pun; dibuka = baca (tiap kali dibuka), ditutup = tanpa baca', async () => {
    const { result, rerender } = pasang(profil('admin', ''));
    rerender({ tanggal: '2026-11-05', currentUser: profil('admin', '') });
    expect(result.current.rekapOpen).toBe(false);
    expect(muatAbsensiRekap).not.toHaveBeenCalled();

    await act(async () => { await result.current.alihkan(); });
    expect(result.current.rekapOpen).toBe(true);
    expect(vi.mocked(muatAbsensiRekap).mock.calls[0][1]).toEqual({ tanggal: '2026-11-05', layananId: null });
    expect(result.current.rekapAbsensi).toEqual([absen()]);
    expect(result.current.rekapLoading).toBe(false);

    await act(async () => { await result.current.alihkan(); });
    expect(result.current.rekapOpen).toBe(false);
    expect(muatAbsensiRekap).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.alihkan(); });
    expect(muatAbsensiRekap).toHaveBeenCalledTimes(2);
  });

  it('memuat: rekapLoading menyala selama baca berjalan', async () => {
    let lepas!: (v: HasilAntrean<BarisAbsensi[]>) => void;
    vi.mocked(muatAbsensiRekap).mockImplementationOnce(() => new Promise((r) => { lepas = r; }));
    const { result } = pasang(profil('admin', ''));
    let p!: Promise<void>;
    act(() => { p = result.current.alihkan(); });
    expect(result.current.rekapLoading).toBe(true);
    await act(async () => { lepas(ok([])); await p; });
    expect(result.current.rekapLoading).toBe(false);
  });

  it('Petugas dibatasi ke Layanannya; Front Office melihat semua; Petugas tanpa Layanan tidak membaca', async () => {
    const { result } = pasang(profil('petugas', 'l-7'));
    await act(async () => { await result.current.alihkan(); });
    expect(vi.mocked(muatAbsensiRekap).mock.calls[0][1]).toEqual({ tanggal: '2026-11-04', layananId: 'l-7' });

    const { result: fo } = pasang(profil('front_office', 'l-7'));
    await act(async () => { await fo.current.alihkan(); });
    expect(vi.mocked(muatAbsensiRekap).mock.calls[1][1]).toEqual({ tanggal: '2026-11-04', layananId: null });

    const { result: tanpa } = pasang(profil('petugas', ''));
    await act(async () => { await tanpa.current.alihkan(); });
    expect(tanpa.current.rekapOpen).toBe(true);
    expect(muatAbsensiRekap).toHaveBeenCalledTimes(2);
  });

  it('galat membaca: diam-diam kosong', async () => {
    vi.mocked(muatAbsensiRekap).mockResolvedValueOnce({ data: null, error: { jenis: 'umum', pesan: 'x', asli: null } });
    const { result } = pasang(profil('admin', ''));
    await act(async () => { await result.current.alihkan(); });
    expect(result.current.rekapAbsensi).toEqual([]);
  });

  it('unduhCsv: daftar_hadir_<layanan>_<tanggal>.csv dengan BOM, judul kolom, dan status berbahasa Indonesia', async () => {
    vi.mocked(muatAbsensiRekap).mockResolvedValueOnce(ok([
      absen(), absen({ id: 'a-2', status: 'pending' }), absen({ id: 'a-3', status: 'ditolak' }), absen({ id: 'a-4', status: 'alpa', petugas: null }),
    ]));
    const blobs: Blob[] = [];
    const asliCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: (b: Blob) => { blobs.push(b); return 'blob:x'; } });
    const klik = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    let unduhan = '';
    klik.mockImplementation(function (this: HTMLAnchorElement) { unduhan = this.download; });
    try {
      const { result } = pasang(profil('petugas', 'l-1'));
      await act(async () => { await result.current.alihkan(); });
      act(() => result.current.unduhCsv());
      expect(unduhan).toBe('daftar_hadir_Helpdesk_OSS_2026-11-04.csv');
      const byte = await new Promise<Uint8Array>((selesai) => {
        const pembaca = new FileReader();
        pembaca.onload = () => selesai(new Uint8Array(pembaca.result as ArrayBuffer));
        pembaca.readAsArrayBuffer(blobs[0]);
      });
      expect(Array.from(byte.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8
      const teks = new TextDecoder().decode(byte);
      expect(teks).toContain('Tanggal');
      expect(teks).toContain('Nama Petugas');
      for (const s of ['Disetujui', 'Menunggu', 'Ditolak', 'Alpa']) expect(teks).toContain(s);
    } finally {
      if (asliCreate) Object.defineProperty(URL, 'createObjectURL', asliCreate);
      else delete (URL as unknown as Record<string, unknown>).createObjectURL;
      klik.mockRestore();
    }
  });

  it('unduhCsv tanpa nama Layanan profil (Admin): semua_layanan', async () => {
    const asliCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => 'blob:x' });
    let unduhan = '';
    const klik = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      unduhan = this.download;
    });
    try {
      const { result } = pasang({ id: 'p', role: 'admin', layanan_id: '' });
      act(() => result.current.unduhCsv());
      expect(unduhan).toBe('daftar_hadir_semua_layanan_2026-11-04.csv');
    } finally {
      if (asliCreate) Object.defineProperty(URL, 'createObjectURL', asliCreate);
      else delete (URL as unknown as Record<string, unknown>).createObjectURL;
      klik.mockRestore();
    }
  });
});
