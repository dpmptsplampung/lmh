// @vitest-environment jsdom
// Kontrak useReservasi (tugas 9.2): muat awal berurutan, urutan kirim (validasi -> tanggal -> persetujuan -> consent -> RPC),
// penyegaran daftar, dan reset. Lapisan data dimock; aturan validasi murni memakai kode asli.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({ klien: true })) }));
vi.mock('@/lib/data/reservasi', () => ({
  muatPengunjungReservasi: vi.fn(),
  muatReservasiSaya: vi.fn(),
  batalkanReservasi: vi.fn(),
  muatLayananReservasi: vi.fn(),
  muatEstimasiAntrean: vi.fn(),
  cekHariLibur: vi.fn(),
  cekLayananBuka: vi.fn(),
  muatJadwalBerikutnya: vi.fn(),
  catatPersetujuanReservasi: vi.fn(),
  buatReservasi: vi.fn(),
}));

import * as data from '@/lib/data/reservasi';
import { addDaysWIB, todayWIB } from '@/lib/time';
import { useReservasi } from './useReservasi';

const ok = <T,>(d: T) => ({ data: d, error: null }) as const;
const galat = (pesan = '', kode: string | null = null) => ({ data: null, error: { pesan, kode, asli: new Error('x') } }) as const;

// Hari kerja terdekat dalam batas (mulai hari ini) agar lolos akhirPekan.
function hariKerja(): string {
  for (let i = 0; i <= 7; i++) {
    const t = addDaysWIB(i);
    const h = new Date(`${t}T00:00:00`).getDay();
    if (h !== 0 && h !== 6) return t;
  }
  return todayWIB();
}

let spyError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(data.muatPengunjungReservasi).mockReset().mockResolvedValue(ok({ authUserId: 'a-1', pengunjungId: 'p-1' }));
  vi.mocked(data.muatReservasiSaya).mockReset().mockResolvedValue(ok([]));
  vi.mocked(data.muatLayananReservasi).mockReset().mockResolvedValue(ok([{ id: 'l-1', nama: 'Helpdesk OSS' }]));
  vi.mocked(data.muatEstimasiAntrean).mockReset().mockResolvedValue(ok(null));
  vi.mocked(data.cekHariLibur).mockReset().mockResolvedValue(ok(false));
  vi.mocked(data.cekLayananBuka).mockReset().mockResolvedValue(ok(true));
  vi.mocked(data.muatJadwalBerikutnya).mockReset().mockResolvedValue(ok(null));
  vi.mocked(data.catatPersetujuanReservasi).mockReset().mockResolvedValue(ok(true));
  vi.mocked(data.buatReservasi).mockReset().mockResolvedValue(ok({ kunjunganId: 'k-1', qrToken: 'qr', tanggal: '2099-01-01' }));
  spyError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => spyError.mockRestore());

const pasang = async () => {
  const hook = renderHook(() => useReservasi());
  await waitFor(() => expect(hook.result.current.loadingInit).toBe(false));
  return hook.result;
};

const isiBertemu = (r: Awaited<ReturnType<typeof pasang>>) => {
  act(() => r.current.pilihTujuan('bertemu_seseorang'));
  act(() => r.current.ubahForm({ nama_yang_ditemui: 'Kepala Bidang', tanggal_rencana: hariKerja() }));
  act(() => r.current.setConsentGiven(true));
};

describe('muat awal', () => {
  it('profil -> daftar -> layanan, lalu loadingInit false', async () => {
    const urutan: string[] = [];
    vi.mocked(data.muatReservasiSaya).mockImplementation(async () => { urutan.push('daftar'); return ok([]); });
    vi.mocked(data.muatLayananReservasi).mockImplementation(async () => { urutan.push('layanan'); return ok([]); });
    const r = await pasang();
    expect(urutan).toEqual(['daftar', 'layanan']);
    expect(vi.mocked(data.muatReservasiSaya).mock.calls[0][1]).toBe('p-1');
    expect(r.current.minDate).toBe(todayWIB());
    expect(r.current.maxDate).toBe(addDaysWIB(7));
  });

  it('tanpa profil pengunjung: daftar tidak dimuat, layanan tetap, halaman siap', async () => {
    vi.mocked(data.muatPengunjungReservasi).mockResolvedValue(ok({ authUserId: 'a-1', pengunjungId: null }));
    await pasang();
    expect(data.muatReservasiSaya).not.toHaveBeenCalled();
    expect(data.muatLayananReservasi).toHaveBeenCalled();
  });

  it('galat membaca profil tidak menahan halaman di skeleton', async () => {
    vi.mocked(data.muatPengunjungReservasi).mockResolvedValue(galat());
    const r = await pasang();
    expect(r.current.loadingInit).toBe(false);
  });
});

describe('isian', () => {
  it('pilihTujuan mengosongkan isian milik tujuan lain', async () => {
    const r = await pasang();
    act(() => r.current.ubahForm({ layanan_id: 'l-1', nama_yang_ditemui: 'Budi' }));
    act(() => r.current.pilihTujuan('loket'));
    expect(r.current.form).toMatchObject({ tujuan: 'loket', layanan_id: 'l-1', nama_yang_ditemui: '' });
    act(() => r.current.ubahForm({ nama_yang_ditemui: 'Budi' }));
    act(() => r.current.pilihTujuan('bertemu_seseorang'));
    expect(r.current.form).toMatchObject({ tujuan: 'bertemu_seseorang', layanan_id: '', nama_yang_ditemui: 'Budi' });
  });

  it('mulaiLagi mengosongkan form dan layar berhasil', async () => {
    const r = await pasang();
    isiBertemu(r);
    await act(() => r.current.kirim());
    expect(r.current.success).toEqual({ qr_token: 'qr', tanggal_rencana: '2099-01-01' });
    act(() => r.current.mulaiLagi());
    expect(r.current.success).toBeNull();
    expect(r.current.form.tujuan).toBe('');
    expect(r.current.form.nama_yang_ditemui).toBe('');
  });
});

describe('kirim', () => {
  it('validasi isian: pesan, tanpa pemeriksaan server dan tanpa RPC', async () => {
    const r = await pasang();
    await act(() => r.current.kirim());
    expect(r.current.error).toBe('Pilih tujuan kunjungan');
    expect(data.buatReservasi).not.toHaveBeenCalled();
  });

  it('pemeriksaan tanggal menolak: pesan dari server dipakai, RPC tidak dipanggil', async () => {
    vi.mocked(data.cekHariLibur).mockResolvedValue(ok(true));
    const r = await pasang();
    isiBertemu(r);
    await act(() => r.current.kirim());
    expect(r.current.error).toBe('Kantor libur pada tanggal tersebut.');
    expect(data.buatReservasi).not.toHaveBeenCalled();
  });

  it('tanpa persetujuan atau tanpa pengunjung: pesan, tanpa consent dan RPC', async () => {
    const r = await pasang();
    isiBertemu(r);
    act(() => r.current.setConsentGiven(false));
    await act(() => r.current.kirim());
    expect(r.current.error).toBe('Anda harus menyetujui pemrosesan data sesuai Kebijakan Privasi.');
    vi.mocked(data.muatPengunjungReservasi).mockResolvedValue(ok({ authUserId: 'a-1', pengunjungId: null }));
    const r2 = await pasang();
    isiBertemu(r2);
    await act(() => r2.current.kirim());
    expect(r2.current.error).toBe('Sesi login tidak ditemukan. Silakan login ulang.');
    expect(data.catatPersetujuanReservasi).not.toHaveBeenCalled();
    expect(data.buatReservasi).not.toHaveBeenCalled();
  });

  it('sukses: consent dicatat SEBELUM RPC, parameter dikirim, daftar disegarkan', async () => {
    const urutan: string[] = [];
    vi.mocked(data.catatPersetujuanReservasi).mockImplementation(async () => { urutan.push('consent'); return ok(true); });
    vi.mocked(data.buatReservasi).mockImplementation(async () => {
      urutan.push('rpc');
      return ok({ kunjunganId: 'k-1', qrToken: 'qr', tanggal: '2099-01-01' });
    });
    const r = await pasang();
    isiBertemu(r);
    act(() => r.current.ubahForm({ jam_rencana: '09:30', keperluan: 'Konsultasi' }));
    vi.mocked(data.muatReservasiSaya).mockClear();
    await act(() => r.current.kirim());
    expect(urutan).toEqual(['consent', 'rpc']);
    expect(vi.mocked(data.catatPersetujuanReservasi).mock.calls[0][1]).toBe('a-1');
    expect(vi.mocked(data.buatReservasi).mock.calls[0][1]).toEqual({
      tujuan: 'bertemu_seseorang', layananId: '', namaYangDitemui: 'Kepala Bidang', tanggal: hariKerja(),
      jamRencana: '09:30', keperluan: 'Konsultasi',
    });
    expect(r.current.success).not.toBeNull();
    expect(r.current.error).toBe('');
    expect(r.current.loading).toBe(false);
    await waitFor(() => expect(data.muatReservasiSaya).toHaveBeenCalledTimes(1));
  });

  it('consent gagal: consentGagal true, RPC tidak dipanggil, loading kembali false; kirim ulang menghapus tanda', async () => {
    vi.mocked(data.catatPersetujuanReservasi).mockResolvedValueOnce(galat());
    const r = await pasang();
    isiBertemu(r);
    await act(() => r.current.kirim());
    expect(r.current.consentGagal).toBe(true);
    expect(data.buatReservasi).not.toHaveBeenCalled();
    expect(r.current.loading).toBe(false);
    expect(r.current.success).toBeNull();
    await act(() => r.current.kirim());
    expect(r.current.consentGagal).toBe(false);
    expect(r.current.success).not.toBeNull();
  });

  it('RPC gagal: pesan galat; RESERVASI_GANDA menyegarkan daftar, galat lain tidak', async () => {
    const r = await pasang();
    isiBertemu(r);
    vi.mocked(data.muatReservasiSaya).mockClear();
    vi.mocked(data.buatReservasi).mockResolvedValueOnce(galat('Kuota penuh.', 'KUOTA_PENUH'));
    await act(() => r.current.kirim());
    expect(r.current.error).toBe('Kuota penuh.');
    expect(data.muatReservasiSaya).not.toHaveBeenCalled();
    vi.mocked(data.buatReservasi).mockResolvedValueOnce(galat('Sudah ada.', 'RESERVASI_GANDA'));
    await act(() => r.current.kirim());
    expect(r.current.error).toBe('Sudah ada.');
    await waitFor(() => expect(data.muatReservasiSaya).toHaveBeenCalledTimes(1));
    expect(r.current.success).toBeNull();
  });

  it('kirim menerima event dan memanggil preventDefault', async () => {
    const r = await pasang();
    const preventDefault = vi.fn();
    await act(() => r.current.kirim({ preventDefault }));
    expect(preventDefault).toHaveBeenCalled();
  });
});
