// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, createElement, useEffect, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';

// Klien Supabase tiruan: menghitung channel()/removeChannel(), menyimpan binding, callback status, dan
// pemicu event per channel. removeChannel dapat ditahan (janji yang diselesaikan test) untuk meniru leave async.
interface ChTiruan {
  topik: string;
  binding: Array<{ jenis: string; filter: unknown; cb: () => void }>;
  status: ((s: string) => void) | null;
  dilepas: boolean;
}
const k = vi.hoisted(() => ({
  channels: [] as ChTiruan[],
  dilepas: [] as ChTiruan[],
  tahanLepas: false,
  selesaikanLepas: [] as Array<() => void>,
  gagalBuat: false,
  gagalChannel: false,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    if (k.gagalBuat) throw new Error('env belum ada');
    return {
      channel: (topik: string) => {
        if (k.gagalChannel) throw new Error('cannot add `postgres_changes` callbacks after `subscribe()`');
        const ch: ChTiruan = { topik, binding: [], status: null, dilepas: false };
        k.channels.push(ch);
        const rantai = {
          on: (jenis: string, filter: unknown, cb: () => void) => {
            ch.binding.push({ jenis, filter, cb });
            return rantai;
          },
          subscribe: (cb?: (s: string) => void) => {
            ch.status = cb ?? null;
            return rantai;
          },
          _ch: ch,
        };
        return rantai;
      },
      removeChannel: (r: { _ch: ChTiruan }) => {
        r._ch.dilepas = true;
        k.dilepas.push(r._ch);
        if (!k.tahanLepas) return Promise.resolve('ok');
        return new Promise<string>((res) => k.selesaikanLepas.push(() => res('ok')));
      },
    };
  },
}));

import { langganStatus, langganTabel, setelUlangPusatRealtime, statusTabel } from './pusat';

const kanal = (topik: string) => k.channels.filter((c) => c.topik === topik);
const aktif = () => k.channels.filter((c) => !c.dilepas);
const ubah = (c: ChTiruan) => c.binding.forEach((b) => b.cb());
const tunggu = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  setelUlangPusatRealtime();
  k.channels.length = 0;
  k.dilepas.length = 0;
  k.tahanLepas = false;
  k.selesaikanLepas.length = 0;
  k.gagalBuat = false;
  k.gagalChannel = false;
});

describe('langganTabel: satu channel per tabel (refcount)', () => {
  it('sidebar (3 tabel) + admin/antrian (tiket_antrean) = satu channel tiket_antrean', () => {
    const sidebar = vi.fn();
    const antrian = vi.fn();
    const henti = ['penanganan', 'chat_sesi', 'tiket_antrean'].map((t) => langganTabel(t, sidebar));
    const hentiAntrian = langganTabel('tiket_antrean', antrian);

    expect(k.channels.map((c) => c.topik).sort()).toEqual([
      'staf-tabel-chat_sesi', 'staf-tabel-penanganan', 'staf-tabel-tiket_antrean',
    ]);
    expect(kanal('staf-tabel-tiket_antrean')).toHaveLength(1);
    const tiket = kanal('staf-tabel-tiket_antrean')[0];
    expect(tiket.binding).toEqual([
      { jenis: 'postgres_changes', filter: { event: '*', schema: 'public', table: 'tiket_antrean' }, cb: expect.any(Function) },
    ]);

    // Satu perubahan diteruskan ke semua pendengar tabel itu, tidak ke tabel lain.
    ubah(tiket);
    expect(sidebar).toHaveBeenCalledTimes(1);
    expect(antrian).toHaveBeenCalledTimes(1);
    ubah(kanal('staf-tabel-penanganan')[0]);
    expect(sidebar).toHaveBeenCalledTimes(2);
    expect(antrian).toHaveBeenCalledTimes(1);

    // Halaman pergi: channel tetap dipegang sidebar.
    hentiAntrian();
    expect(k.dilepas).toHaveLength(0);
    ubah(tiket);
    expect(antrian).toHaveBeenCalledTimes(1);

    // Pendengar terakhir pergi: semua channel dilepas, tidak ada yang bocor.
    henti.forEach((h) => h());
    expect(k.dilepas).toHaveLength(3);
    expect(aktif()).toHaveLength(0);
  });

  it('fungsi berhenti idempoten: dipanggil dua kali tidak mengurangi refcount pendengar lain', () => {
    const a = langganTabel('penanganan', vi.fn());
    const b = vi.fn();
    langganTabel('penanganan', b);
    a();
    a();
    expect(k.dilepas).toHaveLength(0);
    ubah(k.channels[0]);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('fungsi yang sama didaftarkan dua kali dihitung dua langganan', () => {
    const fn = vi.fn();
    const a = langganTabel('penanganan', fn);
    langganTabel('penanganan', fn);
    a();
    expect(k.dilepas).toHaveLength(0);
    ubah(k.channels[0]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('pendengar dilepas saat callback berjalan: tidak dipanggil lagi pada siaran yang sama', () => {
    const urutan: string[] = [];
    let hentiB: () => void = () => {};
    langganTabel('penanganan', () => { urutan.push('a'); hentiB(); });
    hentiB = langganTabel('penanganan', () => urutan.push('b'));
    langganTabel('penanganan', () => urutan.push('c'));
    ubah(k.channels[0]);
    expect(urutan).toEqual(['a', 'c']);
  });

  it('pendengar yang melempar galat tidak menghentikan pendengar lain', () => {
    const b = vi.fn();
    langganTabel('penanganan', () => { throw new Error('boom'); });
    langganTabel('penanganan', b);
    expect(() => ubah(k.channels[0])).not.toThrow();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('pendengar terakhir melepas diri di dalam callback: channel dilepas tanpa galat', () => {
    let henti: () => void = () => {};
    henti = langganTabel('penanganan', () => henti());
    ubah(k.channels[0]);
    expect(k.dilepas).toHaveLength(1);
  });
});

describe('status', () => {
  it('putus sebelum SUBSCRIBED; tersambung; CHANNEL_ERROR/TIMED_OUT/CLOSED = putus; diberi tahu hanya saat berubah', () => {
    const henti = langganTabel('tiket_antrean', vi.fn());
    const cb = vi.fn();
    langganStatus('tiket_antrean', cb);
    expect(statusTabel('tiket_antrean')).toBe('putus');
    const ch = k.channels[0];

    ch.status!('SUBSCRIBED');
    expect(statusTabel('tiket_antrean')).toBe('tersambung');
    ch.status!('SUBSCRIBED');
    expect(cb.mock.calls).toEqual([['tersambung']]);

    for (const s of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
      ch.status!('SUBSCRIBED');
      ch.status!(s);
      expect(statusTabel('tiket_antrean')).toBe('putus');
    }
    // tersambung, lalu tiap putaran: (tersambung lagi kecuali putaran pertama) + putus = 1 + 1 + 2 + 2
    expect(cb).toHaveBeenCalledTimes(6);
    henti();
  });

  it('pendengar kedua yang bergabung ke channel tersambung langsung melihat tersambung', () => {
    langganTabel('tiket_antrean', vi.fn());
    k.channels[0].status!('SUBSCRIBED');
    langganTabel('tiket_antrean', vi.fn());
    expect(k.channels).toHaveLength(1);
    expect(statusTabel('tiket_antrean')).toBe('tersambung');
  });

  it('pendengar terakhir pergi: status putus (diberi tahu) dan status terlambat channel lama diabaikan', () => {
    const henti = langganTabel('tiket_antrean', vi.fn());
    const ch = k.channels[0];
    ch.status!('SUBSCRIBED');
    const cb = vi.fn();
    langganStatus('tiket_antrean', cb);
    henti();
    expect(statusTabel('tiket_antrean')).toBe('putus');
    expect(cb.mock.calls).toEqual([['putus']]);
    ch.status!('SUBSCRIBED');
    expect(statusTabel('tiket_antrean')).toBe('putus');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('langganStatus: berhenti idempoten; pengamat dilepas di dalam callback tidak dipanggil', () => {
    langganTabel('penanganan', vi.fn());
    const urutan: string[] = [];
    let hentiB: () => void = () => {};
    const hentiA = langganStatus('penanganan', () => { urutan.push('a'); hentiB(); });
    hentiB = langganStatus('penanganan', () => urutan.push('b'));
    k.channels[0].status!('SUBSCRIBED');
    expect(urutan).toEqual(['a']);
    hentiA();
    hentiA();
    k.channels[0].status!('CLOSED');
    expect(urutan).toEqual(['a']);
  });

  it('status tabel yang tidak dilanggan = putus', () => {
    expect(statusTabel('tidak_ada')).toBe('putus');
  });
});

describe('ketahanan', () => {
  // SSR (tanpa window): lihat pusat.ssr.test.ts (lingkungan node; window jsdom tidak dapat dihapus).

  it('klien gagal dibuat: status putus, tanpa galat; pendengar berikutnya mencoba lagi setelah semua pergi', () => {
    k.gagalBuat = true;
    const henti = langganTabel('penanganan', vi.fn());
    expect(statusTabel('penanganan')).toBe('putus');
    expect(() => henti()).not.toThrow();
    k.gagalBuat = false;
    langganTabel('penanganan', vi.fn());
    expect(k.channels).toHaveLength(1);
  });

  it('langganan ulang cepat (StrictMode): channel baru dibuat setelah channel lama selesai dilepas, tanpa bocor', async () => {
    k.tahanLepas = true;
    const fn = vi.fn();
    const henti1 = langganTabel('penanganan', fn);
    henti1();
    const henti2 = langganTabel('penanganan', fn);
    // realtime-js mengembalikan channel lama selama topik sama belum keluar registri: tunggu dulu.
    expect(k.channels).toHaveLength(1);
    k.selesaikanLepas.shift()!();
    await tunggu();
    expect(k.channels).toHaveLength(2);
    expect(aktif()).toHaveLength(1);
    ubah(aktif()[0]);
    expect(fn).toHaveBeenCalledTimes(1);
    henti2();
    expect(aktif()).toHaveLength(0);
  });

  it('semua pergi lagi sebelum pelepasan lama selesai: tidak ada channel baru', async () => {
    k.tahanLepas = true;
    langganTabel('penanganan', vi.fn())();
    const henti = langganTabel('penanganan', vi.fn());
    henti();
    k.selesaikanLepas.shift()!();
    await tunggu();
    expect(k.channels).toHaveLength(1);
    expect(aktif()).toHaveLength(0);
  });

  it('React StrictMode: efek ganda tidak membocorkan channel', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    const fn = vi.fn();
    const { unmount } = renderHook(() => useEffect(() => langganTabel('tiket_antrean', fn), []), { wrapper });
    await tunggu();
    expect(aktif()).toHaveLength(1);
    unmount();
    await tunggu();
    expect(aktif()).toHaveLength(0);
    expect(k.dilepas).toHaveLength(k.channels.length);
  });
});

// Buka ulang setelah CLOSED (terminal di realtime-js 2.110: onClose mereset rejoinTimer dan mengeluarkan channel dari
// registri; "mismatch bindings" juga berakhir di CLOSED lewat unsubscribe()). CHANNEL_ERROR/TIMED_OUT di-rejoin
// otomatis oleh phoenix, jadi pusat tidak ikut campur.
describe('buka ulang setelah CLOSED (backoff eksponensial berbatas)', () => {
  const setHidden = (h: boolean) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // jitter 0 agar jeda pasti
  });
  afterEach(() => {
    setHidden(false);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('CLOSED dengan pendengar: channel lama dilepas, channel baru setelah 2 dtk, perubahan sampai lagi', async () => {
    const fn = vi.fn();
    const henti = langganTabel('tiket_antrean', fn);
    const lama = k.channels[0];
    lama.status!('SUBSCRIBED');
    lama.status!('CLOSED');
    expect(statusTabel('tiket_antrean')).toBe('putus');
    expect(lama.dilepas).toBe(true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(k.channels).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(k.channels).toHaveLength(2);
    expect(aktif()).toHaveLength(1);
    const baru = aktif()[0];
    expect(baru.topik).toBe('staf-tabel-tiket_antrean');
    baru.status!('SUBSCRIBED');
    expect(statusTabel('tiket_antrean')).toBe('tersambung');
    ubah(baru);
    expect(fn).toHaveBeenCalledTimes(1);
    henti();
    expect(aktif()).toHaveLength(0);
  });

  it('pendengar terakhir pergi saat menunggu backoff: tidak ada channel baru dan tidak ada timer tersisa', async () => {
    const henti = langganTabel('penanganan', vi.fn());
    k.channels[0].status!('CLOSED');
    henti();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(k.channels).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('CLOSED berturut-turut: jeda naik 2, 4, 8 dtk, maks 60 dtk; tidak pernah dua channel aktif', async () => {
    langganTabel('penanganan', vi.fn());
    const jeda: number[] = [];
    for (let i = 0; i < 7; i++) {
      const ch = aktif()[0];
      ch.status!('CLOSED');
      ch.status!('CLOSED'); // duplikat tidak menambah jadwal
      const sebelum = k.channels.length;
      let ms = 0;
      while (k.channels.length === sebelum && ms < 120_000) {
        await vi.advanceTimersByTimeAsync(1_000);
        ms += 1_000;
        expect(aktif().length).toBeLessThanOrEqual(1);
      }
      expect(k.channels.length).toBe(sebelum + 1);
      jeda.push(ms);
    }
    expect(jeda).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  });

  it('backoff kembali ke 2 dtk setelah tersambung stabil (>= 30 dtk)', async () => {
    langganTabel('penanganan', vi.fn());
    aktif()[0].status!('CLOSED');
    await vi.advanceTimersByTimeAsync(2_000);
    aktif()[0].status!('CLOSED');
    await vi.advanceTimersByTimeAsync(4_000); // percobaan kedua: 4 dtk
    expect(k.channels).toHaveLength(3);
    aktif()[0].status!('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(30_000);
    aktif()[0].status!('CLOSED');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(k.channels).toHaveLength(4);
  });

  it('CHANNEL_ERROR dan TIMED_OUT: realtime-js rejoin sendiri, pusat tidak melepas atau membuat channel', async () => {
    langganTabel('penanganan', vi.fn());
    k.channels[0].status!('CHANNEL_ERROR');
    k.channels[0].status!('TIMED_OUT');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(k.dilepas).toHaveLength(0);
    expect(k.channels).toHaveLength(1);
    expect(statusTabel('penanganan')).toBe('putus');
  });

  it('tanpa pendengar: CLOSED terlambat dari channel yang sudah dilepas tidak membuka ulang', async () => {
    const henti = langganTabel('penanganan', vi.fn());
    const ch = k.channels[0];
    henti();
    ch.status!('CLOSED');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(k.channels).toHaveLength(1);
  });

  it('tab tersembunyi saat jadwal tiba: menunggu tab terlihat, lalu membuka satu channel', async () => {
    langganTabel('penanganan', vi.fn());
    k.channels[0].status!('CLOSED');
    setHidden(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(k.channels).toHaveLength(1);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(k.channels).toHaveLength(2);
    setHidden(true);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(k.channels).toHaveLength(2);
  });

  it('pembukaan ulang gagal (channel() melempar): dicoba lagi dengan jeda yang naik', async () => {
    langganTabel('penanganan', vi.fn());
    k.channels[0].status!('CLOSED');
    k.gagalChannel = true;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(k.channels).toHaveLength(1);
    k.gagalChannel = false;
    await vi.advanceTimersByTimeAsync(3_999);
    expect(k.channels).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(k.channels).toHaveLength(2);
  });

  it('menunggu pelepasan channel lama selesai sebelum membuka ulang', async () => {
    k.tahanLepas = true;
    langganTabel('penanganan', vi.fn());
    k.channels[0].status!('CLOSED');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(k.channels).toHaveLength(1);
    k.selesaikanLepas.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(k.channels).toHaveLength(2);
  });
});
