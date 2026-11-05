// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { buatFakeSupabase, buatH, punyaOp, type FakeH, type HasilFake } from '@/test/fo-supabase-mock';

const h: FakeH = vi.hoisted(() => ({ tabel: {}, rpc: () => ({ data: null, error: null }), user: null, log: [], rpcLog: [] }));
const removeChannel = vi.hoisted(() => vi.fn());
const infoHari = vi.hoisted(() => ({ alasan: null as string | null }));

vi.mock('@/lib/supabase/client', async () => {
  const { buatFakeSupabase: buat } = await import('@/test/fo-supabase-mock');
  return {
    createClient: () => {
      const rantai: { on: () => typeof rantai; subscribe: () => string } = { on: () => rantai, subscribe: () => 'SUBSCRIBED' };
      return { ...buat(h), channel: () => rantai, removeChannel };
    },
  };
});
// Jadwal PER LAYANAN (Fase 5): hanya petugas Layanan yang dinilai; `alasan` terisi = Layanan tidak beroperasi hari ini.
vi.mock('@/lib/chat/status-layanan', () => ({
  muatStatusLayananChat: vi.fn(async () => ({ hariTanpaLayanan: !!infoHari.alasan })),
}));

import { hitungBadge, segarkanBadge, totalBadge, useJudulTabBadge, useNavBadges } from './useNavBadges';

const ok = (count: number): HasilFake => ({ data: null, error: null, count });
const galat: HasilFake = { data: null, error: { message: 'boom' } };

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
}

beforeEach(() => {
  Object.assign(h, buatH());
  infoHari.alasan = null;
  removeChannel.mockClear();
  setVisibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
});

const FO = { role: 'front_office', petugasId: 'p-fo', layananId: null };
const ADMIN = { role: 'admin', petugasId: 'p-adm', layananId: null };
const PETUGAS = { role: 'petugas', petugasId: 'p-1', layananId: 'lay-1' };

/** Jawaban per tabel + operasi, meniru kueri yang dipakai tiap badge. */
function pasangJawaban() {
  h.tabel.penanganan = (ops) => {
    if (punyaOp(ops, 'eq', 'saluran', 'chat')) return ok(2); // chat menunggu di Kotak Masuk FO
    if (punyaOp(ops, 'eq', 'status', 'berjalan')) return ok(1); // penanganan FO milik saya
    if (punyaOp(ops, 'gt', 'tahap_ke', 1)) return ok(1); // dikembalikan
    return ok(3); // kotak masuk FO non-chat
  };
  h.tabel.chat_sesi = ok(4);
  h.tabel.tiket_antrean = ok(5);
  h.tabel.pengaduan = ok(6);
  h.tabel.saran = ok(7);
}

describe('hitungBadge (kueri tepat tiap badge)', () => {
  const opsi = { tanggal: '2026-10-14', hariTanpaLayanan: false };
  const sb = () => buatFakeSupabase(h) as never;

  it('front_office: lima badge, kueri dibatasi sesuai aturan', async () => {
    pasangJawaban();
    const r = await hitungBadge(sb(), FO, opsi);
    expect(r.kotakMasukFo).toEqual({ count: 3, label: '3 menunggu diambil, 1 dikembalikan petugas layanan' });
    expect(r.liveChat).toEqual({ count: 2, label: '2 chat menunggu diambil' });
    expect(r.penangananFo?.count).toBe(1);
    expect(r.antrian).toEqual({ count: 5, label: '5 tiket menunggu hari ini' });
    expect(r.pengaduan?.count).toBe(6);
    expect(r.saran).toEqual({ count: 7, label: '7 saran belum ditinjau' });

    const q = (tabel: string) => h.log.filter((l) => l.tabel === tabel).map((l) => l.ops);
    // semua kueri head:true count:'exact'
    for (const l of h.log) expect(l.ops[0]).toEqual(['select', ['id', { count: 'exact', head: true }]]);
    // Kotak Masuk FO: tahap fo, menunggu, bukan chat (+ varian dikembalikan tahap_ke > 1)
    const kotak = q('penanganan').filter((o) => punyaOp(o, 'neq', 'saluran', 'chat'));
    expect(kotak).toHaveLength(2);
    expect(kotak.every((o) => punyaOp(o, 'eq', 'peran_tahap', 'fo') && punyaOp(o, 'eq', 'status', 'menunggu'))).toBe(true);
    expect(kotak.filter((o) => punyaOp(o, 'gt', 'tahap_ke', 1))).toHaveLength(1);
    // Live Chat FO: penanganan chat tahap fo menunggu (bukan chat_sesi)
    expect(q('penanganan').some((o) => punyaOp(o, 'eq', 'saluran', 'chat') && punyaOp(o, 'eq', 'peran_tahap', 'fo') && punyaOp(o, 'eq', 'status', 'menunggu'))).toBe(true);
    expect(q('chat_sesi')).toHaveLength(0);
    // Penanganan: milik saya, tahap fo, berjalan
    expect(q('penanganan').some((o) => punyaOp(o, 'eq', 'status', 'berjalan') && punyaOp(o, 'eq', 'penangan_id', 'p-fo') && punyaOp(o, 'eq', 'peran_tahap', 'fo'))).toBe(true);
    // Antrian FO: menunggu hari ini (WIB, tanggal dari pemanggil)
    expect(q('tiket_antrean')[0].some(([m, a]) => m === 'eq' && a[0] === 'tanggal' && a[1] === '2026-10-14')).toBe(true);
    expect(punyaOp(q('tiket_antrean')[0], 'eq', 'status', 'menunggu')).toBe(true);
    // Pengaduan FO: baru, hanya jalur layanan
    expect(punyaOp(q('pengaduan')[0], 'eq', 'status', 'baru')).toBe(true);
    expect(punyaOp(q('pengaduan')[0], 'eq', 'jalur', 'layanan')).toBe(true);
    // Saran: yang belum ditinjau (ditinjau_pada kosong)
    expect(punyaOp(q('saran')[0], 'is', 'ditinjau_pada', null)).toBe(true);
  });

  it('saran: kolom ditinjau_pada belum ada (migrasi belum diterapkan) = badge tidak tampil, yang lain tetap', async () => {
    pasangJawaban();
    h.tabel.saran = galat;
    const r = await hitungBadge(sb(), ADMIN, opsi);
    expect(r.saran).toBeUndefined();
    expect(r.pengaduan?.count).toBe(6);
  });

  it('admin: Live Chat = semua sesi eskalasi; pengaduan semua jalur', async () => {
    pasangJawaban();
    const r = await hitungBadge(sb(), ADMIN, opsi);
    expect(r.liveChat?.count).toBe(4);
    expect(punyaOp(h.log.find((l) => l.tabel === 'chat_sesi')!.ops, 'eq', 'status', 'eskalasi')).toBe(true);
    expect(h.log.find((l) => l.tabel === 'chat_sesi')!.ops.some(([m, a]) => m === 'eq' && a[0] === 'layanan_id')).toBe(false);
    expect(punyaOp(h.log.find((l) => l.tabel === 'pengaduan')!.ops, 'eq', 'jalur')).toBe(false);
    expect(r.penangananFo?.count).toBe(1);
  });

  it('petugas layanan: hanya Antrian + Live Chat, dibatasi layanannya; tanpa kueri pengaduan/FO', async () => {
    pasangJawaban();
    const r = await hitungBadge(sb(), PETUGAS, opsi);
    expect(Object.keys(r).sort()).toEqual(['antrian', 'liveChat']);
    expect(h.log.some((l) => l.tabel === 'saran')).toBe(false);
    expect(r.antrian?.label).toBe('5 tiket menunggu atau dipanggil hari ini');
    const chat = h.log.find((l) => l.tabel === 'chat_sesi')!.ops;
    expect(punyaOp(chat, 'eq', 'layanan_id', 'lay-1')).toBe(true);
    const tiket = h.log.find((l) => l.tabel === 'tiket_antrean')!.ops;
    expect(punyaOp(tiket, 'in', 'status', ['menunggu', 'dipanggil'])).toBe(true);
    expect(punyaOp(tiket, 'eq', 'layanan_id', 'lay-1')).toBe(true);
    expect(h.log.map((l) => l.tabel).sort()).toEqual(['chat_sesi', 'tiket_antrean']);
  });

  it('petugas tanpa layanan: tidak ada badge Antrian', async () => {
    pasangJawaban();
    const r = await hitungBadge(sb(), { ...PETUGAS, layananId: null }, opsi);
    expect(r.antrian).toBeUndefined();
  });

  it('role tak berhak / tak dikenal: tanpa kueri', async () => {
    pasangJawaban();
    expect(await hitungBadge(sb(), { role: 'pengunjung', petugasId: null, layananId: null }, opsi)).toEqual({});
    expect(h.log).toHaveLength(0);
  });

  it('hari tanpa layanan: tanpa kueri chat dan badge Live Chat 0', async () => {
    pasangJawaban();
    const r = await hitungBadge(sb(), ADMIN, { ...opsi, hariTanpaLayanan: true });
    expect(r.liveChat?.count).toBe(0);
    expect(h.log.some((l) => l.tabel === 'chat_sesi')).toBe(false);
  });

  it('kueri yang gagal dilewati (badge itu tidak ada), yang lain tetap', async () => {
    pasangJawaban();
    h.tabel.pengaduan = galat;
    const r = await hitungBadge(sb(), ADMIN, opsi);
    expect(r.pengaduan).toBeUndefined();
    expect(r.antrian?.count).toBe(5);
  });

  it('totalBadge menjumlah semua', () => {
    expect(totalBadge({ antrian: { count: 2, label: '' }, liveChat: { count: 3, label: '' } })).toBe(5);
    expect(totalBadge({})).toBe(0);
  });
});

describe('useNavBadges', () => {
  it('belum tahu role: tidak memuat apa pun', async () => {
    pasangJawaban();
    const { result } = renderHook(() => useNavBadges(null));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(h.log).toHaveLength(0);
    expect(result.current).toEqual({});
  });

  it('memuat begitu role diketahui dan mengembalikan badge', async () => {
    pasangJawaban();
    const { result } = renderHook(() => useNavBadges(FO));
    await waitFor(() => expect(result.current.antrian?.count).toBe(5));
    expect(result.current.liveChat?.count).toBe(2);
  });

  it('segarkanBadge() memuat ulang segera (tanpa menunggu polling)', async () => {
    pasangJawaban();
    const { result } = renderHook(() => useNavBadges(ADMIN));
    await waitFor(() => expect(result.current.saran?.count).toBe(7));
    h.tabel.saran = ok(0);
    await act(async () => { segarkanBadge(); });
    await waitFor(() => expect(result.current.saran?.count).toBe(0));
  });

  it.each([
    ['tabel belum tersedia', 'PGRST205'],
    ['kolom belum tersedia', '42703'],
    ['galat database', 'XX000'],
    ['kueri melempar galat', null],
  ])('Saran: %s menghapus angka lama dan pulih setelah kueri berhasil', async (_alasan, code) => {
    pasangJawaban();
    const { result } = renderHook(() => useNavBadges(ADMIN));
    await waitFor(() => expect(result.current.saran?.count).toBe(7));
    const totalAwal = totalBadge(result.current);
    h.tabel.saran = code
      ? { data: null, count: 99, error: { code, message: 'Saran tidak dapat dihitung' } }
      : () => { throw new Error('Koneksi terputus'); };

    await act(async () => { segarkanBadge(); });
    await waitFor(() => expect(result.current.saran).toBeUndefined());
    expect(totalBadge(result.current)).toBe(totalAwal - 7);
    expect(result.current.pengaduan?.count).toBe(6);

    h.tabel.saran = ok(2);
    await act(async () => { segarkanBadge(); });
    await waitFor(() => expect(result.current.saran).toEqual({ count: 2, label: '2 saran belum ditinjau' }));
  });

  it('badge tidak muncul pada role tak berhak (petugas tidak dapat badge FO/pengaduan)', async () => {
    pasangJawaban();
    const { result } = renderHook(() => useNavBadges(PETUGAS));
    await waitFor(() => expect(result.current.antrian?.count).toBe(5));
    expect(result.current.kotakMasukFo).toBeUndefined();
    expect(result.current.pengaduan).toBeUndefined();
    expect(result.current.penangananFo).toBeUndefined();
  });

  it('galat ditelan tanpa crash; nilai lama dipertahankan sampai pulih', async () => {
    vi.useFakeTimers();
    pasangJawaban();
    const { result } = renderHook(() => useNavBadges(ADMIN));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.pengaduan?.count).toBe(6);
    h.tabel.pengaduan = galat;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_100); });
    expect(result.current.pengaduan?.count).toBe(6); // lama dipertahankan
    h.tabel.pengaduan = ok(7);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_100); });
    expect(result.current.pengaduan?.count).toBe(7);
  });

  it('polling 30 dtk hanya saat tab terlihat; kembali terlihat memicu refetch', async () => {
    vi.useFakeTimers();
    pasangJawaban();
    renderHook(() => useNavBadges(ADMIN));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const awal = h.log.length;
    expect(awal).toBeGreaterThan(0);

    setVisibility('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(95_000); });
    expect(h.log.length).toBe(awal); // tersembunyi: tidak ada kueri

    setVisibility('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(10); });
    expect(h.log.length).toBeGreaterThan(awal); // refetch saat kembali terlihat

    const sesudahKembali = h.log.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_100); });
    expect(h.log.length).toBeGreaterThan(sesudahKembali); // polling jalan lagi saat terlihat
  });

  it('petugas: Layanannya tidak beroperasi hari ini -> tidak ada badge chat dan tidak ada kueri chat', async () => {
    pasangJawaban();
    infoHari.alasan = 'akhir_pekan';
    const { result } = renderHook(() => useNavBadges(PETUGAS));
    await waitFor(() => expect(result.current.antrian?.count).toBeDefined());
    expect(result.current.liveChat?.count).toBe(0);
    expect(h.log.some((l) => l.tabel === 'chat_sesi')).toBe(false);
  });

  it('Admin/FO melihat banyak Layanan: satu hari tanpa pelayanan tidak menolkan badge chat; status per Layanan tidak dinilai', async () => {
    const { muatStatusLayananChat } = await import('@/lib/chat/status-layanan');
    (muatStatusLayananChat as ReturnType<typeof vi.fn>).mockClear();
    pasangJawaban();
    infoHari.alasan = 'akhir_pekan';
    const { result } = renderHook(() => useNavBadges(ADMIN));
    await waitFor(() => expect(result.current.antrian?.count).toBe(5));
    await waitFor(() => expect(h.log.some((l) => l.tabel === 'chat_sesi')).toBe(true));
    expect(muatStatusLayananChat).not.toHaveBeenCalled();
  });

  it('cleanup saat unmount: channel dilepas dan tidak ada kueri susulan', async () => {
    vi.useFakeTimers();
    pasangJawaban();
    const { unmount } = renderHook(() => useNavBadges(ADMIN));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    unmount();
    expect(removeChannel).toHaveBeenCalled();
    const n = h.log.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(95_000); });
    expect(h.log.length).toBe(n);
  });
});

describe('useJudulTabBadge', () => {
  it('menambah awalan (N) bila N > 0, mengembalikannya bila 0, dan menahan penimpaan title', async () => {
    document.title = 'Antrian | Admin LMH';
    const { rerender, unmount } = renderHook(({ n }) => useJudulTabBadge(n), { initialProps: { n: 3 } });
    expect(document.title).toBe('(3) Antrian | Admin LMH');
    rerender({ n: 5 });
    expect(document.title).toBe('(5) Antrian | Admin LMH');
    // Next mengganti title saat navigasi: awalan dipasang ulang.
    await act(async () => {
      document.title = 'Kunjungan | Admin LMH';
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.title).toBe('(5) Kunjungan | Admin LMH');
    rerender({ n: 0 });
    expect(document.title).toBe('Kunjungan | Admin LMH');
    rerender({ n: 2 });
    unmount();
    expect(document.title).toBe('Kunjungan | Admin LMH');
  });
});
