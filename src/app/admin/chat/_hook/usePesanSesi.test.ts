// @vitest-environment jsdom
// Kontrak usePesanSesi (tugas 7.2): riwayat penuh saat sesi dibuka, penjaga respons basi, pesan Realtime hanya untuk sesi
// terpilih, balasan idempoten (client_uuid dipakai ulang bila teks sama), foto, draf, dan riwayat lebih lama.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ChatMsg } from '@/app/chat/merge';
import type { PesanBaru } from './useDaftarSesi';

const d = vi.hoisted(() => ({ muat: vi.fn(), kirim: vi.fn(), foto: vi.fn(), draf: vi.fn() }));
vi.mock('@/lib/data/chat-staf', () => ({
  muatPesanSesi: d.muat,
  kirimPesanStaf: d.kirim,
  kirimFotoStaf: d.foto,
  buatDrafBalasan: d.draf,
}));

import { usePesanSesi } from './usePesanSesi';

const pesanAda = (id: string, o: Partial<ChatMsg> = {}): ChatMsg => ({
  id, pengirim: 'pengunjung', isi: `isi ${id}`, created_at: `2026-10-14T01:00:0${id.slice(-1)}Z`, sesi_id: 's1', ...o,
});
const gagal = (pesan: string) => ({ data: null, error: { jenis: 'http', pesan, asli: null } });

const toast = vi.fn();
const muatDaftar = vi.fn();
let pendengar: Array<(p: PesanBaru) => void>;
const langganPesanBaru = (fn: (p: PesanBaru) => void) => {
  pendengar.push(fn);
  return () => {
    pendengar = pendengar.filter((x) => x !== fn);
  };
};

interface Props { sesiId: string | null; selesai?: boolean; bolehBalas?: boolean }
const pasang = (awal: Props = { sesiId: 's1' }) =>
  renderHook((p: Props) => usePesanSesi({
    sesiId: p.sesiId, selesai: p.selesai ?? false, bolehBalas: p.bolehBalas ?? true, rt: 'connecting',
    langganPesanBaru, muatDaftar, toast,
  }), { initialProps: awal });

beforeEach(() => {
  vi.clearAllMocks();
  pendengar = [];
  d.muat.mockResolvedValue({ data: { messages: [pesanAda('m1')], adaLebih: false }, error: null });
});
afterEach(cleanup);

describe('usePesanSesi: muat', () => {
  it('membuka sesi memuat riwayat penuh (riwayat: true) dan menyimpan penanda ada lebih', async () => {
    d.muat.mockResolvedValue({ data: { messages: [pesanAda('m1')], adaLebih: true }, error: null });
    const { result } = pasang();
    await waitFor(() => expect(result.current.pesan).toHaveLength(1));
    expect(d.muat).toHaveBeenCalledWith({ sesiId: 's1', riwayat: true });
    expect(result.current.adaLebih).toBe(true);
  });

  it('tanpa sesi tidak memuat apa pun', () => {
    pasang({ sesiId: null });
    expect(d.muat).not.toHaveBeenCalled();
  });

  it('muat tanpa opsi memuat satu sesi dan tidak mengubah penanda ada lebih', async () => {
    d.muat.mockResolvedValueOnce({ data: { messages: [pesanAda('m1')], adaLebih: true }, error: null });
    const { result } = pasang();
    await waitFor(() => expect(result.current.adaLebih).toBe(true));
    d.muat.mockResolvedValueOnce({ data: { messages: [pesanAda('m2')], adaLebih: false }, error: null });
    await act(async () => {
      await result.current.muat();
    });
    expect(d.muat).toHaveBeenLastCalledWith({ sesiId: 's1', riwayat: undefined });
    expect(result.current.pesan.map((p) => p.id)).toEqual(['m1', 'm2']);
    expect(result.current.adaLebih).toBe(true);
  });

  it('galat memuat diabaikan (poll berikutnya mencoba lagi)', async () => {
    d.muat.mockResolvedValue(gagal('putus'));
    const { result } = pasang();
    await waitFor(() => expect(d.muat).toHaveBeenCalled());
    expect(result.current.pesan).toEqual([]);
    expect(toast).not.toHaveBeenCalled();
  });

  it('respons sesi lama yang tiba setelah berpindah sesi dibuang', async () => {
    let lepasLama!: (v: unknown) => void;
    d.muat.mockReturnValueOnce(new Promise((r) => (lepasLama = r)));
    const { result, rerender } = pasang({ sesiId: 's1' });
    d.muat.mockResolvedValue({ data: { messages: [pesanAda('b1', { sesi_id: 's2' })], adaLebih: false }, error: null });
    act(() => result.current.reset());
    rerender({ sesiId: 's2' });
    await waitFor(() => expect(result.current.pesan.map((p) => p.id)).toEqual(['b1']));
    await act(async () => lepasLama({ data: { messages: [pesanAda('a1')], adaLebih: true }, error: null }));
    expect(result.current.pesan.map((p) => p.id)).toEqual(['b1']);
    expect(result.current.adaLebih).toBe(false);
  });

  it('reset mengosongkan utas, isian, dan galat kirim', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.pesan).toHaveLength(1));
    act(() => result.current.setIsian('draf'));
    act(() => result.current.reset());
    expect(result.current.pesan).toEqual([]);
    expect(result.current.isian).toBe('');
    expect(result.current.adaLebih).toBe(false);
  });
});

describe('usePesanSesi: Realtime', () => {
  it('pesan baru sesi terpilih digabung; pesan sesi lain diabaikan; berhenti saat unmount', async () => {
    const { result, unmount } = pasang();
    await waitFor(() => expect(result.current.pesan).toHaveLength(1));
    act(() => pendengar.forEach((fn) => fn(pesanAda('m2') as PesanBaru)));
    expect(result.current.pesan.map((p) => p.id)).toEqual(['m1', 'm2']);
    act(() => pendengar.forEach((fn) => fn(pesanAda('x3', { sesi_id: 'lain' }) as PesanBaru)));
    expect(result.current.pesan.map((p) => p.id)).toEqual(['m1', 'm2']);
    unmount();
    expect(pendengar).toHaveLength(0);
  });
});

describe('usePesanSesi: riwayat lebih lama', () => {
  it('memanggil dengan sebelum = pesan tertua bukan-lokal, menggabung, lalu memperbarui penanda', async () => {
    d.muat.mockResolvedValueOnce({ data: { messages: [pesanAda('m5')], adaLebih: true }, error: null });
    const { result } = pasang();
    await waitFor(() => expect(result.current.adaLebih).toBe(true));
    d.muat.mockResolvedValueOnce({ data: { messages: [pesanAda('m1')], adaLebih: false }, error: null });
    await act(async () => {
      await result.current.muatRiwayatLebihLama();
    });
    expect(d.muat).toHaveBeenLastCalledWith({ sesiId: 's1', riwayat: true, sebelum: pesanAda('m5').created_at });
    expect(result.current.pesan.map((p) => p.id)).toEqual(['m1', 'm5']);
    expect(result.current.adaLebih).toBe(false);
    expect(result.current.memuatRiwayat).toBe(false);
  });

  it('galat: tombol tetap ada (penanda tidak berubah) dan status memuat dipulihkan', async () => {
    d.muat.mockResolvedValueOnce({ data: { messages: [pesanAda('m5')], adaLebih: true }, error: null });
    const { result } = pasang();
    await waitFor(() => expect(result.current.adaLebih).toBe(true));
    d.muat.mockResolvedValueOnce(gagal('putus'));
    await act(async () => {
      await result.current.muatRiwayatLebihLama();
    });
    expect(result.current.adaLebih).toBe(true);
    expect(result.current.memuatRiwayat).toBe(false);
  });
});

describe('usePesanSesi: balasan teks', () => {
  it('sukses: pesan server digabung, isian dikosongkan, uuid dikirim', async () => {
    d.kirim.mockResolvedValue({ data: { message: pesanAda('m2', { pengirim: 'petugas' }) }, error: null });
    const { result } = pasang();
    await waitFor(() => expect(result.current.pesan).toHaveLength(1));
    act(() => result.current.setIsian('Selamat siang'));
    await act(async () => {
      await result.current.kirim('  Selamat siang ');
    });
    expect(d.kirim).toHaveBeenCalledWith({ sesiId: 's1', isi: 'Selamat siang', clientUuid: expect.any(String) });
    expect(result.current.pesan.map((p) => p.id)).toEqual(['m1', 'm2']);
    expect(result.current.isian).toBe('');
    expect(result.current.mengirim).toBe(false);
  });

  it('gagal: teks dipertahankan, pesan galat inline + toast, daftar dimuat ulang; kirim ulang memakai uuid yang sama', async () => {
    d.kirim.mockResolvedValueOnce(gagal('Bukan pemilik'));
    const { result } = pasang();
    await waitFor(() => expect(result.current.pesan).toHaveLength(1));
    act(() => result.current.setIsian('Halo'));
    await act(async () => {
      await result.current.kirim('Halo');
    });
    expect(result.current.galatKirim).toBe('Bukan pemilik. Teks Anda masih ada — kirim lagi.');
    expect(result.current.isian).toBe('Halo');
    expect(toast).toHaveBeenCalledWith('Bukan pemilik', 'error');
    expect(muatDaftar).toHaveBeenCalled();

    d.kirim.mockResolvedValueOnce({ data: { message: null }, error: null });
    await act(async () => {
      await result.current.kirim('Halo');
    });
    const [a, b] = d.kirim.mock.calls.map((c) => c[0].clientUuid);
    expect(a).toBe(b);
    expect(result.current.galatKirim).toBe('');
    expect(result.current.isian).toBe('');
  });

  it('teks berbeda mendapat uuid baru', async () => {
    d.kirim.mockResolvedValue(gagal('x'));
    const { result } = pasang();
    await waitFor(() => expect(d.muat).toHaveBeenCalled());
    await act(async () => { await result.current.kirim('satu'); });
    await act(async () => { await result.current.kirim('dua'); });
    const [a, b] = d.kirim.mock.calls.map((c) => c[0].clientUuid);
    expect(a).not.toBe(b);
  });

  it.each([
    ['teks kosong', { bolehBalas: true }, '   '],
    ['belum memegang sesi', { bolehBalas: false }, 'halo'],
  ])('tidak mengirim saat %s', async (_n, props, teks) => {
    const { result } = pasang({ sesiId: 's1', ...props });
    await act(async () => { await result.current.kirim(teks); });
    expect(d.kirim).not.toHaveBeenCalled();
  });

  it('balasan sukses setelah berpindah sesi tidak menimpa utas sesi baru', async () => {
    let lepas!: (v: unknown) => void;
    d.kirim.mockReturnValueOnce(new Promise((r) => (lepas = r)));
    const { result, rerender } = pasang({ sesiId: 's1' });
    await waitFor(() => expect(result.current.pesan).toHaveLength(1));
    let p!: Promise<void>;
    act(() => { p = result.current.kirim('halo'); });
    d.muat.mockResolvedValue({ data: { messages: [pesanAda('b1', { sesi_id: 's2' })], adaLebih: false }, error: null });
    act(() => result.current.reset());
    rerender({ sesiId: 's2' });
    await waitFor(() => expect(result.current.pesan.map((x) => x.id)).toEqual(['b1']));
    await act(async () => { lepas({ data: { message: pesanAda('m9', { pengirim: 'petugas' }) }, error: null }); await p; });
    expect(result.current.pesan.map((x) => x.id)).toEqual(['b1']);
  });
});

describe('usePesanSesi: foto dan draf', () => {
  const berkas = new File(['x'], 'a.png', { type: 'image/png' });

  it('foto sukses menggabung pesan; gagal menampilkan toast dengan pesannya', async () => {
    d.foto.mockResolvedValueOnce({ data: { message: pesanAda('m3', { pengirim: 'petugas' }) }, error: null });
    const { result } = pasang();
    await waitFor(() => expect(result.current.pesan).toHaveLength(1));
    await act(async () => { await result.current.kirimFoto(berkas); });
    expect(d.foto).toHaveBeenCalledWith({ sesiId: 's1', berkas });
    expect(result.current.pesan.map((p) => p.id)).toEqual(['m1', 'm3']);

    d.foto.mockResolvedValueOnce(gagal('Foto terlalu besar'));
    await act(async () => { await result.current.kirimFoto(berkas); });
    expect(toast).toHaveBeenCalledWith('Foto terlalu besar', 'error');
    expect(result.current.mengirimFoto).toBe(false);
  });

  it('foto tidak dikirim tanpa berkas atau tanpa izin balas', async () => {
    const { result } = pasang({ sesiId: 's1', bolehBalas: false });
    await act(async () => { await result.current.kirimFoto(undefined); });
    await act(async () => { await result.current.kirimFoto(berkas); });
    expect(d.foto).not.toHaveBeenCalled();
  });

  it('draf mengisi kotak balasan dan memberi tahu; galat route ditampilkan', async () => {
    d.draf.mockResolvedValueOnce({ data: 'Draf jawaban', error: null });
    const { result } = pasang();
    await act(async () => { await result.current.buatDraf(); });
    expect(d.draf).toHaveBeenCalledWith('s1');
    expect(result.current.isian).toBe('Draf jawaban');
    expect(toast).toHaveBeenCalledWith('Draf balasan Gemini berhasil dimuat!', 'success');

    d.draf.mockResolvedValueOnce(gagal('Kuota habis'));
    await act(async () => { await result.current.buatDraf(); });
    expect(toast).toHaveBeenCalledWith('Kuota habis', 'error');
    expect(result.current.isian).toBe('Draf jawaban');
    expect(result.current.memuatDraf).toBe(false);
  });
});
