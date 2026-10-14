// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { replayQueue } from './replay';
import { clearQueue, enqueueAction, getQueue, markSynced } from './queue';
import { pesanHasilReplay } from './tutup';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

const param = (id: string, nama = 'Budi') => ({
  p_nama: nama,
  p_asal_instansi: 'PT Maju',
  p_kontak_hp: null,
  p_kategori: null,
  p_email: null,
  p_keperluan: null,
  p_layanan_saran_id: null,
  p_client_request_id: id,
});

type Rpc = ReturnType<typeof vi.fn>;
const klien = (rpc: Rpc) => ({ rpc }) as unknown as Parameters<typeof replayQueue>[1];
const ok = (o: Record<string, unknown> = {}) => ({
  data: { ok: true, sudah_ada: false, kunjungan_id: 'k-1', penanganan_id: 'p-1', qr_token: 'q', ...o },
  error: null,
});
const galat = (kode: string, code = 'P0001') => ({ data: null, error: { message: `${kode}: x`, code } });

describe('replayQueue antrean offline FO (T3)', () => {
  beforeEach(async () => {
    await clearQueue();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('antrean kosong -> synced 0, failed 0 tanpa memanggil rpc', async () => {
    const rpc = vi.fn();
    expect(await replayQueue('user-a', klien(rpc))).toEqual({ synced: 0, failed: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('memutar fo_mulai_kunjungan dengan p_client_request_id YANG SAMA seperti saat didaftarkan', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_A), owner_user_id: 'user-a' });
    const rpc = vi.fn().mockResolvedValue(ok());
    const r = await replayQueue('user-a', klien(rpc));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('fo_mulai_kunjungan', param(ID_A));
    expect(r).toEqual({ synced: 1, failed: 0 });
    expect(await getQueue()).toHaveLength(0); // item tersinkron dihapus (tanpa data berlebih)
  });

  it("'sudah_ada' (respons asli hilang, id sama) dihitung SUKSES, bukan gagal/duplikat", async () => {
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_A), owner_user_id: 'user-a' });
    const rpc = vi.fn().mockResolvedValue(ok({ sudah_ada: true }));
    expect(await replayQueue('user-a', klien(rpc))).toEqual({ synced: 1, failed: 0 });
    expect(await getQueue()).toHaveLength(0);
  });

  it('TIDAK memutar item milik akun lain di perangkat bersama; item itu tetap menunggu pemiliknya', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_A, 'Milik A'), owner_user_id: 'user-a' });
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_B, 'Milik B'), owner_user_id: 'user-b' });
    const rpc = vi.fn().mockResolvedValue(ok());

    const r = await replayQueue('user-a', klien(rpc));

    expect(r.synced).toBe(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_client_request_id).toBe(ID_A);
    const sisa = await getQueue();
    expect(sisa).toHaveLength(1);
    expect(sisa[0].owner_user_id).toBe('user-b');
    expect(sisa[0].synced).toBe(0);
  });

  it('tanpa pemilik (belum login) tidak memutar apa pun', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_A), owner_user_id: 'user-a' });
    const rpc = vi.fn().mockResolvedValue(ok());
    for (const owner of [null, undefined, '']) {
      expect(await replayQueue(owner, klien(rpc))).toEqual({ synced: 0, failed: 0 });
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(await getQueue()).toHaveLength(1);
  });

  it('galat jaringan / FORBIDDEN / SESI_TIDAK_SAH: item TETAP di antrean (failed), dicoba lagi nanti', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_A), owner_user_id: 'user-a' });
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_B), owner_user_id: 'user-a' });
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_C), owner_user_id: 'user-a' });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } })
      .mockResolvedValueOnce(galat('FORBIDDEN', '42501'))
      .mockResolvedValueOnce(galat('SESI_TIDAK_SAH', '42501'));

    const r = await replayQueue('user-a', klien(rpc));

    expect(r).toEqual({ synced: 0, failed: 3 });
    expect(await getQueue()).toHaveLength(3);
  });

  it('rpc yang melempar (fetch putus) = gagal, item tetap', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_A), owner_user_id: 'user-a' });
    const rpc = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await replayQueue('user-a', klien(rpc))).toEqual({ synced: 0, failed: 1 });
    expect(await getQueue()).toHaveLength(1);
  });

  it('galat PERMANEN (LAYANAN_TUTUP, DATA_TIDAK_VALID) dibuang dan dilaporkan sebagai ditolak', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_A), owner_user_id: 'user-a' });
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_B), owner_user_id: 'user-a' });
    const rpc = vi.fn().mockResolvedValueOnce(galat('LAYANAN_TUTUP')).mockResolvedValueOnce(galat('DATA_TIDAK_VALID', '22023'));

    const r = await replayQueue('user-a', klien(rpc));

    expect(r).toEqual({ synced: 0, failed: 0, ditolak: 2 });
    expect(await getQueue()).toHaveLength(0);
    expect(pesanHasilReplay(r)).toMatch(/2 pendaftaran walk-in offline ditolak/);
  });

  it('payload rusak di IndexedDB dibuang (tidak pernah dikirim ke server)', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: { p_nama: 'tanpa id' }, owner_user_id: 'user-a' });
    const rpc = vi.fn();
    const r = await replayQueue('user-a', klien(rpc));
    expect(rpc).not.toHaveBeenCalled();
    expect(r.ditolak).toBe(1);
    expect(await getQueue()).toHaveLength(0);
  });

  it('hanya kolom yang dikenal yang dikirim (data berlebih di payload dibuang)', async () => {
    await enqueueAction({
      type: 'fo_walkin',
      payload: { ...param(ID_A), nik: '3201xxxxxxxx', catatan_rahasia: 'x' },
      owner_user_id: 'user-a',
    });
    const rpc = vi.fn().mockResolvedValue(ok());
    await replayQueue('user-a', klien(rpc));
    expect(rpc.mock.calls[0][1]).toEqual(param(ID_A));
  });

  it('rekaman tipe lama (checkin/investasi_lead/umkm_inquiry) dibuang, termasuk milik akun lain', async () => {
    const db = await import('./queue');
    // Simulasikan rekaman dari versi aplikasi lama langsung di IndexedDB lewat enqueue lalu ubah tipenya.
    const id = await enqueueAction({ type: 'fo_walkin', payload: {}, owner_user_id: 'user-b' });
    const tx = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open('lmh-offline', 2);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    await new Promise<void>((res, rej) => {
      const t = tx.transaction('queue', 'readwrite');
      const s = t.objectStore('queue');
      const g = s.get(id);
      g.onsuccess = () => {
        s.put({ ...g.result, type: 'checkin' });
      };
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
    tx.close();
    expect((await db.getQueue())[0].type).toBe('checkin');

    const rpc = vi.fn();
    await replayQueue('user-a', klien(rpc));
    expect(rpc).not.toHaveBeenCalled();
    expect(await getQueue()).toHaveLength(0);
  });

  it('rekaman dari hari sebelumnya (WIB) kedaluwarsa: dibuang, tidak didaftarkan dengan tanggal salah', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_A), owner_user_id: 'user-a' });
    // Pindahkan jam ke 2 hari kemudian setelah item dibuat.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * 24 * 3600 * 1000);
    const rpc = vi.fn().mockResolvedValue(ok());

    const r = await replayQueue('user-a', klien(rpc));

    expect(rpc).not.toHaveBeenCalled();
    expect(r).toEqual({ synced: 0, failed: 0, kedaluwarsa: 1 });
    expect(await getQueue()).toHaveLength(0);
    expect(pesanHasilReplay(r)).toMatch(/dari hari sebelumnya dibuang/);
  });

  it('dua pemanggilan serentak berbagi satu pemutaran (tidak mengirim ganda)', async () => {
    await enqueueAction({ type: 'fo_walkin', payload: param(ID_A), owner_user_id: 'user-a' });
    const rpc = vi.fn().mockResolvedValue(ok());
    const [r1, r2] = await Promise.all([replayQueue('user-a', klien(rpc)), replayQueue('user-a', klien(rpc))]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });

  it('item yang sudah ditandai tersinkron tidak diputar ulang', async () => {
    const id = await enqueueAction({ type: 'fo_walkin', payload: param(ID_A), owner_user_id: 'user-a' });
    await markSynced(id);
    const rpc = vi.fn();
    await replayQueue('user-a', klien(rpc));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('pesanHasilReplay: null bila tidak ada yang ditolak/kedaluwarsa', () => {
    expect(pesanHasilReplay({})).toBeNull();
  });
});
