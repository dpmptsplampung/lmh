// @vitest-environment jsdom
// Kontrak useDaftarSesi (tugas 7.2): profil dibaca sekali sebelum muat pertama, Realtime satu channel per tabel (chat_sesi
// lewat pusat `staf-tabel-chat_sesi`, INSERT chat_pesan lewat `chat-admin` yang dibuka ulang setelah CLOSED),
// filter layanan petugas, tautan ?sesi=, galat daftar vs galat tahap, pilihan sesi + penanda terbaca, dan filter "selesai".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { RingkasSesi, TahapChat } from '@/lib/data/chat-staf';

const m = vi.hoisted(() => ({
  profil: vi.fn(),
  daftar: vi.fn(),
  kontak: vi.fn(),
  pengikat: [] as Array<{ filter: { event: string; table: string }; fn: (payload?: unknown) => void }>,
  status: null as null | ((s: string) => void),
  statusPer: {} as Record<string, (s: string) => void>,
  kanal: [] as string[],
  dilepas: vi.fn(),
  statusAwal: 'SUBSCRIBED',
}));

vi.mock('@/lib/supabase/client', () => {
  const buatChannel = (nama: string) => {
    const channel = {
      on: (_t: string, filter: { event: string; table: string }, fn: (payload?: unknown) => void) => {
        m.pengikat.push({ filter, fn });
        return channel;
      },
      subscribe: (cb: (s: string) => void) => {
        m.status = cb;
        m.statusPer[nama] = cb;
        cb(m.statusAwal);
        return channel;
      },
    };
    return channel;
  };
  return {
    createClient: () => ({
      channel: (nama: string) => {
        m.kanal.push(nama);
        return buatChannel(nama);
      },
      removeChannel: m.dilepas,
    }),
  };
});
vi.mock('@/lib/data/chat-staf', async (asli) => ({
  ...(await asli<typeof import('@/lib/data/chat-staf')>()),
  muatProfilStafChat: m.profil,
  muatDaftarSesiStaf: m.daftar,
  muatKontakSesi: m.kontak,
}));

import { useDaftarSesi } from './useDaftarSesi';
import { langganTabel, setelUlangPusatRealtime } from '@/lib/realtime/pusat';
import { setelUlangKanal } from '@/lib/realtime/kanal';

const sesi = (o: Partial<RingkasSesi> = {}): RingkasSesi => ({
  id: 's1', status: 'eskalasi', layanan_id: 'l1', pengunjung_id: null, ditangani_oleh: null,
  created_at: '2026-10-14T01:00:00Z', updated_at: '2026-10-14T01:00:00Z',
  last_pesan: 'halo', last_pesan_at: '2026-10-14T01:00:01Z', last_pengirim: 'pengunjung', unread: true, ...o,
});
const tahap = (o: Partial<TahapChat> = {}): TahapChat => ({
  id: 'pn-1', chat_sesi_id: 's1', peran_tahap: 'fo', status: 'menunggu', layanan_id: null, penangan_id: null, ...o,
});
const toast = vi.fn();
const pasang = () => renderHook(() => useDaftarSesi({ toast }));

beforeEach(() => {
  vi.clearAllMocks();
  setelUlangPusatRealtime();
  setelUlangKanal();
  m.statusPer = {};
  m.pengikat.length = 0;
  m.kanal.length = 0;
  m.status = null;
  m.statusAwal = 'SUBSCRIBED';
  m.profil.mockResolvedValue({ data: { id: 'pet-1', role: 'front_office', layanan_id: null }, error: null });
  m.daftar.mockResolvedValue({ data: { sesi: [sesi()], tahap: [tahap()] }, error: null });
  m.kontak.mockResolvedValue({ data: 'Ani', error: null });
  window.history.replaceState({}, '', '/admin/chat');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDaftarSesi: muat awal dan Realtime', () => {
  it('profil dibaca dulu, lalu daftar dimuat saat SUBSCRIBED; tahap dipetakan per sesi', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.dimuat).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.sesi).toEqual([sesi()]);
    expect(result.current.tahapMap).toEqual({ s1: tahap() });
    expect(result.current.petugasId).toBe('pet-1');
    expect(result.current.role).toBe('front_office');
    expect(result.current.rt).toBe('ok');
    expect(m.daftar).toHaveBeenCalledWith(expect.anything(), { sertakanSelesai: false });
    expect(m.profil.mock.invocationCallOrder[0]).toBeLessThan(m.daftar.mock.invocationCallOrder[0]);
  });

  it('satu channel per tabel: chat_sesi (*) lewat pusat, chat_pesan (INSERT) di `chat-admin`; keduanya dilepas saat unmount', async () => {
    const { result, unmount } = pasang();
    await waitFor(() => expect(result.current.dimuat).toBe(true));
    expect(m.kanal).toEqual(['staf-tabel-chat_sesi', 'chat-admin']);
    expect(m.pengikat.map((p) => `${p.filter.event}:${p.filter.table}`)).toEqual(['*:chat_sesi', 'INSERT:chat_pesan']);
    unmount();
    expect(m.dilepas).toHaveBeenCalledTimes(2);
  });

  it('sidebar sudah berlangganan chat_sesi: tidak ada channel chat_sesi kedua, rt langsung ok', async () => {
    const hentiSidebar = langganTabel('chat_sesi', () => {});
    const { result, unmount } = pasang();
    await waitFor(() => expect(result.current.dimuat).toBe(true));
    expect(m.kanal).toEqual(['staf-tabel-chat_sesi', 'chat-admin']);
    expect(result.current.rt).toBe('ok');
    unmount();
    expect(m.dilepas).toHaveBeenCalledTimes(1); // channel bersama tetap dipakai sidebar
    hentiSidebar();
    expect(m.dilepas).toHaveBeenCalledTimes(2);
  });

  it('rt gabungan: chat_sesi putus = down; tersambung lagi = ok + catch-up daftar', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.rt).toBe('ok'));
    await act(async () => {
      m.statusPer['staf-tabel-chat_sesi']('CHANNEL_ERROR');
    });
    expect(result.current.rt).toBe('down');
    const sebelum = m.daftar.mock.calls.length;
    await act(async () => {
      m.statusPer['staf-tabel-chat_sesi']('SUBSCRIBED');
    });
    expect(result.current.rt).toBe('ok');
    await waitFor(() => expect(m.daftar.mock.calls.length).toBeGreaterThan(sebelum));
  });

  it('`chat-admin` CLOSED: rt down, dibuka ulang ber-backoff (satu channel), SUBSCRIBED = ok + catch-up', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.rt).toBe('ok'));
    vi.useFakeTimers();
    const acak = vi.spyOn(Math, 'random').mockReturnValue(0);
    m.statusAwal = 'CHANNEL_ERROR'; // channel baru belum tersambung saat subscribe
    await act(async () => {
      m.statusPer['chat-admin']('CLOSED');
    });
    expect(result.current.rt).toBe('down');
    expect(m.dilepas).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(m.kanal.filter((k) => k === 'chat-admin')).toHaveLength(2);
    expect(m.kanal.filter((k) => k === 'staf-tabel-chat_sesi')).toHaveLength(1);
    expect(m.pengikat.at(-1)?.filter).toMatchObject({ event: 'INSERT', table: 'chat_pesan' });
    const sebelum = m.daftar.mock.calls.length;
    await act(async () => {
      m.statusPer['chat-admin']('SUBSCRIBED');
    });
    expect(result.current.rt).toBe('ok');
    expect(m.daftar.mock.calls.length).toBeGreaterThan(sebelum);
    acak.mockRestore();
  });

  it('event chat_sesi memuat ulang daftar', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.dimuat).toBe(true));
    await waitFor(() => expect(m.daftar).toHaveBeenCalled());
    const sebelum = m.daftar.mock.calls.length;
    await act(async () => {
      m.pengikat[0].fn();
    });
    await waitFor(() => expect(m.daftar.mock.calls.length).toBeGreaterThan(sebelum));
  });

  it('INSERT chat_pesan dibagikan ke pendengar (bukan hanya daftar) dan berhenti setelah dilepas', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.dimuat).toBe(true));
    const terima = vi.fn();
    let lepas = () => {};
    act(() => {
      lepas = result.current.langganPesanBaru(terima);
    });
    const baru = { id: 'm1', sesi_id: 's1', pengirim: 'pengunjung', isi: 'halo', created_at: '2026-10-14T01:00:02Z' };
    await act(async () => {
      m.pengikat[1].fn({ new: baru });
    });
    expect(terima).toHaveBeenCalledExactlyOnceWith(baru);
    lepas();
    await act(async () => {
      m.pengikat[1].fn({ new: baru });
    });
    expect(terima).toHaveBeenCalledTimes(1);
  });

  it('Realtime tak tersambung: daftar tetap dimuat sekali setelah 3 dtk', async () => {
    vi.useFakeTimers();
    m.statusAwal = 'CHANNEL_ERROR';
    const { result } = pasang();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.rt).toBe('down');
    expect(m.daftar).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(m.daftar).toHaveBeenCalled();
  });
});

describe('useDaftarSesi: lingkup dan tautan', () => {
  it('petugas hanya melihat Layanannya sendiri', async () => {
    m.profil.mockResolvedValue({ data: { id: 'pet-1', role: 'petugas', layanan_id: 'l1' }, error: null });
    m.daftar.mockResolvedValue({ data: { sesi: [sesi({ id: 'a', layanan_id: 'l1' }), sesi({ id: 'b', layanan_id: 'l9' })], tahap: [] }, error: null });
    const { result } = pasang();
    await waitFor(() => expect(result.current.dimuat).toBe(true));
    expect(result.current.sesi.map((s) => s.id)).toEqual(['a']);
  });

  it('?sesi= membuka sesi itu begitu terlihat di daftar dan memuat kontaknya sekali', async () => {
    window.history.replaceState({}, '', '/admin/chat?sesi=s1');
    const { result } = pasang();
    await waitFor(() => expect(result.current.selectedId).toBe('s1'));
    expect(result.current.selectedSession?.id).toBe('s1');
    await waitFor(() => expect(result.current.kontak).toEqual({ s1: 'Ani' }));
    // Muat ulang berikutnya tidak membuka lagi.
    await act(async () => {
      await result.current.muatUlang();
    });
    expect(m.kontak).toHaveBeenCalledTimes(1);
  });

  it('?sesi= yang tidak ada di daftar tidak memilih apa pun', async () => {
    window.history.replaceState({}, '', '/admin/chat?sesi=tidak-ada');
    const { result } = pasang();
    await waitFor(() => expect(result.current.dimuat).toBe(true));
    expect(result.current.selectedId).toBeNull();
  });
});

describe('useDaftarSesi: galat', () => {
  it('galat database: pesan + toast, daftar lama tidak ditimpa', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.sesi).toHaveLength(1));
    m.daftar.mockResolvedValue({ data: null, error: { jenis: 'database', pesan: 'x', asli: null } });
    await act(async () => {
      await result.current.muatUlang();
    });
    expect(result.current.galat).toBe('Gagal memuat sesi chat');
    expect(toast).toHaveBeenCalledWith('Gagal memuat sesi chat', 'error');
    expect(result.current.dimuat).toBe(true);
  });

  it('galat jaringan: pesan gangguan tanpa toast; muat berhasil menghapus galat', async () => {
    m.daftar.mockResolvedValueOnce({ data: null, error: { jenis: 'jaringan', pesan: 'putus', asli: null } });
    const { result } = pasang();
    await waitFor(() => expect(result.current.galat).toBe('Gangguan jaringan. Sesi chat tidak dapat dimuat.'));
    expect(toast).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.muatUlang();
    });
    expect(result.current.galat).toBe('');
    expect(result.current.sesi).toHaveLength(1);
  });

  it('tahap gagal dimuat: sesi tetap tampil, penanganGalat menyala, toast sekali', async () => {
    m.daftar.mockResolvedValue({ data: { sesi: [sesi()], tahap: null }, error: null });
    const { result } = pasang();
    await waitFor(() => expect(result.current.penanganGalat).toBe(true));
    expect(result.current.sesi).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith('Gagal memuat status penanganan chat', 'error');
  });

  it('profil gagal dibaca (jaringan): galat inisialisasi, loading selesai, tanpa channel', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    m.profil.mockResolvedValue({ data: null, error: { jenis: 'jaringan', pesan: 'putus', asli: new Error('putus') } });
    const { result } = pasang();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.galat).toBe('Gagal menginisialisasi chat. Coba muat daftar kembali.');
    expect(toast).toHaveBeenCalledWith('Gagal menginisialisasi chat', 'error');
    expect(m.kanal).toEqual([]);
    spy.mockRestore();
  });

  it('respons lama yang selesai belakangan tidak menimpa respons baru', async () => {
    let lepasLama!: (v: unknown) => void;
    const { result } = pasang();
    await waitFor(() => expect(result.current.dimuat).toBe(true));
    m.daftar.mockReturnValueOnce(new Promise((r) => (lepasLama = r)));
    m.daftar.mockResolvedValueOnce({ data: { sesi: [sesi({ id: 'baru' })], tahap: [] }, error: null });
    let p1!: Promise<void>;
    act(() => {
      p1 = result.current.muatUlang();
    });
    await act(async () => {
      await result.current.muatUlang();
    });
    await act(async () => {
      lepasLama({ data: { sesi: [sesi({ id: 'lama' })], tahap: [] }, error: null });
      await p1;
    });
    expect(result.current.sesi.map((s) => s.id)).toEqual(['baru']);
  });
});

describe('useDaftarSesi: pilihan sesi dan filter', () => {
  it('pilih: sesi terpilih + snapshot, dianggap terbaca, kontak dimuat sekali; kembali menandai terbaca', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.sesi).toHaveLength(1));
    const s = result.current.sesi[0];
    act(() => result.current.pilih(s));
    expect(result.current.selectedId).toBe('s1');
    expect(result.current.dibuka).toEqual({ s1: s.last_pesan_at });
    await waitFor(() => expect(result.current.kontak).toEqual({ s1: 'Ani' }));
    act(() => result.current.pilih(s));
    expect(m.kontak).toHaveBeenCalledTimes(1);
    act(() => result.current.kembali());
    expect(result.current.selectedId).toBeNull();
  });

  it('berpindah sesi menandai sesi yang ditinggalkan terbaca', async () => {
    m.daftar.mockResolvedValue({ data: { sesi: [sesi({ id: 'a', last_pesan_at: 't-a' }), sesi({ id: 'b', last_pesan_at: 't-b' })], tahap: [] }, error: null });
    const { result } = pasang();
    await waitFor(() => expect(result.current.sesi).toHaveLength(2));
    act(() => result.current.pilih(result.current.sesi[0]));
    act(() => result.current.pilih(result.current.sesi[1]));
    expect(result.current.dibuka).toEqual({ a: 't-a', b: 't-b' });
  });

  it('sesi terpilih yang hilang dari daftar tetap tampil lewat snapshot', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.sesi).toHaveLength(1));
    act(() => result.current.pilih(result.current.sesi[0]));
    m.daftar.mockResolvedValue({ data: { sesi: [], tahap: [] }, error: null });
    await act(async () => {
      await result.current.muatUlang();
    });
    expect(result.current.sesi).toEqual([]);
    expect(result.current.selectedSession?.id).toBe('s1');
  });

  it('mengganti filter "selesai" memuat ulang dengan sertakanSelesai; render awal tidak', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.dimuat).toBe(true));
    expect(m.daftar.mock.calls.every((c) => c[1].sertakanSelesai === false)).toBe(true);
    act(() => result.current.setTampilSelesai(true));
    await waitFor(() => expect(m.daftar).toHaveBeenLastCalledWith(expect.anything(), { sertakanSelesai: true }));
  });
});
