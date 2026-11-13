// @vitest-environment jsdom
// Kontrak useFaq (tugas 8.2/8.3): setelah simpan/hapus/alih status FAQ sukses cache publik dibuang (tag publik-faq) tanpa
// menunggu dan tanpa menggagalkan aksi; galat tidak membuang cache; pemuatan, saring, pernyataan petugas, dan pemrosesan bot.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { HasilFaq } from '@/lib/data/faq';
import type { FAQ, IsianFaq } from '@/components/admin/faq/types';

const m = vi.hoisted(() => ({
  muatDaftarFaq: vi.fn(),
  tambahFaq: vi.fn(),
  ubahFaq: vi.fn(),
  ubahStatusFaq: vi.fn(),
  hapusFaq: vi.fn(),
  prosesEmbedFaq: vi.fn(),
  prosesEmbedMassal: vi.fn(),
  buangCacheFaqPublik: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/data/faq', () => m);

import { useFaq } from './useFaq';
import type { AksesFaqHook } from './useAksesFaq';

const ok = <T,>(data: T): HasilFaq<T> => ({ data, error: null });
const galat = <T,>(pesan: string, perluMuatUlang = false): HasilFaq<T> => ({
  data: null,
  error: { jenis: 'database', pesan, asli: null, perluMuatUlang },
});
const FAQ_1: FAQ = { id: 'f1', layanan_id: 'l1', pertanyaan: 'Syarat NIB?', jawaban: 'KTP.', aktif: true, urutan: 1 };
const FAQ_2: FAQ = { id: 'f2', layanan_id: null, pertanyaan: 'Jam buka?', jawaban: 'Senin.', aktif: false, urutan: 2 };
const LINGKUP = { jenis: 'semua' } as const;
const OPSI = [{ id: null, nama: 'Umum' }, { id: 'l1', nama: 'A' }];
const isian = (o: Partial<IsianFaq> = {}): IsianFaq => ({
  kunci: 'l1', pertanyaan: ' Baru? ', jawaban: ' Ya. ', dasarHukum: ' ', urutan: 4, pernyataan: true, ...o,
});

const toast = vi.fn();
const pasang = (akses: Partial<AksesFaqHook> = {}) => {
  const a = { siapMuat: true, lingkup: LINGKUP, isPetugas: false, isAdmin: true, opsiLayanan: OPSI, ...akses } as unknown as AksesFaqHook;
  return renderHook(() => useFaq({ akses: a, toast }));
};
const siap = async (akses: Partial<AksesFaqHook> = {}) => {
  const r = pasang(akses);
  await waitFor(() => expect(r.result.current.loading).toBe(false));
  return r;
};
const panggilRevalidasi = () => m.buangCacheFaqPublik.mock.calls.length;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  m.muatDaftarFaq.mockResolvedValue(ok({ faq: [FAQ_1, FAQ_2], menungguIds: ['f2'] }));
  m.tambahFaq.mockResolvedValue(ok({ id: 'baru' }));
  m.ubahFaq.mockResolvedValue(ok(null));
  m.ubahStatusFaq.mockResolvedValue(ok(null));
  m.hapusFaq.mockResolvedValue(ok(null));
  m.prosesEmbedFaq.mockResolvedValue(ok('diproses'));
  m.prosesEmbedMassal.mockResolvedValue(ok({ diproses: 2, gagal: 0, sisa: 0 }));
  m.buangCacheFaqPublik.mockResolvedValue(ok(null));
});
afterEach(cleanup);

describe('useFaq: muat dan saring', () => {
  it('memuat daftar sesuai lingkup dan menandai FAQ yang menunggu bot', async () => {
    const { result } = await siap();
    expect(m.muatDaftarFaq).toHaveBeenCalledWith({}, LINGKUP);
    expect(result.current.faqList).toEqual([FAQ_1, FAQ_2]);
    expect([...result.current.menungguIds]).toEqual(['f2']);
    expect(result.current.muatGagal).toBe(false);
  });

  it('belum siap (peran/layanan belum dimuat) = tidak memuat', async () => {
    const { result } = pasang({ siapMuat: false });
    await new Promise((r) => setTimeout(r, 10));
    expect(m.muatDaftarFaq).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });

  it('gagal memuat = muatGagal dan daftar kosong; Coba lagi memuat ulang', async () => {
    m.muatDaftarFaq.mockResolvedValueOnce(galat('x'));
    const { result } = await siap();
    expect(result.current.muatGagal).toBe(true);
    expect(result.current.faqList).toEqual([]);
    act(() => result.current.muatUlangDenganSpinner());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.muatGagal).toBe(false);
    expect(result.current.faqList).toHaveLength(2);
  });

  it('filter mengembalikan halaman ke 0 dan resetFilter menghapus semuanya', async () => {
    const { result } = await siap();
    act(() => result.current.setHalaman(3));
    act(() => result.current.setFilterStatus('aktif'));
    expect(result.current.tampil.map((f) => f.id)).toEqual(['f1']);
    expect(result.current.adaFilter).toBe(true);
    act(() => result.current.setCari('zzz'));
    expect(result.current.tampil).toEqual([]);
    act(() => result.current.resetFilter());
    expect(result.current.adaFilter).toBe(false);
    expect(result.current.tampil).toHaveLength(2);
  });

  it('prefill_pertanyaan membuka dialog Tambah sekali halaman siap', async () => {
    window.history.replaceState({}, '', '/admin/chat/faq?prefill_pertanyaan=Apa%20itu%20NIB');
    const { result } = await siap();
    await waitFor(() => expect(result.current.dialog).toEqual({ jenis: 'tambah', pertanyaanAwal: 'Apa itu NIB' }));
  });
});

describe('useFaq: revalidasi cache publik', () => {
  it('simpan baru sukses: data dipangkas, cache dibuang, bot diproses, dialog tertutup', async () => {
    const { result } = await siap();
    act(() => result.current.bukaTambah());
    let hasil: string | null = 'belum';
    await act(async () => { hasil = await result.current.simpan(isian()); });
    expect(hasil).toBeNull();
    expect(m.tambahFaq).toHaveBeenCalledWith({}, { pertanyaan: 'Baru?', jawaban: 'Ya.', dasarHukum: null, urutan: 4, layananId: 'l1' });
    expect(panggilRevalidasi()).toBe(1);
    expect(m.prosesEmbedFaq).toHaveBeenCalledWith('baru', expect.stringContaining('FAQ tersimpan'));
    expect(toast).toHaveBeenCalledWith('Pertanyaan ditambahkan.', 'success');
    expect(result.current.dialog).toBeNull();
  });

  it('simpan ubah sukses: cache dibuang; embedding hanya dikosongkan bila teks berubah', async () => {
    const { result } = await siap();
    act(() => result.current.bukaUbah(FAQ_1));
    await act(async () => { await result.current.simpan(isian({ pertanyaan: FAQ_1.pertanyaan, jawaban: FAQ_1.jawaban })); });
    expect(m.ubahFaq).toHaveBeenCalledWith({}, expect.objectContaining({ id: 'f1', hapusEmbedding: false }));
    expect(panggilRevalidasi()).toBe(1);
    expect(m.prosesEmbedFaq).not.toHaveBeenCalled();
    act(() => result.current.bukaUbah(FAQ_1));
    await act(async () => { await result.current.simpan(isian()); });
    expect(m.ubahFaq).toHaveBeenLastCalledWith({}, expect.objectContaining({ hapusEmbedding: true }));
    expect(panggilRevalidasi()).toBe(2);
  });

  it('simpan gagal: pesan galat dikembalikan, dialog tetap, cache TIDAK dibuang; ditolak RLS memuat ulang daftar', async () => {
    m.tambahFaq.mockResolvedValueOnce(galat('Anda tidak berwenang', true));
    const { result } = await siap();
    act(() => result.current.bukaTambah());
    let hasil: string | null = null;
    await act(async () => { hasil = await result.current.simpan(isian()); });
    expect(hasil).toBe('Anda tidak berwenang');
    expect(result.current.dialog).toEqual({ jenis: 'tambah' });
    expect(panggilRevalidasi()).toBe(0);
    await waitFor(() => expect(m.muatDaftarFaq).toHaveBeenCalledTimes(2));
  });

  it('hapus sukses membuang cache; gagal tidak', async () => {
    const { result } = await siap();
    await act(async () => { expect(await result.current.hapus(FAQ_1)).toBeNull(); });
    expect(m.hapusFaq).toHaveBeenCalledWith({}, 'f1');
    expect(toast).toHaveBeenCalledWith('FAQ dihapus.', 'success');
    expect(panggilRevalidasi()).toBe(1);
    m.hapusFaq.mockResolvedValueOnce(galat('Gagal menghapus FAQ.'));
    await act(async () => { expect(await result.current.hapus(FAQ_1)).toBe('Gagal menghapus FAQ.'); });
    expect(panggilRevalidasi()).toBe(1);
  });

  it('alih aktif/nonaktif sukses: lencana berubah di tempat dan cache dibuang; gagal tidak', async () => {
    const { result } = await siap();
    await act(async () => { await result.current.alihAktif(FAQ_1); });
    expect(m.ubahStatusFaq).toHaveBeenCalledWith({}, 'f1', false);
    expect(result.current.faqList.find((f) => f.id === 'f1')?.aktif).toBe(false);
    expect(toast).toHaveBeenCalledWith('FAQ dinonaktifkan.', 'success');
    expect(panggilRevalidasi()).toBe(1);
    m.ubahStatusFaq.mockResolvedValueOnce(galat('Gagal mengubah status FAQ.'));
    await act(async () => { await result.current.alihAktif(FAQ_2); });
    expect(toast).toHaveBeenLastCalledWith('Gagal mengubah status FAQ.', 'error');
    expect(panggilRevalidasi()).toBe(1);
    expect(result.current.togglingId).toBeNull();
  });

  it('revalidasi tidak ditunggu dan kegagalannya tidak mengubah hasil aksi (tanpa toast galat)', async () => {
    m.buangCacheFaqPublik.mockReturnValue(new Promise(() => {})); // menggantung selamanya
    const { result } = await siap();
    await act(async () => { expect(await result.current.hapus(FAQ_1)).toBeNull(); });
    expect(result.current.dialog).toBeNull();
    m.buangCacheFaqPublik.mockResolvedValue(galat('Cache publik belum dibuang.'));
    await act(async () => { await result.current.alihAktif(FAQ_1); });
    expect(toast.mock.calls.filter((c) => c[1] === 'error')).toEqual([]);
  });

  it('non-Admin (Petugas) tidak memanggil revalidasi karena route-nya hanya untuk Admin', async () => {
    const { result } = await siap({ isPetugas: true, isAdmin: false });
    await act(async () => { await result.current.alihAktif(FAQ_1); });
    expect(panggilRevalidasi()).toBe(0);
  });

  it('pemrosesan bot sendiri tidak membuang cache', async () => {
    const { result } = await siap();
    await act(async () => { await result.current.prosesFaq('f2', false); });
    expect(toast).toHaveBeenCalledWith('FAQ diproses. Bot sudah bisa memakainya.', 'success');
    expect(panggilRevalidasi()).toBe(0);
  });
});

describe('useFaq: pemrosesan bot dan pernyataan petugas', () => {
  it('proses sekarang (Admin): ringkasan jumlah; galat memakai pesan server', async () => {
    m.prosesEmbedMassal.mockResolvedValueOnce(ok({ diproses: 3, gagal: 1, sisa: 4 }));
    const { result } = await siap();
    await act(async () => { await result.current.prosesSemua(); });
    expect(toast).toHaveBeenCalledWith('3 FAQ diproses. 1 belum berhasil, coba lagi. 4 masih menunggu.', 'error');
    m.prosesEmbedMassal.mockResolvedValueOnce(galat('Server misconfigured'));
    await act(async () => { await result.current.prosesSemua(); });
    expect(toast).toHaveBeenLastCalledWith('Server misconfigured', 'error');
  });

  it('proses sekarang ditolak untuk non-Admin', async () => {
    const { result } = await siap({ isAdmin: false });
    await act(async () => { await result.current.prosesSemua(); });
    expect(m.prosesEmbedMassal).not.toHaveBeenCalled();
  });

  it('galat memproses satu FAQ ditampilkan; 409 diam', async () => {
    m.prosesEmbedFaq.mockResolvedValueOnce(galat('Terlalu banyak.'));
    const { result } = await siap();
    await act(async () => { await result.current.prosesFaq('f2', false); });
    expect(toast).toHaveBeenCalledWith('Terlalu banyak.', 'error');
    toast.mockClear();
    m.prosesEmbedFaq.mockResolvedValueOnce(ok('sudah_diproses'));
    await act(async () => { await result.current.prosesFaq('f2', false); });
    expect(toast).not.toHaveBeenCalled();
  });

  it('petugas wajib pernyataan sampai menyimpan sekali; tersimpan di sessionStorage', async () => {
    const { result } = await siap({ isPetugas: true, isAdmin: false });
    expect(result.current.perluPernyataan).toBe(true);
    act(() => result.current.bukaTambah());
    await act(async () => { await result.current.simpan(isian()); });
    expect(result.current.perluPernyataan).toBe(false);
    expect(sessionStorage.getItem('lmh_faq_tanggung_jawab')).toBe('1');
  });
});
