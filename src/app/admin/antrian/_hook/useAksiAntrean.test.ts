// @vitest-environment jsdom
// Kontrak useAksiAntrean (tugas 5.3): panggil / mulai / selesaikan lewat fungsi data bertipe HasilAntrean
// (lib/data/antrean.ts), toast dan muat ulang di hook, kunci klik ganda per tiket, jeda tombol Panggil.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const db = vi.hoisted(() => ({
  rpc: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: db.rpc }) }));

import type { TiketBaris } from '@/lib/data/antrean';
import { mulaiLayananTiket, panggilTiket, selesaikanLayananTiket } from '@/lib/data/antrean';
import { JEDA_PANGGIL_MS, useAksiAntrean } from './useAksiAntrean';

const tiket = (over: Partial<TiketBaris> = {}): TiketBaris => ({
  id: 't-1', kunjungan_id: 'k-1', legacy_visit_id: 'v-1', layanan_id: 'l-1', dilayani_oleh: null, penanganan_asal_id: null,
  pelayan: null, nomor: 1, nomor_display: 'A-001', status: 'menunggu', waktu_terbit: null, waktu_mulai_layan: null,
  waktu_selesai: null, layanan: { nama: 'Helpdesk OSS', form_pendataan: 'oss' }, kunjungan: null, ...over,
});
const BPJS = { nama: 'BPJS', form_pendataan: null };

type Rpc = { data: unknown; error: { message: string; code?: string } | null };
const jawab = (peta: Record<string, Rpc | (() => Promise<Rpc>)>) =>
  db.rpc.mockImplementation((nama: string) => {
    const j = peta[nama] ?? { data: { ok: true }, error: null };
    return typeof j === 'function' ? j() : Promise.resolve(j);
  });

const urutan: string[] = [];
const toast = vi.fn((pesan: string, jenis?: string) => { urutan.push(`toast:${jenis}:${pesan}`); });
const muatSenyap = vi.fn(async () => { urutan.push('muat'); });
const buka = vi.fn((jenis: string, t: TiketBaris) => { urutan.push(`buka:${jenis}:${t.id}`); });
const bukaQrTiket = vi.fn((id: string | null) => { urutan.push(`qr:${id}`); });

const pasang = () => renderHook(() => useAksiAntrean({ toast, muatSenyap, buka, bukaQrTiket }));

let spyError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  urutan.length = 0;
  jawab({});
  spyError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  spyError.mockRestore();
  vi.useRealTimers();
});

describe('lib/data/antrean: aksi RPC bertipe HasilAntrean (tidak pernah melempar)', () => {
  const sb = () => ({ rpc: db.rpc }) as never;
  it('panggilTiket: baris = dipanggil; kosong = tidak dipanggil; galat = error dengan MutasiError asli', async () => {
    jawab({ panggil_tiket: { data: 'A-001', error: null } });
    expect(await panggilTiket(sb(), 't-1')).toEqual({ data: { dipanggil: true }, error: null });
    expect(db.rpc).toHaveBeenCalledWith('panggil_tiket', { p_tiket_id: 't-1' });
    jawab({ panggil_tiket: { data: null, error: null } });
    expect(await panggilTiket(sb(), 't-1')).toEqual({ data: { dipanggil: false }, error: null });
    jawab({ panggil_tiket: { data: null, error: { message: 'boom', code: 'XX000' } } });
    const h = await panggilTiket(sb(), 't-1');
    expect(h.data).toBeNull();
    expect((h.error?.asli as Error).name).toBe('MutasiError');
  });

  it('mulaiLayananTiket: sudah_milik_anda; kosong tanpa galat = gagal', async () => {
    jawab({ layanan_mulai: { data: { ok: true, sudah_milik_anda: true }, error: null } });
    expect(await mulaiLayananTiket(sb(), 't-1')).toEqual({ data: { sudahMilikAnda: true }, error: null });
    jawab({ layanan_mulai: { data: null, error: null } });
    expect((await mulaiLayananTiket(sb(), 't-1')).error).not.toBeNull();
  });

  it('selesaikanLayananTiket: sukses = true; galat RPC diteruskan', async () => {
    jawab({ layanan_selesai: { data: { ok: true }, error: null } });
    expect(await selesaikanLayananTiket(sb(), 't-1')).toEqual({ data: true, error: null });
    expect(db.rpc).toHaveBeenCalledWith('layanan_selesai', { p_tiket_id: 't-1' });
    jawab({ layanan_selesai: { data: null, error: { message: 'BUKAN_PEMILIK: x', code: 'P0001' } } });
    expect((await selesaikanLayananTiket(sb(), 't-1')).error).not.toBeNull();
  });
});

describe('useAksiAntrean: panggil', () => {
  it('sukses: true, toast, TANPA muat ulang; tombol terkunci selama jeda lalu terbuka lagi', async () => {
    vi.useFakeTimers();
    const { result } = pasang();
    let hasil!: boolean;
    await act(async () => { hasil = await result.current.panggil('t-1', 'A-001'); });
    expect(hasil).toBe(true);
    expect(toast).toHaveBeenCalledWith('Memanggil A-001…', 'success');
    expect(muatSenyap).not.toHaveBeenCalled();
    expect(result.current.sedangPanggil.has('t-1')).toBe(true);
    // klik ganda selama jeda: tidak ada panggilan kedua
    await act(async () => { hasil = await result.current.panggil('t-1', 'A-001'); });
    expect(hasil).toBe(false);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(JEDA_PANGGIL_MS); });
    expect(result.current.sedangPanggil.has('t-1')).toBe(false);
    await act(async () => { await result.current.panggil('t-1', 'A-001'); });
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });

  it('tiket tidak lagi menunggu (RPC kosong): false, toast galat, muat ulang, kunci langsung dilepas', async () => {
    jawab({ panggil_tiket: { data: null, error: null } });
    const { result } = pasang();
    let hasil!: boolean;
    await act(async () => { hasil = await result.current.panggil('t-1', 'A-001'); });
    expect(hasil).toBe(false);
    expect(urutan).toEqual(['toast:error:A-001 tidak dipanggil: tiket sudah tidak berstatus menunggu. Daftar dimuat ulang.', 'muat']);
    expect(result.current.sedangPanggil.size).toBe(0);
  });

  it('galat: false, log + toast pesan mutasi, tanpa muat ulang, kunci langsung dilepas', async () => {
    jawab({ panggil_tiket: { data: null, error: { message: 'permission denied', code: '42501' } } });
    const { result } = pasang();
    await act(async () => { await result.current.panggil('t-1', 'A-001'); });
    expect(toast).toHaveBeenCalledWith('Gagal memanggil A-001. Anda tidak berwenang melakukan perubahan ini', 'error');
    expect(spyError).toHaveBeenCalledWith('Gagal memanggil tiket:', expect.anything());
    expect(muatSenyap).not.toHaveBeenCalled();
    expect(result.current.sedangPanggil.size).toBe(0);
  });
});

describe('useAksiAntrean: mulai', () => {
  it('layanan berformulir: toast, muat ulang, LALU wizard tiket itu', async () => {
    const { result } = pasang();
    const t = tiket();
    await act(async () => { await result.current.mulai(t); });
    expect(db.rpc).toHaveBeenCalledWith('layanan_mulai', { p_tiket_id: 't-1' });
    expect(urutan).toEqual(['toast:success:Layanan dimulai', 'muat', 'buka:wizard:t-1']);
  });

  it('sudah dimulai sebelumnya; layanan tanpa formulir: toast info, tanpa wizard', async () => {
    jawab({ layanan_mulai: { data: { ok: true, sudah_milik_anda: true }, error: null } });
    const { result } = pasang();
    await act(async () => { await result.current.mulai(tiket({ layanan: BPJS })); });
    expect(urutan).toEqual([
      'toast:success:Layanan tiket ini sudah Anda mulai sebelumnya', 'muat', 'toast:info:Layanan ini tidak memiliki form pendataan',
    ]);
    expect(buka).not.toHaveBeenCalled();
  });

  it('galat yang membuat tampilan basi (SUDAH_DIAMBIL): pesan khusus + muat ulang; galat biasa: awalan + tanpa muat ulang', async () => {
    jawab({ layanan_mulai: { data: null, error: { message: 'SUDAH_DIAMBIL: x', code: 'P0001' } } });
    const { result } = pasang();
    await act(async () => { await result.current.mulai(tiket()); });
    expect(urutan).toEqual(['toast:error:Tiket ini sudah ditangani petugas lain.', 'muat']);
    expect(spyError).toHaveBeenCalledWith('Gagal memulai layanan:', expect.anything());

    urutan.length = 0;
    jawab({ layanan_mulai: { data: null, error: { message: 'boom', code: 'XX000' } } });
    await act(async () => { await result.current.mulai(tiket()); });
    expect(urutan).toHaveLength(1);
    expect(urutan[0]).toMatch(/^toast:error:Gagal memulai layanan\. /);
  });

  it('kunci per tiket: klik kedua selama RPC berjalan diabaikan; pengumuman dan sedangProses selama berjalan', async () => {
    let lepas!: (v: Rpc) => void;
    jawab({ layanan_mulai: () => new Promise<Rpc>((r) => { lepas = r; }) });
    const { result } = pasang();
    let p!: Promise<void>;
    act(() => { p = result.current.mulai(tiket()); });
    expect(result.current.sedangProses.has('t-1')).toBe(true);
    expect(result.current.pengumuman).toBe('Memulai layanan A-001…');
    await act(async () => { await result.current.mulai(tiket()); });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    await act(async () => { lepas({ data: { ok: true }, error: null }); await p; });
    expect(result.current.sedangProses.size).toBe(0);
    expect(result.current.pengumuman).toBe('');
  });
});

describe('useAksiAntrean: selesaikan', () => {
  it('layanan berformulir: membuka wizard, TANPA RPC dan tanpa kunci', async () => {
    const { result } = pasang();
    await act(async () => { await result.current.selesaikan(tiket({ status: 'dilayani' })); });
    expect(urutan).toEqual(['buka:wizard:t-1']);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('tiket eskalasi tanpa formulir: membuka dialog selesai eskalasi, TANPA RPC', async () => {
    const { result } = pasang();
    await act(async () => { await result.current.selesaikan(tiket({ layanan: BPJS, penanganan_asal_id: 'pn-1' })); });
    expect(urutan).toEqual(['buka:selesaiEskalasi:t-1']);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('tanpa formulir, bukan eskalasi: layanan_selesai, toast, QR, LALU muat ulang', async () => {
    const { result } = pasang();
    await act(async () => { await result.current.selesaikan(tiket({ layanan: BPJS })); });
    expect(db.rpc).toHaveBeenCalledWith('layanan_selesai', { p_tiket_id: 't-1' });
    expect(urutan).toEqual(['toast:success:Kunjungan berhasil diselesaikan', 'qr:t-1', 'muat']);
  });

  it('galat BUKAN_PEMILIK: pesan + muat ulang, tanpa QR', async () => {
    jawab({ layanan_selesai: { data: null, error: { message: 'BUKAN_PEMILIK: x', code: 'P0001' } } });
    const { result } = pasang();
    await act(async () => { await result.current.selesaikan(tiket({ layanan: BPJS })); });
    expect(bukaQrTiket).not.toHaveBeenCalled();
    expect(urutan[0]).toMatch(/^toast:error:Gagal menyelesaikan antrean\. /);
    expect(urutan[1]).toBe('muat');
    expect(spyError).toHaveBeenCalledWith('Gagal menyelesaikan antrean:', expect.anything());
  });
});
