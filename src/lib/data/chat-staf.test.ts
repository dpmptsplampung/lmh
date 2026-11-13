// Kontrak lapisan data chat staf (tugas 7.1): kolom eksplisit, hasil bertipe yang tidak pernah melempar, dan URL/badan
// permintaan ke /api/chat/* sama dengan halaman lama.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buatFakeSupabase, buatH, punyaOp, type FakeH } from '@/test/fo-supabase-mock';

const unggah = vi.hoisted(() => vi.fn());
vi.mock('@/lib/chat/lampiran-klien', () => ({ unggahLampiranChat: unggah }));

import {
  buatDrafBalasan,
  kirimFotoStaf,
  kirimPesanStaf,
  KOLOM_LAYANAN_CHAT_STAF,
  KOLOM_PROFIL_STAF_CHAT,
  KOLOM_TAHAP_CHAT,
  muatDaftarSesiStaf,
  muatKontakSesi,
  muatLayananChatStaf,
  muatNamaPetugasChat,
  muatPesanSesi,
  muatProfilStafChat,
  muatTopikFoChat,
} from './chat-staf';

let h: FakeH;
const sb = () => buatFakeSupabase(h) as unknown as SupabaseClient;

beforeEach(() => {
  h = buatH();
  unggah.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const balasan = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const stubFetch = (res: unknown) => {
  const f = vi.fn(async () => res);
  vi.stubGlobal('fetch', f);
  return f;
};

describe('kolom eksplisit', () => {
  it('tidak ada select(*) dan kolom profil sama dengan halaman lama', () => {
    expect(KOLOM_PROFIL_STAF_CHAT).toBe('id, role, layanan_id');
    for (const k of [KOLOM_PROFIL_STAF_CHAT, KOLOM_TAHAP_CHAT, KOLOM_LAYANAN_CHAT_STAF]) expect(k).not.toContain('*');
  });
});

describe('muatProfilStafChat', () => {
  it('belum masuk -> data null tanpa kueri petugas', async () => {
    h.user = null;
    expect(await muatProfilStafChat(sb())).toEqual({ data: null, error: null });
    expect(h.log).toHaveLength(0);
  });

  it('memuat baris petugas milik pengguna', async () => {
    h.tabel.petugas = { data: { id: 'p1', role: 'front_office', layanan_id: null }, error: null };
    const r = await muatProfilStafChat(sb());
    expect(r).toEqual({ data: { id: 'p1', role: 'front_office', layanan_id: null }, error: null });
    expect(punyaOp(h.log[0].ops, 'select', KOLOM_PROFIL_STAF_CHAT)).toBe(true);
    expect(punyaOp(h.log[0].ops, 'eq', 'auth_user_id', 'u-saya')).toBe(true);
  });

  it('galat PostgREST = tidak ada profil; promise yang menolak = galat jaringan', async () => {
    h.tabel.petugas = { data: null, error: { message: 'x' } };
    expect(await muatProfilStafChat(sb())).toEqual({ data: null, error: null });
    const rusak = { auth: { getUser: () => Promise.reject(new Error('putus')) } } as unknown as SupabaseClient;
    const r = await muatProfilStafChat(rusak);
    expect(r.error).toMatchObject({ jenis: 'jaringan', pesan: 'putus' });
  });
});

describe('muatDaftarSesiStaf', () => {
  it('RPC ringkas dan tahap terbuka dimuat bersamaan dengan parameter yang benar', async () => {
    h.rpc = () => ({ data: [{ id: 's1' }], error: null });
    h.tabel.penanganan = { data: [{ id: 'pn', chat_sesi_id: 's1' }], error: null };
    const r = await muatDaftarSesiStaf(sb(), { sertakanSelesai: true });
    expect(h.rpcLog).toEqual([{ nama: 'chat_sesi_ringkas', args: { p_limit: 100, p_include_selesai: true } }]);
    expect(punyaOp(h.log[0].ops, 'eq', 'saluran', 'chat')).toBe(true);
    expect(punyaOp(h.log[0].ops, 'in', 'status', ['menunggu', 'berjalan'])).toBe(true);
    expect(r.data).toEqual({ sesi: [{ id: 's1' }], tahap: [{ id: 'pn', chat_sesi_id: 's1' }] });
  });

  it('data RPC null = daftar kosong', async () => {
    h.rpc = () => ({ data: null, error: null });
    expect((await muatDaftarSesiStaf(sb(), { sertakanSelesai: false })).data).toEqual({ sesi: [], tahap: [] });
  });

  it('galat RPC = database (daftar gagal); galat tahap saja = daftar tetap ada, tahap null', async () => {
    h.rpc = () => ({ data: null, error: { message: 'Function not found', code: 'PGRST202' } });
    const gagal = await muatDaftarSesiStaf(sb(), { sertakanSelesai: false });
    expect(gagal.data).toBeNull();
    expect(gagal.error).toMatchObject({ jenis: 'database', pesan: 'Function not found' });

    h.rpc = () => ({ data: [{ id: 's1' }], error: null });
    h.tabel.penanganan = { data: null, error: { message: 'relation tidak ada' } };
    const sebagian = await muatDaftarSesiStaf(sb(), { sertakanSelesai: false });
    expect(sebagian.data).toEqual({ sesi: [{ id: 's1' }], tahap: null });
  });

  it('jaringan putus tidak melempar', async () => {
    const rusak = {
      rpc: () => Promise.reject(new Error('Failed to fetch')),
      from: () => ({ select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) }),
    } as unknown as SupabaseClient;
    const r = await muatDaftarSesiStaf(rusak, { sertakanSelesai: false });
    expect(r.error).toMatchObject({ jenis: 'jaringan', pesan: 'Failed to fetch' });
  });
});

describe('muatKontakSesi', () => {
  it('mengembalikan kontak, null bila kosong, tanpa melempar', async () => {
    h.tabel.chat_sesi = { data: { kontak_pengunjung: 'Ani' }, error: null };
    expect((await muatKontakSesi(sb(), 's1')).data).toBe('Ani');
    expect(punyaOp(h.log[0].ops, 'eq', 'id', 's1')).toBe(true);
    h.tabel.chat_sesi = { data: null, error: null };
    expect((await muatKontakSesi(sb(), 's1')).data).toBeNull();
  });
});

describe('referensi (bentuk Hasil untuk useReferensi)', () => {
  it('layanan: kolom eksplisit, urut nama; galat menjadi pesan string', async () => {
    h.tabel.layanan = { data: [{ id: 'l1', nama: 'A', aktif: true, punya_chat: true }], error: null };
    const r = await muatLayananChatStaf(sb());
    expect(r.data).toHaveLength(1);
    expect(punyaOp(h.log[0].ops, 'select', KOLOM_LAYANAN_CHAT_STAF)).toBe(true);
    expect(punyaOp(h.log[0].ops, 'order', 'nama')).toBe(true);
    h.tabel.layanan = { data: null, error: { message: 'column punya_chat does not exist' } };
    expect(await muatLayananChatStaf(sb())).toEqual({ data: null, error: 'column punya_chat does not exist' });
  });

  it('petugas: id dan nama', async () => {
    h.tabel.petugas = { data: [{ id: 'p1', nama: 'Sari' }], error: null };
    expect((await muatNamaPetugasChat(sb())).data).toEqual([{ id: 'p1', nama: 'Sari' }]);
    expect(punyaOp(h.log[0].ops, 'select', 'id, nama')).toBe(true);
  });

  it('topik FO: aktif, tanpa layanan, urut urut lalu nama', async () => {
    h.tabel.topik_penanganan = { data: [{ id: 't1', nama: 'Informasi', urut: 1 }], error: null };
    const r = await muatTopikFoChat(sb());
    expect(r.data).toEqual([{ id: 't1', nama: 'Informasi', urut: 1 }]);
    const ops = h.log[0].ops;
    expect(punyaOp(ops, 'eq', 'aktif', true)).toBe(true);
    expect(punyaOp(ops, 'is', 'layanan_id', null)).toBe(true);
    expect(ops.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual(['urut', 'nama']);
  });
});

describe('muatPesanSesi', () => {
  it('URL: sesi saja, riwayat, dan riwayat + sebelum (di-encode)', async () => {
    const f = stubFetch(balasan(200, { messages: [{ id: 'm1' }], ada_lebih: true }));
    expect((await muatPesanSesi({ sesiId: 's1' })).data).toEqual({ messages: [{ id: 'm1' }], adaLebih: true });
    await muatPesanSesi({ sesiId: 's1', riwayat: true });
    await muatPesanSesi({ sesiId: 's1', riwayat: true, sebelum: '2026-09-01T01:00:00+00:00' });
    expect(f.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      '/api/chat/messages?sesi_id=s1',
      '/api/chat/messages?sesi_id=s1&riwayat=1',
      `/api/chat/messages?sesi_id=s1&riwayat=1&sebelum=${encodeURIComponent('2026-09-01T01:00:00+00:00')}`,
    ]);
  });

  it('badan tanpa messages = messages null; non-2xx = http; fetch menolak = jaringan', async () => {
    stubFetch(balasan(200, { status: 'aktif' }));
    expect((await muatPesanSesi({ sesiId: 's1' })).data).toEqual({ messages: null, adaLebih: false });
    stubFetch(balasan(403, { error: 'Dilarang' }));
    expect((await muatPesanSesi({ sesiId: 's1' })).error).toMatchObject({ jenis: 'http', pesan: 'Dilarang' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('putus'); }));
    expect((await muatPesanSesi({ sesiId: 's1' })).error).toMatchObject({ jenis: 'jaringan', pesan: 'putus' });
  });
});

describe('kirimPesanStaf', () => {
  it('mengirim badan petugas dengan client_uuid dan mengembalikan pesan server', async () => {
    const f = stubFetch(balasan(200, { message: { id: 'm9' } }));
    const r = await kirimPesanStaf({ sesiId: 's1', isi: 'halo', clientUuid: 'u-1' });
    expect(r.data).toEqual({ message: { id: 'm9' } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/chat/messages');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ sesi_id: 's1', pengirim: 'petugas', isi: 'halo', client_uuid: 'u-1' });
  });

  it('galat route memakai pesannya; tanpa pesan memakai cadangan', async () => {
    stubFetch(balasan(409, { error: 'Bukan pemilik' }));
    expect((await kirimPesanStaf({ sesiId: 's1', isi: 'x', clientUuid: 'u' })).error?.pesan).toBe('Bukan pemilik');
    stubFetch(balasan(500, null));
    expect((await kirimPesanStaf({ sesiId: 's1', isi: 'x', clientUuid: 'u' })).error?.pesan).toBe('Gagal mengirim pesan');
  });
});

describe('kirimFotoStaf', () => {
  const berkas = new File(['x'], 'a.png', { type: 'image/png' });

  it('unggah lalu simpan pesan hanya-lampiran', async () => {
    unggah.mockResolvedValue({ kunci: 'k', nama: 'a.png' });
    const f = stubFetch(balasan(200, { message: { id: 'm1' } }));
    const r = await kirimFotoStaf({ sesiId: 's1', berkas });
    expect(r.data).toEqual({ message: { id: 'm1' } });
    expect(unggah).toHaveBeenCalledWith('s1', berkas);
    const body = JSON.parse(String(((f.mock.calls[0] as unknown) as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ sesi_id: 's1', isi: '', lampiran: { kunci: 'k', nama: 'a.png' } });
    expect(typeof body.client_uuid).toBe('string');
  });

  it('unggahan gagal: pesan galatnya dipakai dan route tidak dipanggil', async () => {
    unggah.mockRejectedValue(new Error('Foto terlalu besar'));
    const f = stubFetch(balasan(200, {}));
    expect((await kirimFotoStaf({ sesiId: 's1', berkas })).error).toMatchObject({ jenis: 'jaringan', pesan: 'Foto terlalu besar' });
    expect(f).not.toHaveBeenCalled();
  });

  it('route menolak: pesan route atau "Foto gagal dikirim"', async () => {
    unggah.mockResolvedValue({});
    stubFetch(balasan(400, { error: 'Bukan pemilik' }));
    expect((await kirimFotoStaf({ sesiId: 's1', berkas })).error?.pesan).toBe('Bukan pemilik');
    stubFetch(balasan(500, {}));
    expect((await kirimFotoStaf({ sesiId: 's1', berkas })).error?.pesan).toBe('Foto gagal dikirim');
  });
});

describe('buatDrafBalasan', () => {
  it('mengembalikan draf; tanpa draf memakai galat route atau cadangan; badan bukan JSON atau jaringan putus = pesan tetap', async () => {
    const f = stubFetch(balasan(200, { draft: 'Terima kasih' }));
    expect((await buatDrafBalasan('s1')).data).toBe('Terima kasih');
    expect(JSON.parse(String(((f.mock.calls[0] as unknown) as [string, RequestInit])[1].body))).toEqual({ sesi_id: 's1' });

    stubFetch(balasan(429, { error: 'Kuota habis' }));
    expect((await buatDrafBalasan('s1')).error?.pesan).toBe('Kuota habis');
    stubFetch(balasan(200, {}));
    expect((await buatDrafBalasan('s1')).error?.pesan).toBe('Gagal membuat draf balasan');
    stubFetch({ ok: true, status: 200, json: async () => { throw new Error('bukan json'); } });
    expect((await buatDrafBalasan('s1')).error).toMatchObject({ jenis: 'jaringan', pesan: 'Gagal memuat draf balasan' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('putus'); }));
    expect((await buatDrafBalasan('s1')).error).toMatchObject({ jenis: 'jaringan', pesan: 'Gagal memuat draf balasan' });
  });
});
