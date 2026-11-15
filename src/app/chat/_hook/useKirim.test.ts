// @vitest-environment jsdom
// Kontrak useKirim (tugas 6.3): pesan optimistic lalu disimpan, bot hanya pada mode bot (indikator mengetik berhitung),
// pemberitahuan galat bot / batas waktu / terlalu cepat, kirim ulang, foto, dan "Hubungkan ke Petugas" (termasuk jalur
// lama 409). I/O ditiru di lapisan data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const data = vi.hoisted(() => ({ kirim: vi.fn(), bot: vi.fn(), petugas: vi.fn(), lampiran: vi.fn(), unggah: vi.fn() }));
vi.mock('@/lib/data/chat-pengunjung', async (asli) => ({
  ...(await asli<typeof import('@/lib/data/chat-pengunjung')>()),
  kirimPesanChat: data.kirim,
  tanyaBotChat: data.bot,
  mintaPetugasChat: data.petugas,
  kirimLampiranChat: data.lampiran,
}));
vi.mock('@/lib/chat/lampiran-klien', () => ({ unggahLampiranChat: data.unggah }));

import type { PercakapanRingkas } from '@/lib/chat/percakapan';
import { TEKS_MENUNGGU_PETUGAS } from '@/lib/chat/status-layanan';
import type { HasilChat } from '@/lib/data/chat-pengunjung';
import type { ChatMsg } from '../merge';
import type { StatusSesi } from '../_logika/mesinChat';
import { TEKS_BOT_DIPROSES, TEKS_BOT_TERLALU_CEPAT, TEKS_MINTA_PETUGAS_LAMA } from '../_logika/turunan';
import { BOT_LAMBAT_MS, useKirim } from './useKirim';
import { useMesinChat } from './useMesinChat';

const L = '11111111-1111-4111-8111-111111111111';
const tersimpan = (isi: string) => ({ data: { message: { id: `srv-${isi}`, pengirim: 'pengunjung', isi, created_at: 'T' } }, error: null });
const jawaban = (over: Record<string, unknown> = {}) => ({
  data: { jenis: 'jawaban', pesan: null, mintaPetugasLuarJam: false, status: null, eskalasi: false, ...over },
  error: null,
});

function pasang(opsi: { status?: StatusSesi; botAktif?: boolean; tutup?: boolean; hanyaBaca?: boolean } = {}) {
  const pesan = { tambah: vi.fn(), tandai: vi.fn(), gabung: vi.fn(), buangSementara: vi.fn(), sinkron: vi.fn(async () => undefined) };
  const pastikanSesi = vi.fn(async (): Promise<HasilChat<string>> => ({ data: 'sesi-1', error: null }));
  const tutupRef = { current: opsi.tutup ?? false };
  const r = renderHook(() => {
    const mesin = useMesinChat();
    const kirim = useKirim({
      mesin, pesan, pastikanSesi, daring: true, hanyaBaca: opsi.hanyaBaca ?? false, botAktif: opsi.botAktif ?? true, tutupRef,
    });
    return { mesin, kirim };
  });
  const p = { layananId: L, sesiTerakhirId: 'sesi-1', sesiTerbukaId: 'sesi-1', statusTerakhir: opsi.status ?? 'bot' } as PercakapanRingkas;
  act(() => r.result.current.mesin.kirim({ jenis: 'buka', percakapan: p }));
  const isiPemberitahuan = () => pesan.tambah.mock.calls.map(([x]) => x as ChatMsg).filter((x) => x.local === 'notice').map((x) => x.isi);
  return { r, pesan, pastikanSesi, tutupRef, isiPemberitahuan };
}

beforeEach(() => {
  for (const f of Object.values(data)) f.mockReset();
  data.kirim.mockImplementation(async ({ isi }: { isi: string }) => tersimpan(isi));
  data.bot.mockResolvedValue(jawaban());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useKirim: pesan teks dan bot', () => {
  it('mode bot: optimistic -> simpan -> tanya bot; mengetik selama menunggu; status server diterapkan', async () => {
    const lambat = Promise.withResolvers<unknown>();
    data.bot.mockReturnValueOnce(lambat.promise);
    const { r, pesan } = pasang();
    let kiriman!: Promise<void>;
    act(() => {
      kiriman = r.result.current.kirim.kirimTeks('  Syarat KUR?  ');
    });
    const optimistic = pesan.tambah.mock.calls[0][0] as ChatMsg;
    expect(optimistic).toMatchObject({ pengirim: 'pengunjung', isi: 'Syarat KUR?', local: 'pending' });
    expect(optimistic.id).toBe(`user-${optimistic.client_uuid}`);
    await vi.waitFor(() => expect(data.bot).toHaveBeenCalled());
    expect(r.result.current.kirim.mengetik).toBe(true);
    expect(data.kirim).toHaveBeenCalledWith({ sesiId: 'sesi-1', isi: 'Syarat KUR?', clientUuid: optimistic.client_uuid });
    expect(pesan.gabung).toHaveBeenCalledWith([expect.objectContaining({ id: 'srv-Syarat KUR?' })]);
    expect(data.bot).toHaveBeenCalledWith({ pertanyaan: 'Syarat KUR?', layananId: L, sesiId: 'sesi-1' });

    await act(async () => {
      lambat.resolve(jawaban({ pesan: { id: 'b1', pengirim: 'bot', isi: 'Jawab', created_at: 'T' }, status: 'eskalasi' }));
      await kiriman;
    });
    expect(r.result.current.kirim.mengetik).toBe(false);
    expect(pesan.gabung).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'b1' })]);
    expect(r.result.current.mesin.keadaan.status).toBe('eskalasi');
    expect(pesan.buangSementara).toHaveBeenCalled();
  });

  it('sesi dipegang petugas: tanpa bot; balasan tanpa pesan server menandai pesan terkirim', async () => {
    data.kirim.mockResolvedValueOnce({ data: { message: null }, error: null });
    const { r, pesan } = pasang({ status: 'aktif' });
    await act(() => r.result.current.kirim.kirimTeks('Halo'));
    expect(data.bot).not.toHaveBeenCalled();
    expect(pesan.tandai).toHaveBeenCalledWith(expect.stringMatching(/^user-/), undefined);
  });

  it('luar jam + eskalasi + bot aktif: bot tetap menjawab; tanpa bot tidak', async () => {
    const a = pasang({ status: 'eskalasi', tutup: true });
    await act(() => a.r.result.current.kirim.kirimTeks('Halo'));
    expect(data.bot).toHaveBeenCalledTimes(1);
    cleanup();
    const b = pasang({ status: 'eskalasi', tutup: true, botAktif: false });
    await act(() => b.r.result.current.kirim.kirimTeks('Halo'));
    expect(data.bot).toHaveBeenCalledTimes(1);
  });

  it('sesi gagal dibuka atau pesan gagal disimpan: ditandai gagal, tanpa bot; kirim ulang menandai pending lagi', async () => {
    const { r, pesan, pastikanSesi } = pasang();
    pastikanSesi.mockResolvedValueOnce({ data: null, error: { jenis: 'database', pesan: 'x', asli: null } });
    await act(() => r.result.current.kirim.kirimTeks('Halo'));
    expect(data.kirim).not.toHaveBeenCalled();
    const id = (pesan.tambah.mock.calls[0][0] as ChatMsg).id;
    expect(pesan.tandai).toHaveBeenLastCalledWith(id, 'failed');

    data.kirim.mockResolvedValueOnce({ data: null, error: { jenis: 'http', pesan: '', asli: null } });
    const msg = pesan.tambah.mock.calls[0][0] as ChatMsg;
    await act(() => r.result.current.kirim.kirimUlang(msg));
    expect(pesan.tandai.mock.calls.slice(-2)).toEqual([[id, 'pending'], [id, 'failed']]);
    expect(data.bot).not.toHaveBeenCalled();
    expect(r.result.current.kirim.mengetik).toBe(false);
  });

  it('hanya-baca: tidak ada yang dikirim', async () => {
    const { r, pesan } = pasang({ hanyaBaca: true });
    await act(() => r.result.current.kirim.kirimTeks('Halo'));
    expect(pesan.tambah).not.toHaveBeenCalled();
  });

  it('pemberitahuan bot: terlalu cepat; batas waktu habis (beda jam kerja/luar jam) lalu sinkron', async () => {
    const { r, pesan, tutupRef, isiPemberitahuan } = pasang();
    data.bot.mockResolvedValueOnce({ data: { jenis: 'terlalu_cepat' }, error: null });
    await act(() => r.result.current.kirim.kirimTeks('a'));
    expect(isiPemberitahuan()).toContain(TEKS_BOT_TERLALU_CEPAT);

    data.bot.mockResolvedValueOnce({ data: null, error: { jenis: 'waktu_habis', pesan: '', asli: null } });
    await act(() => r.result.current.kirim.kirimTeks('b'));
    expect(isiPemberitahuan().at(-1)).toContain('Hubungkan ke Petugas');
    expect(pesan.sinkron).toHaveBeenCalledTimes(1);

    tutupRef.current = true;
    data.bot.mockResolvedValueOnce({ data: null, error: { jenis: 'waktu_habis', pesan: '', asli: null } });
    await act(() => r.result.current.kirim.kirimTeks('c'));
    expect(isiPemberitahuan().at(-1)).toContain('kirim ulang pertanyaan');
  });

  it('niat minta petugas di luar jam tanpa pesan server: teks tunggu; eskalasi tanpa status -> eskalasi', async () => {
    const { r, isiPemberitahuan } = pasang();
    data.bot.mockResolvedValueOnce(jawaban({ mintaPetugasLuarJam: true, eskalasi: true }));
    await act(() => r.result.current.kirim.kirimTeks('petugas'));
    expect(isiPemberitahuan()).toContain(TEKS_MENUNGGU_PETUGAS);
    expect(r.result.current.mesin.keadaan.status).toBe('eskalasi');
  });

  it('bot lambat: pemberitahuan sementara "masih diproses" setelah 20 dtk', async () => {
    vi.useFakeTimers();
    const lambat = Promise.withResolvers<unknown>();
    data.bot.mockReturnValueOnce(lambat.promise);
    const { r, pesan } = pasang();
    let kiriman!: Promise<void>;
    act(() => {
      kiriman = r.result.current.kirim.kirimTeks('a');
    });
    await act(() => vi.advanceTimersByTimeAsync(BOT_LAMBAT_MS));
    const sementara = pesan.tambah.mock.calls.map(([x]) => x as ChatMsg).find((x) => x.isi === TEKS_BOT_DIPROSES);
    expect(sementara?.transient).toBe(true);
    await act(async () => {
      lambat.resolve(jawaban());
      await kiriman;
    });
    expect(pesan.buangSementara).toHaveBeenCalled();
  });
});

describe('useKirim: foto', () => {
  const berkas = new File(['x'], 'a.jpg', { type: 'image/jpeg' });

  it('unggah lalu simpan sebagai pesan lampiran; tanpa bot', async () => {
    data.unggah.mockResolvedValue({ kunci: 'k' });
    data.lampiran.mockResolvedValue({ data: { message: { id: 'f1' } }, error: null });
    const { r, pesan } = pasang();
    await act(() => r.result.current.kirim.kirimFoto(berkas));
    expect(data.unggah).toHaveBeenCalledWith('sesi-1', berkas);
    expect(data.lampiran).toHaveBeenCalledWith(expect.objectContaining({ sesiId: 'sesi-1', lampiran: { kunci: 'k' } }));
    expect(pesan.gabung).toHaveBeenCalledWith([{ id: 'f1' }]);
    expect(data.bot).not.toHaveBeenCalled();
    expect(r.result.current.kirim.mengirimFoto).toBe(false);
  });

  it('galat unggah / route / sesi tampil sebagai pemberitahuan', async () => {
    const { r, pastikanSesi, isiPemberitahuan } = pasang();
    data.unggah.mockRejectedValueOnce(new Error('Hanya foto JPG, PNG, atau WEBP'));
    await act(() => r.result.current.kirim.kirimFoto(berkas));
    data.unggah.mockResolvedValue({ kunci: 'k' });
    data.lampiran.mockResolvedValueOnce({ data: null, error: { jenis: 'http', pesan: 'Ukuran maksimal 5 MB', asli: null } });
    await act(() => r.result.current.kirim.kirimFoto(berkas));
    pastikanSesi.mockResolvedValueOnce({ data: null, error: { jenis: 'database', pesan: 'Sesi gagal', asli: null } });
    await act(() => r.result.current.kirim.kirimFoto(berkas));
    expect(isiPemberitahuan()).toEqual(['Hanya foto JPG, PNG, atau WEBP', 'Ukuran maksimal 5 MB', 'Sesi gagal']);
  });
});

describe('useKirim: Hubungkan ke Petugas', () => {
  it('hanya pada mode bot dengan sesi', async () => {
    const { r } = pasang({ status: 'aktif' });
    await act(() => r.result.current.kirim.mintaPetugas());
    expect(data.petugas).not.toHaveBeenCalled();
  });

  it('diterima: pesan server digabung dan status diterapkan; luar jam tanpa pesan: teks tunggu', async () => {
    const { r, pesan, isiPemberitahuan } = pasang();
    data.petugas.mockResolvedValueOnce({ data: { jenis: 'diterima', pesan: { id: 'sys' }, menungguLuarJam: true, status: 'eskalasi' }, error: null });
    await act(() => r.result.current.kirim.mintaPetugas());
    expect(data.petugas).toHaveBeenCalledWith('sesi-1');
    expect(pesan.gabung).toHaveBeenCalledWith([{ id: 'sys' }]);
    expect(r.result.current.mesin.keadaan.status).toBe('eskalasi');
    expect(isiPemberitahuan()).toEqual([]);

    act(() => r.result.current.mesin.kirim({ jenis: 'status', status: 'bot' }));
    data.petugas.mockResolvedValueOnce({ data: { jenis: 'diterima', pesan: null, menungguLuarJam: true, status: null }, error: null });
    await act(() => r.result.current.kirim.mintaPetugas());
    expect(isiPemberitahuan()).toEqual([TEKS_MENUNGGU_PETUGAS]);
  });

  it('409 migrasi: jalur lama mengirim pertanyaan ke bot; ditolak / jaringan: pemberitahuan', async () => {
    const { r, isiPemberitahuan } = pasang();
    data.petugas.mockResolvedValueOnce({ data: { jenis: 'migrasi_belum' }, error: null });
    await act(() => r.result.current.kirim.mintaPetugas());
    expect(data.bot).toHaveBeenCalledWith({ pertanyaan: TEKS_MINTA_PETUGAS_LAMA, layananId: L, sesiId: 'sesi-1' });

    data.petugas.mockResolvedValueOnce({ data: { jenis: 'ditolak', pesan: 'Sesi sudah selesai' }, error: null });
    await act(() => r.result.current.kirim.mintaPetugas());
    data.petugas.mockResolvedValueOnce({ data: { jenis: 'ditolak', pesan: null }, error: null });
    await act(() => r.result.current.kirim.mintaPetugas());
    data.petugas.mockResolvedValueOnce({ data: null, error: { jenis: 'jaringan', pesan: '', asli: null } });
    await act(() => r.result.current.kirim.mintaPetugas());
    expect(isiPemberitahuan()).toEqual([
      'Sesi sudah selesai',
      'Gagal menghubungkan ke petugas. Silakan coba lagi.',
      'Gagal menghubungkan ke petugas. Periksa koneksi Anda lalu coba lagi.',
    ]);
  });
});
