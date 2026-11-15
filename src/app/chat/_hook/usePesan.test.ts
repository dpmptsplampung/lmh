// @vitest-environment jsdom
// Kontrak usePesan (tugas 6.3): riwayat awal dengan penjaga respons basi (C2-07), halaman lebih lama + Coba lagi (C2-02),
// sinkronisasi yang membuang respons generasi lama (R4), dan channel Realtime `chat-sesi-<id>`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

type Pendengar = (payload: { new: Record<string, unknown> }) => void;
const rt = vi.hoisted(() => ({
  topik: [] as string[],
  pendengar: new Map<string, Pendengar>(),
  status: new Map<string, (s: string) => void>(),
  dilepas: 0,
}));
const data = vi.hoisted(() => ({ riwayat: vi.fn(), sinkron: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: (topik: string) => {
      rt.topik.push(topik);
      const ch: Record<string, unknown> = {};
      ch.on = (_e: string, f: { table: string }, cb: Pendengar) => {
        rt.pendengar.set(f.table, cb);
        return ch;
      };
      ch.subscribe = (cb?: (s: string) => void) => {
        if (cb) rt.status.set(topik, cb);
        return ch;
      };
      return ch;
    },
    removeChannel: () => {
      rt.dilepas++;
    },
  }),
}));
vi.mock('@/lib/data/chat-pengunjung', async (asli) => ({
  ...(await asli<typeof import('@/lib/data/chat-pengunjung')>()),
  muatRiwayatChat: data.riwayat,
  sinkronPesanChat: data.sinkron,
}));

import type { PercakapanRingkas } from '@/lib/chat/percakapan';
import type { ChatMsg } from '../merge';
import { useMesinChat } from './useMesinChat';
import { usePesan } from './usePesan';
import { setelUlangKanal } from '@/lib/realtime/kanal';

const m = (id: string, created_at: string, over: Partial<ChatMsg> = {}): ChatMsg => ({ id, pengirim: 'bot', isi: id, created_at, ...over });
const percakapan = (over: Partial<PercakapanRingkas> = {}) =>
  ({ layananId: 'L', sesiTerakhirId: 's-A', sesiTerbukaId: 's-A', statusTerakhir: 'bot', ...over }) as PercakapanRingkas;
const tunda = <T,>() => {
  let lepas!: (v: T) => void;
  const janji = new Promise<T>((r) => (lepas = r));
  return { janji, lepas };
};

function pasang() {
  return renderHook(() => {
    const mesin = useMesinChat();
    const pesan = usePesan(mesin);
    return { mesin, pesan };
  });
}
const buka = (r: ReturnType<typeof pasang>, p: PercakapanRingkas) =>
  act(() => {
    r.result.current.mesin.kirim({ jenis: 'buka', percakapan: p });
    void r.result.current.pesan.muatRiwayatAwal(p);
  });

beforeEach(() => {
  setelUlangKanal();
  rt.topik.length = 0;
  rt.pendengar.clear();
  rt.status.clear();
  rt.dilepas = 0;
  data.riwayat.mockReset().mockResolvedValue({ data: { messages: [], adaLebih: false, status: null }, error: null });
  data.sinkron.mockReset().mockResolvedValue({ data: { messages: null, status: null }, error: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('usePesan: riwayat', () => {
  it('riwayat awal dari sesi terakhir; status diterapkan hanya bila ada sesi terbuka', async () => {
    data.riwayat.mockResolvedValue({ data: { messages: [m('m1', '2026-10-30T01:00:00Z')], adaLebih: true, status: 'eskalasi' }, error: null });
    const r = pasang();
    buka(r, percakapan());
    await waitFor(() => expect(r.result.current.pesan.pesan.map((x) => x.id)).toEqual(['m1']));
    expect(data.riwayat.mock.calls[0][0]).toMatchObject({ sesiId: 's-A' });
    expect(r.result.current.pesan.adaLebih).toBe(true);
    expect(r.result.current.mesin.keadaan.status).toBe('eskalasi');

    buka(r, percakapan({ sesiTerbukaId: null, statusTerakhir: 'selesai' }));
    await waitFor(() => expect(r.result.current.pesan.memuatRiwayat).toBe(false));
    expect(r.result.current.mesin.keadaan.status).toBe('selesai');
  });

  it('C2-07: respons riwayat percakapan yang sudah ditinggalkan dibuang', async () => {
    const lambat = tunda<unknown>();
    data.riwayat.mockReturnValueOnce(lambat.janji);
    const r = pasang();
    buka(r, percakapan());
    const signal = data.riwayat.mock.calls[0][0].signal as AbortSignal;
    act(() => r.result.current.pesan.tinggalkan());
    expect(signal.aborted).toBe(true);
    await act(async () => lambat.lepas({ data: { messages: [m('basi', '2026-10-30T01:00:00Z')], adaLebih: true, status: 'aktif' }, error: null }));
    expect(r.result.current.pesan.pesan).toEqual([]);
    expect(r.result.current.pesan.memuatRiwayat).toBe(false);
    expect(r.result.current.mesin.keadaan.status).toBe('bot');
  });

  it('C2-02: galat riwayat awal dan halaman lama tampil; Coba lagi mengulang yang benar', async () => {
    data.riwayat.mockResolvedValueOnce({ data: null, error: { jenis: 'http', pesan: '', asli: null } });
    const r = pasang();
    buka(r, percakapan({ sesiTerbukaId: null }));
    await waitFor(() => expect(r.result.current.pesan.galatRiwayat).toBe('awal'));
    data.riwayat.mockResolvedValueOnce({ data: { messages: [m('m2', '2026-10-30T01:00:00Z')], adaLebih: true, status: null }, error: null });
    act(() => r.result.current.pesan.cobaLagiRiwayat('s-A'));
    await waitFor(() => expect(r.result.current.pesan.pesan.map((x) => x.id)).toEqual(['m2']));
    expect(r.result.current.pesan.galatRiwayat).toBeNull();

    data.riwayat.mockResolvedValueOnce({ data: null, error: { jenis: 'http', pesan: '', asli: null } });
    await act(() => r.result.current.pesan.muatLebihLama('s-A'));
    expect(r.result.current.pesan.galatRiwayat).toBe('lama');
    // Tanpa sesi terbuka: jangkar = sesi terakhir percakapan, sebelum = pesan server tertua.
    expect(data.riwayat.mock.calls[2][0]).toMatchObject({ sesiId: 's-A', sebelum: '2026-10-30T01:00:00Z' });
    data.riwayat.mockResolvedValueOnce({ data: { messages: [m('m0', '2026-08-01T01:00:00Z')], adaLebih: false, status: null }, error: null });
    act(() => r.result.current.pesan.cobaLagiRiwayat('s-A'));
    await waitFor(() => expect(r.result.current.pesan.pesan.map((x) => x.id)).toEqual(['m0', 'm2']));
    expect(r.result.current.pesan.adaLebih).toBe(false);
  });
});

describe('usePesan: sinkronisasi dan Realtime', () => {
  it('channel per sesi: INSERT sesi aktif digabung, sesi lain dibuang; UPDATE mengubah status; dilepas saat sesi berganti', async () => {
    const r = pasang();
    buka(r, percakapan());
    await waitFor(() => expect(rt.topik).toEqual(['chat-sesi-s-A']));
    act(() => rt.pendengar.get('chat_pesan')!({ new: { ...m('x', '2026-10-30T03:00:00Z'), sesi_id: 's-lain' } }));
    act(() => rt.pendengar.get('chat_pesan')!({ new: { ...m('y', '2026-10-30T03:00:00Z'), sesi_id: 's-A' } }));
    expect(r.result.current.pesan.pesan.map((x) => x.id)).toEqual(['y']);
    act(() => rt.pendengar.get('chat_sesi')!({ new: { id: 's-A', status: 'aktif' } }));
    expect(r.result.current.mesin.keadaan.status).toBe('aktif');

    buka(r, percakapan({ layananId: 'L2', sesiTerakhirId: 's-B', sesiTerbukaId: 's-B' }));
    await waitFor(() => expect(rt.topik).toEqual(['chat-sesi-s-A', 'chat-sesi-s-B']));
    expect(rt.dilepas).toBe(1);
  });

  it('R4: respons sinkron yang tiba setelah percakapan lain dibuka dibuang', async () => {
    const lambat = tunda<unknown>();
    data.sinkron.mockReturnValueOnce(lambat.janji);
    const r = pasang();
    buka(r, percakapan());
    await waitFor(() => expect(data.sinkron).toHaveBeenCalledWith('s-A'));
    buka(r, percakapan({ layananId: 'L2', sesiTerakhirId: 's-B', sesiTerbukaId: 's-B' }));
    await act(async () => lambat.lepas({ data: { messages: [m('mA', '2026-10-30T01:00:00Z')], status: 'eskalasi' }, error: null }));
    expect(r.result.current.pesan.pesan.find((x) => x.id === 'mA')).toBeUndefined();
    expect(r.result.current.mesin.keadaan.status).toBe('bot');
  });

  it('sinkron menggabungkan pesan dan status sesi aktif', async () => {
    data.sinkron.mockResolvedValue({ data: { messages: [m('s1', '2026-10-30T01:00:00Z')], status: 'aktif' }, error: null });
    const r = pasang();
    buka(r, percakapan());
    await waitFor(() => expect(r.result.current.pesan.pesan.map((x) => x.id)).toContain('s1'));
    expect(r.result.current.mesin.keadaan.status).toBe('aktif');
  });

  it('operasi utas: tambah, tandai, buang sementara, ganti', () => {
    const r = pasang();
    act(() => {
      r.result.current.pesan.tambah(m('a', '1', { local: 'pending' }));
      r.result.current.pesan.tambah(m('b', '2', { local: 'notice', transient: true }));
    });
    act(() => r.result.current.pesan.tandai('a', 'failed'));
    act(() => r.result.current.pesan.buangSementara());
    expect(r.result.current.pesan.pesan).toEqual([m('a', '1', { local: 'failed' })]);
    act(() => r.result.current.pesan.ganti([]));
    expect(r.result.current.pesan.pesan).toEqual([]);
  });
});

describe('usePesan: Realtime tahan putus dan polling cadangan', () => {
  const maju = (ms: number) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  const status = (topik: string, s: string) => act(async () => {
    rt.status.get(topik)?.(s);
  });

  it('CLOSED: channel sesi dibuka ulang ber-backoff (satu channel aktif), SUBSCRIBED = catch-up sinkron', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const r = pasang();
    buka(r, percakapan());
    await maju(0);
    expect(rt.topik).toEqual(['chat-sesi-s-A']);
    await status('chat-sesi-s-A', 'SUBSCRIBED');
    await status('chat-sesi-s-A', 'CLOSED');
    expect(rt.dilepas).toBe(1);
    await maju(1_999);
    expect(rt.topik).toEqual(['chat-sesi-s-A']);
    await maju(1);
    expect(rt.topik).toEqual(['chat-sesi-s-A', 'chat-sesi-s-A']);
    const sebelum = data.sinkron.mock.calls.length;
    await status('chat-sesi-s-A', 'SUBSCRIBED');
    expect(data.sinkron.mock.calls.length).toBe(sebelum + 1);
    r.unmount();
    expect(rt.dilepas).toBe(2);
    await maju(300_000);
    expect(rt.topik).toHaveLength(2); // tidak dibuka lagi setelah unmount
  });

  it('tersambung: poll tiap 120 dtk (bukan 30); tidak tersambung: tiap 5 dtk', async () => {
    vi.useFakeTimers();
    const r = pasang();
    buka(r, percakapan());
    await maju(0);
    await status('chat-sesi-s-A', 'SUBSCRIBED');
    const awal = data.sinkron.mock.calls.length; // muat awal + catch-up
    await maju(119_000);
    expect(data.sinkron.mock.calls.length).toBe(awal);
    await maju(1_000);
    expect(data.sinkron.mock.calls.length).toBe(awal + 1);

    await status('chat-sesi-s-A', 'CHANNEL_ERROR');
    await maju(0); // putus: satu sinkron segera (perilaku lama `rt !== 'ok'`)
    const putus = data.sinkron.mock.calls.length;
    await maju(5_000);
    expect(data.sinkron.mock.calls.length).toBe(putus + 1);
    await maju(5_000);
    expect(data.sinkron.mock.calls.length).toBe(putus + 2);
  });

  it('ganti sesi: status sesi lama tidak terbawa; SUBSCRIBED channel baru memicu catch-up sesi baru', async () => {
    vi.useFakeTimers();
    const r = pasang();
    buka(r, percakapan());
    await maju(0);
    await status('chat-sesi-s-A', 'SUBSCRIBED');
    buka(r, percakapan({ layananId: 'L2', sesiTerakhirId: 's-B', sesiTerbukaId: 's-B' }));
    await maju(0);
    expect(rt.topik).toEqual(['chat-sesi-s-A', 'chat-sesi-s-B']);
    expect(data.sinkron).toHaveBeenLastCalledWith('s-B'); // muat awal: channel baru belum tersambung
    const sebelum = data.sinkron.mock.calls.length;
    await status('chat-sesi-s-B', 'SUBSCRIBED');
    expect(data.sinkron.mock.calls.length).toBe(sebelum + 1);
    expect(data.sinkron).toHaveBeenLastCalledWith('s-B');
  });
});
