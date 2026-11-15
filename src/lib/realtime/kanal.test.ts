// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Klien Supabase tiruan: menghitung channel()/removeChannel(), menyimpan callback status per channel. removeChannel
// dapat ditahan (janji yang diselesaikan test) untuk meniru leave async.
interface ChTiruan {
  topik: string;
  binding: string[];
  status: ((s: string) => void) | null;
  langganan: number;
  dilepas: boolean;
}
const k = vi.hoisted(() => ({
  channels: [] as ChTiruan[],
  tahanLepas: false,
  selesaikanLepas: [] as Array<() => void>,
  gagalChannel: false,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: (topik: string) => {
      if (k.gagalChannel) throw new Error('cannot add `postgres_changes` callbacks after `subscribe()`');
      const ch: ChTiruan = { topik, binding: [], status: null, langganan: 0, dilepas: false };
      k.channels.push(ch);
      const rantai = {
        on: (_jenis: string, filter: { table: string }) => {
          ch.binding.push(filter.table);
          return rantai;
        },
        subscribe: (cb?: (s: string) => void) => {
          ch.langganan++;
          ch.status = cb ?? null;
          return rantai;
        },
        _ch: ch,
      };
      return rantai;
    },
    removeChannel: (r: { _ch: ChTiruan }) => {
      r._ch.dilepas = true;
      if (!k.tahanLepas) return Promise.resolve('ok');
      return new Promise<string>((res) => k.selesaikanLepas.push(() => res('ok')));
    },
  }),
}));

import { bukaKanal, setelUlangKanal, type Kanal } from './kanal';

const pasang = (ch: Kanal) =>
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_pesan' }, () => {});
const aktif = () => k.channels.filter((c) => !c.dilepas);
const terakhir = () => k.channels[k.channels.length - 1];
const setHidden = (h: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  setelUlangKanal();
  k.channels.length = 0;
  k.tahanLepas = false;
  k.selesaikanLepas.length = 0;
  k.gagalChannel = false;
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0); // tanpa jitter: jeda pasti 2, 4, 8, ... dtk
});
afterEach(() => {
  setHidden(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('bukaKanal', () => {
  it('membuka satu channel dengan binding dari `pasang` dan melaporkan status; berhenti melepasnya', () => {
    const status = vi.fn();
    const henti = bukaKanal({ topik: 'chat-admin', pasang, saatStatus: status });
    expect(k.channels).toHaveLength(1);
    expect(k.channels[0]).toMatchObject({ topik: 'chat-admin', binding: ['chat_pesan'], langganan: 1 });
    k.channels[0].status?.('SUBSCRIBED');
    expect(status).toHaveBeenCalledWith('SUBSCRIBED');
    henti();
    expect(k.channels[0].dilepas).toBe(true);
    henti(); // idempoten
    expect(vi.getTimerCount()).toBe(0);
  });

  it('CLOSED: channel lama dilepas lalu dibuka ulang dengan backoff 2 dtk, 4 dtk', async () => {
    const status = vi.fn();
    const henti = bukaKanal({ topik: 'chat-sesi-a', pasang, saatStatus: status });
    k.channels[0].status?.('CLOSED');
    expect(status).toHaveBeenLastCalledWith('CLOSED');
    expect(k.channels[0].dilepas).toBe(true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(k.channels).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(k.channels).toHaveLength(2);
    expect(aktif()).toEqual([k.channels[1]]);
    expect(k.channels[1]).toMatchObject({ topik: 'chat-sesi-a', binding: ['chat_pesan'], langganan: 1 });

    k.channels[1].status?.('CLOSED');
    await vi.advanceTimersByTimeAsync(3_999);
    expect(k.channels).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(k.channels).toHaveLength(3);
    expect(aktif()).toHaveLength(1);

    terakhir().status?.('SUBSCRIBED');
    expect(status).toHaveBeenLastCalledWith('SUBSCRIBED');
    henti();
    expect(aktif()).toHaveLength(0);
  });

  it('tersambung stabil >= 30 dtk lalu CLOSED: backoff kembali ke 2 dtk', async () => {
    const henti = bukaKanal({ topik: 't', pasang, saatStatus: () => {} });
    k.channels[0].status?.('CLOSED');
    await vi.advanceTimersByTimeAsync(2_000);
    k.channels[1].status?.('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(30_000);
    k.channels[1].status?.('CLOSED');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(k.channels).toHaveLength(3);
    henti();
  });

  it('CHANNEL_ERROR / TIMED_OUT: tidak membuka channel kedua (rejoin oleh realtime-js)', async () => {
    const status = vi.fn();
    const henti = bukaKanal({ topik: 't', pasang, saatStatus: status });
    k.channels[0].status?.('CHANNEL_ERROR');
    k.channels[0].status?.('TIMED_OUT');
    await vi.advanceTimersByTimeAsync(300_000);
    expect(k.channels).toHaveLength(1);
    expect(k.channels[0].dilepas).toBe(false);
    expect(status.mock.calls.map((c) => c[0])).toEqual(['CHANNEL_ERROR', 'TIMED_OUT']);
    k.channels[0].status?.('SUBSCRIBED'); // rejoin phoenix berhasil
    expect(status).toHaveBeenLastCalledWith('SUBSCRIBED');
    henti();
  });

  it('CLOSED ganda dari channel yang sama hanya menjadwalkan satu buka ulang', async () => {
    const henti = bukaKanal({ topik: 't', pasang, saatStatus: () => {} });
    const cb = k.channels[0].status!;
    cb('CLOSED');
    cb('CLOSED');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(k.channels).toHaveLength(2);
    expect(aktif()).toHaveLength(1);
    henti();
  });

  it('jadwal jatuh saat tab tersembunyi: menunggu tab terlihat, lalu tepat satu channel', async () => {
    const henti = bukaKanal({ topik: 't', pasang, saatStatus: () => {} });
    k.channels[0].status?.('CLOSED');
    setHidden(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(k.channels).toHaveLength(1);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(k.channels).toHaveLength(2);
    setHidden(true);
    setHidden(false); // visibilitychange berikutnya tidak membuka channel lagi
    await vi.advanceTimersByTimeAsync(0);
    expect(k.channels).toHaveLength(2);
    henti();
  });

  it('berhenti saat menunggu buka ulang (timer atau tab tersembunyi): tidak ada channel baru, tidak ada timer', async () => {
    const status = vi.fn();
    const henti = bukaKanal({ topik: 't', pasang, saatStatus: status });
    k.channels[0].status?.('CLOSED');
    henti();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(k.channels).toHaveLength(1);

    const henti2 = bukaKanal({ topik: 'u', pasang, saatStatus: () => {} });
    terakhir().status?.('CLOSED');
    setHidden(true);
    await vi.advanceTimersByTimeAsync(2_000);
    henti2();
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(k.channels.filter((c) => c.topik === 'u')).toHaveLength(1);
  });

  it('status terlambat setelah berhenti diabaikan dan tidak memicu buka ulang', async () => {
    const status = vi.fn();
    const henti = bukaKanal({ topik: 't', pasang, saatStatus: status });
    const cb = k.channels[0].status!;
    henti();
    cb('CLOSED'); // CLOSED dari pelepasan sendiri
    cb('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(300_000);
    expect(status).not.toHaveBeenCalled();
    expect(k.channels).toHaveLength(1);
  });

  it('pasang ulang dengan topik sama menunggu pelepasan channel lama selesai', async () => {
    k.tahanLepas = true;
    const henti = bukaKanal({ topik: 'chat-sesi-a', pasang, saatStatus: () => {} });
    henti();
    const henti2 = bukaKanal({ topik: 'chat-sesi-a', pasang, saatStatus: () => {} });
    expect(k.channels).toHaveLength(1); // channel lama masih di registri realtime-js
    k.selesaikanLepas.forEach((f) => f());
    await vi.advanceTimersByTimeAsync(0);
    expect(k.channels).toHaveLength(2);
    expect(aktif()).toEqual([k.channels[1]]);
    henti2();
  });

  it('berhenti sebelum pelepasan lama selesai: tidak membuka apa pun', async () => {
    k.tahanLepas = true;
    bukaKanal({ topik: 't', pasang, saatStatus: () => {} })();
    const henti2 = bukaKanal({ topik: 't', pasang, saatStatus: () => {} });
    henti2();
    k.selesaikanLepas.forEach((f) => f());
    await vi.advanceTimersByTimeAsync(0);
    expect(k.channels).toHaveLength(1);
  });

  it('channel() melempar: dicoba lagi dengan backoff, tidak membuka ganda', async () => {
    k.gagalChannel = true;
    const henti = bukaKanal({ topik: 't', pasang, saatStatus: () => {} });
    expect(k.channels).toHaveLength(0);
    k.gagalChannel = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(k.channels).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(k.channels).toHaveLength(1);
    henti();
  });
});
