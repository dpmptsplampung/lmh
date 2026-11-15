// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { usePanggilanLayar, DURASI_PITA_MS, POLL_PANGGILAN_MS, POLL_PANGGILAN_TERSAMBUNG_MS, MAKS_ANTRE } from './usePanggilanLayar';

type Baris = { id: string; layanan_id: string; nomor_display: string; label: string | null; dibuat_at: string };
const p = (id: string, nomor: string, detik: number, layanan = 'l1'): Baris => ({
  id, layanan_id: layanan, nomor_display: nomor, label: 'Helpdesk OSS',
  dibuat_at: new Date(Date.UTC(2026, 10, 3, 3, 0, detik)).toISOString(),
});

let tabel: Baris[] = [];
let galat = false;
let picuInsert: (() => void) | null = null;
let statusChannel: ((s: string) => void) | null = null;
const log: Array<{ gte?: string; urutan?: boolean; batas?: number; kolom?: string }> = [];

function pasang() {
  const channelApi = {
    on: vi.fn((_t: string, _f: unknown, cb: () => void) => { picuInsert = cb; return channelApi; }),
    subscribe: vi.fn((cb?: (s: string) => void) => { statusChannel = cb ?? null; return channelApi; }),
  };
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn((nama: string) => {
      expect(nama).toBe('panggilan_layar');
      const q: { gte?: string; urutan?: boolean; batas?: number; kolom?: string } = {};
      const rantai = {
        select: (kolom: string) => { q.kolom = kolom; return rantai; },
        gte: (_k: string, v: string) => { q.gte = v; return rantai; },
        order: (_k: string, o: { ascending: boolean }) => { q.urutan = o.ascending; return rantai; },
        limit: async (n: number) => {
          q.batas = n;
          log.push(q);
          if (galat) return { data: null, error: { message: 'x' } };
          let data = [...tabel];
          if (q.gte) data = data.filter(b => b.dibuat_at >= q.gte!);
          data.sort((a, b) => (a.dibuat_at < b.dibuat_at ? -1 : 1) * (q.urutan ? 1 : -1));
          return { data: data.slice(0, n), error: null };
        },
      };
      return rantai;
    }),
    channel: vi.fn(() => channelApi),
    removeChannel: vi.fn().mockResolvedValue('ok'),
  });
}

const maju = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('usePanggilanLayar', () => {
  beforeEach(() => { vi.useFakeTimers(); tabel = []; galat = false; picuInsert = null; statusChannel = null; log.length = 0; pasang(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('konstanta: pita 5 dtk, polling 5 dtk (putus) dan 20 dtk (tersambung)', () => {
    expect(DURASI_PITA_MS).toBe(5000);
    expect(POLL_PANGGILAN_MS).toBe(5000);
    expect(POLL_PANGGILAN_TERSAMBUNG_MS).toBe(20_000);
  });

  it('tersambung: polling 20 dtk', async () => {
    renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    act(() => statusChannel?.('SUBSCRIBED'));
    expect(log).toHaveLength(1);
    await maju(POLL_PANGGILAN_TERSAMBUNG_MS - 1);
    expect(log).toHaveLength(1);
    await maju(1);
    expect(log).toHaveLength(2);
  });

  it('putus lagi: kembali ke polling 5 dtk; sambung ulang memicu satu muat pengejar', async () => {
    renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    act(() => statusChannel?.('SUBSCRIBED'));
    act(() => statusChannel?.('CHANNEL_ERROR'));
    await maju(POLL_PANGGILAN_MS);
    expect(log).toHaveLength(2);
    act(() => statusChannel?.('SUBSCRIBED'));
    await maju(200);
    expect(log).toHaveLength(3);
  });

  it('INSERT saat tersambung tampil seketika tanpa menunggu polling 20 dtk', async () => {
    const { result } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    act(() => statusChannel?.('SUBSCRIBED'));
    tabel = [p('a', 'OS-014', 10)];
    await act(async () => { picuInsert?.(); });
    await maju(500);
    expect(result.current.saatIni?.id).toBe('a');
  });

  it('unmount membersihkan timer; status terlambat diabaikan', async () => {
    const { unmount } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    unmount();
    act(() => statusChannel?.('SUBSCRIBED'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('riwayat panggilan hari ini TIDAK diumumkan saat layar baru dibuka', async () => {
    tabel = [p('a', 'OS-001', 1), p('b', 'OS-002', 2)];
    const { result } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    expect(result.current.saatIni).toBeNull();
    await maju(POLL_PANGGILAN_MS);
    expect(result.current.saatIni).toBeNull();
  });

  it('memberi empat kejadian terbaru dari bacaan yang sama, tanpa memutar pita lama atau menggandakan riwayat', async () => {
    vi.setSystemTime(new Date('2026-11-03T03:01:00Z'));
    tabel = Array.from({ length: 6 }, (_, i) => p(`r${i}`, `OS-00${i}`, i));
    const { result } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    expect(result.current.riwayat.map(b => b.id)).toEqual(['r5', 'r4', 'r3', 'r2']);
    expect(result.current.saatIni).toBeNull();
    expect(log).toHaveLength(1);
    tabel.push(p('baru', 'OS-014', 10));
    await maju(POLL_PANGGILAN_MS);
    expect(result.current.riwayat.map(b => b.id)).toEqual(['baru', 'r5', 'r4', 'r3']);
    expect(result.current.saatIni?.id).toBe('baru');
    await maju(POLL_PANGGILAN_MS);
    expect(result.current.riwayat.map(b => b.id)).toEqual(['baru', 'r5', 'r4', 'r3']);
  });

  it('menghapus riwayat tepat saat hari WIB berganti, termasuk ketika bacaan berikutnya gagal', async () => {
    vi.setSystemTime(new Date('2026-11-03T16:59:59Z'));
    tabel = [{ ...p('terakhir', 'OS-014', 0), dibuat_at: '2026-11-03T16:59:58Z' }];
    const { result } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    expect(result.current.riwayat.map(b => b.id)).toEqual(['terakhir']);
    expect(log).toHaveLength(1);
    galat = true;
    await maju(999);
    expect(result.current.riwayat).toHaveLength(1);
    await maju(1);
    expect(result.current.riwayat).toEqual([]);
    expect(log).toHaveLength(1);
    await maju(POLL_PANGGILAN_MS);
    expect(result.current.riwayat).toEqual([]);
  });

  it('riwayat memuat empat nomor berbeda; panggil ulang memindahkan nomor ke atas tanpa menggandakannya', async () => {
    vi.setSystemTime(new Date('2026-11-03T03:01:00Z'));
    tabel = [p('a', 'OS-001', 1), p('b', 'OS-002', 2), p('c', 'OS-003', 3), p('d', 'OS-004', 4), p('ulang1', 'OS-001', 5), p('ulangLagi1', 'OS-001', 6)];
    const { result } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    expect(result.current.riwayat.map(b => b.nomor_display)).toEqual(['OS-001', 'OS-004', 'OS-003', 'OS-002']);
    expect(result.current.riwayat[0].id).toBe('ulangLagi1');
    tabel.push(p('ulang2', 'OS-004', 10));
    await maju(POLL_PANGGILAN_MS);
    expect(result.current.riwayat.map(b => b.nomor_display)).toEqual(['OS-004', 'OS-001', 'OS-003', 'OS-002']);
    expect(result.current.riwayat[0].id).toBe('ulang2');
    expect(result.current.saatIni?.id).toBe('ulang2');
    await maju(POLL_PANGGILAN_MS);
    expect(result.current.riwayat.map(b => b.nomor_display)).toEqual(['OS-004', 'OS-001', 'OS-003', 'OS-002']);
  });

  it.each([-120_000, 120_000])('mencatat waktu terima panggilan baru saat jam TV berselisih %i ms dari server, tanpa memperbaruinya pada polling ulang', async selisih => {
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 3, 3, 0, 0) + selisih));
    tabel = [p('lama', 'OS-001', 0)];
    const { result } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    expect(result.current.dipanggilPada).toEqual({});
    tabel.push(p('baru', 'OS-014', 5));
    await maju(POLL_PANGGILAN_MS);
    const diterimaPada = Date.now();
    expect(result.current.dipanggilPada.l1).toBe(diterimaPada);
    await maju(29_999);
    expect(result.current.dipanggilPada.l1).toBe(diterimaPada);
    await maju(1);
    expect(result.current.dipanggilPada.l1).toBeUndefined();
  });

  it('panggilan baru muncul 5 detik lalu hilang; kolom yang diminta eksplisit (tanpa tiket_id)', async () => {
    const { result } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    tabel = [p('a', 'OS-014', 10)];
    await maju(POLL_PANGGILAN_MS);
    expect(result.current.saatIni?.nomor_display).toBe('OS-014');
    await maju(DURASI_PITA_MS - 1);
    expect(result.current.saatIni).not.toBeNull();
    await maju(1);
    expect(result.current.saatIni).toBeNull();
    for (const q of log) expect(q.kolom).toBe('id,layanan_id,nomor_display,label,dibuat_at');
  });

  it('panggilan beruntun antre satu per satu, urut waktu, masing-masing 5 detik', async () => {
    const { result } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    tabel = [p('b', 'OS-016', 12), p('a', 'OS-015', 11)];
    await maju(POLL_PANGGILAN_MS);
    expect(result.current.saatIni?.nomor_display).toBe('OS-015');
    await maju(DURASI_PITA_MS);
    expect(result.current.saatIni?.nomor_display).toBe('OS-016');
    await maju(DURASI_PITA_MS);
    expect(result.current.saatIni).toBeNull();
  });

  it('panggil ulang tiket yang sama (baris baru, id beda) menghasilkan pita lagi; baris yang sama tidak dobel', async () => {
    const { result } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    tabel = [p('a', 'OS-014', 10)];
    await maju(POLL_PANGGILAN_MS);
    await maju(DURASI_PITA_MS);
    expect(result.current.saatIni).toBeNull();
    await maju(POLL_PANGGILAN_MS); // polling lagi: baris 'a' sama, tidak diumumkan ulang
    expect(result.current.saatIni).toBeNull();
    tabel = [...tabel, p('c', 'OS-014', 40)];
    await maju(POLL_PANGGILAN_MS);
    expect(result.current.saatIni?.id).toBe('c');
  });

  it('antrean pita dibatasi: yang terlalu lama tertinggal dibuang, yang terbaru dipertahankan', async () => {
    const { result } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    tabel = Array.from({ length: MAKS_ANTRE + 4 }, (_, i) => p(`x${i}`, `OS-0${i}`, 10 + i));
    await maju(POLL_PANGGILAN_MS);
    const tampil: string[] = [];
    for (let i = 0; i < MAKS_ANTRE + 4 && result.current.saatIni; i++) {
      tampil.push(result.current.saatIni.id);
      await maju(DURASI_PITA_MS);
    }
    expect(tampil).toHaveLength(MAKS_ANTRE);
    expect(tampil.at(-1)).toBe(`x${MAKS_ANTRE + 3}`);
  });

  it('kejadian INSERT realtime memicu muat segera tanpa menunggu polling', async () => {
    const { result } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    tabel = [p('a', 'OS-014', 10)];
    expect(picuInsert).not.toBeNull();
    await act(async () => { picuInsert?.(); });
    await maju(500);
    expect(result.current.saatIni?.id).toBe('a');
  });

  it('galat membaca panggilan diam-diam (tidak melempar) lalu pulih pada polling berikutnya', async () => {
    const { result } = renderHook(() => usePanggilanLayar({ aktif: true }));
    await maju(0);
    galat = true;
    tabel = [p('a', 'OS-014', 10)];
    await maju(POLL_PANGGILAN_MS);
    expect(result.current.saatIni).toBeNull();
    galat = false;
    await maju(POLL_PANGGILAN_MS);
    expect(result.current.saatIni?.id).toBe('a');
  });

  it('tidak aktif: tidak menyentuh database', async () => {
    renderHook(() => usePanggilanLayar({ aktif: false }));
    await maju(POLL_PANGGILAN_MS * 2);
    expect(log).toHaveLength(0);
  });
});
