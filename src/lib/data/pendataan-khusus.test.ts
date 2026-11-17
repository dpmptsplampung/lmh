import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  KOLOM_TIKET_DATA_FO,
  muatDataDariFo,
  muatDefinisiKhusus,
  muatDrafKhusus,
  selesaikanTiketKhusus,
  simpanDrafKhusus,
} from './pendataan-khusus';

type Hasil = { data: unknown; error: { message: string; code?: string } | null };

/** Klien tiruan: rpc menjawab dari tabel nama -> hasil; from(...).select(...).eq(...).maybeSingle() / in(...) dari `tabel`. */
function klien(rpc: Record<string, Hasil> = {}, tabel: Record<string, Hasil> = {}) {
  const rpcFn = vi.fn((nama: string, _args?: unknown) => Promise.resolve(rpc[nama] ?? { data: null, error: { message: `tak dikenal ${nama}` } }));
  const dipilih: string[] = [];
  const from = vi.fn((nama: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['eq', 'in', 'limit', 'order']) b[m] = () => b;
    b.select = (kolom: string) => { dipilih.push(`${nama}:${kolom}`); return b; };
    b.maybeSingle = () => Promise.resolve(tabel[nama] ?? { data: null, error: null });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(tabel[nama] ?? { data: [], error: null }).then(res, rej);
    return b;
  });
  return { sb: { rpc: rpcFn, from } as unknown as SupabaseClient, rpc: rpcFn, dipilih };
}

const FID = 'aaaaaaaa-0000-4000-8000-000000000001';
const BARIS_FIELD = { id: FID, layanan_id: 'l1', label: 'Nomor', jenis: 'angka', wajib: true, opsi: [], urut: 1, tersembunyi: false, pernah_diisi: false };

describe('muatDefinisiKhusus', () => {
  it('memanggil RPC dengan p_layanan dan memetakan isian terlihat', async () => {
    const { sb, rpc } = klien({ pendataan_khusus_definisi: { data: [BARIS_FIELD, { ...BARIS_FIELD, id: 'x', tersembunyi: true }], error: null } });
    const h = await muatDefinisiKhusus(sb, 'l1');
    expect(rpc).toHaveBeenCalledWith('pendataan_khusus_definisi', { p_layanan: 'l1' });
    expect(h.data?.tersedia).toBe(true);
    expect(h.data?.fields.map((f) => f.id)).toEqual([FID]);
  });

  it('hasil kosong = tersedia tanpa isian (saklar mati / tanpa isian aktif)', async () => {
    const { sb } = klien({ pendataan_khusus_definisi: { data: [], error: null } });
    expect((await muatDefinisiKhusus(sb, 'l1')).data).toEqual({ fields: [], tersedia: true });
  });

  it('fungsi belum ada (migrasi belum diterapkan): tersedia false, bukan galat', async () => {
    const { sb } = klien({ pendataan_khusus_definisi: { data: null, error: { code: 'PGRST202', message: 'tidak ada' } } });
    expect((await muatDefinisiKhusus(sb, 'l1')).data).toEqual({ fields: [], tersedia: false });
  });

  it('galat lain dikembalikan sebagai hasil bertipe dan tidak melempar', async () => {
    const { sb } = klien({ pendataan_khusus_definisi: { data: null, error: { code: '42501', message: 'FORBIDDEN' } } });
    const h = await muatDefinisiKhusus(sb, 'l1');
    expect(h.data).toBeNull();
    expect(h.error?.asli).toMatchObject({ message: 'FORBIDDEN' });
  });
});

describe('muatDrafKhusus', () => {
  it('tanpa draf (null) = data null tanpa galat', async () => {
    const { sb, rpc } = klien({ pendataan_khusus_draf_baca: { data: null, error: null } });
    expect(await muatDrafKhusus(sb, 't1')).toEqual({ data: null, error: null });
    expect(rpc).toHaveBeenCalledWith('pendataan_khusus_draf_baca', { p_tiket: 't1' });
  });

  it('draf ada: jawaban per UUID dan updated_at', async () => {
    const { sb } = klien({ pendataan_khusus_draf_baca: { data: { tiket_id: 't1', jawaban: { [FID]: 5 }, updated_at: '2026-11-17T01:00:00Z' }, error: null } });
    expect((await muatDrafKhusus(sb, 't1')).data).toEqual({ jawaban: { [FID]: 5 }, updatedAt: '2026-11-17T01:00:00Z' });
  });

  it('jawaban bukan objek menjadi {}; galat RPC dikembalikan', async () => {
    const a = klien({ pendataan_khusus_draf_baca: { data: { jawaban: [1] }, error: null } });
    expect((await muatDrafKhusus(a.sb, 't1')).data?.jawaban).toEqual({});
    const b = klien({ pendataan_khusus_draf_baca: { data: null, error: { message: 'NOT_FOUND: x' } } });
    expect((await muatDrafKhusus(b.sb, 't1')).error).not.toBeNull();
  });
});

describe('simpanDrafKhusus', () => {
  it('mengirim p_tiket dan p_jawaban (penggantian penuh) dan mengembalikan updated_at', async () => {
    const { sb, rpc } = klien({ pendataan_khusus_draf_simpan: { data: { ok: true, updated_at: '2026-11-17T01:00:05Z' }, error: null } });
    const h = await simpanDrafKhusus(sb, 't1', { [FID]: 0 });
    expect(rpc).toHaveBeenCalledWith('pendataan_khusus_draf_simpan', { p_tiket: 't1', p_jawaban: { [FID]: 0 } });
    expect(h).toEqual({ data: { updatedAt: '2026-11-17T01:00:05Z' }, error: null });
  });

  it('balasan kosong tanpa galat bukan sukses; galat RPC dikembalikan', async () => {
    expect((await simpanDrafKhusus(klien({ pendataan_khusus_draf_simpan: { data: null, error: null } }).sb, 't1', {})).error).not.toBeNull();
    const h = await simpanDrafKhusus(klien({ pendataan_khusus_draf_simpan: { data: null, error: { message: 'BUKAN_PEMILIK: x' } } }).sb, 't1', {});
    expect(h.error?.asli).toMatchObject({ message: 'BUKAN_PEMILIK: x' });
  });
});

describe('selesaikanTiketKhusus', () => {
  const dasar = { tiketId: 't1', topikId: null, catatan: null, khusus: null, identitas: null };

  it('jalur baru: layanan_selesai_khusus dengan p_khusus (BUKAN p_jawaban); p_identitas hanya bila ada', async () => {
    const { sb, rpc } = klien({ layanan_selesai_khusus: { data: { ok: true }, error: null } });
    await selesaikanTiketKhusus(sb, { ...dasar, khusus: { [FID]: 1 }, identitas: { email: 'a@b.id' } });
    expect(rpc).toHaveBeenCalledWith('layanan_selesai_khusus', {
      p_tiket_id: 't1', p_topik_id: null, p_catatan: null, p_khusus: { [FID]: 1 }, p_identitas: { email: 'a@b.id' },
    });
    rpc.mockClear();
    await selesaikanTiketKhusus(sb, dasar);
    const argumen = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(argumen).toEqual({ p_tiket_id: 't1', p_topik_id: null, p_catatan: null, p_khusus: null });
    expect('p_jawaban' in argumen).toBe(false);
    expect('p_identitas' in argumen).toBe(false);
  });

  it('jalur lama (migrasi belum ada), tanpa identitas/khusus: layanan_selesai dengan topik/catatan bila ada', async () => {
    const { sb, rpc } = klien({ layanan_selesai: { data: { ok: true }, error: null } });
    await selesaikanTiketKhusus(sb, { ...dasar, topikId: 'tp', catatan: 'selesai' }, true);
    expect(rpc).toHaveBeenCalledWith('layanan_selesai', { p_tiket_id: 't1', p_topik_id: 'tp', p_catatan: 'selesai' });
    rpc.mockClear();
    await selesaikanTiketKhusus(sb, dasar, true);
    expect(rpc).toHaveBeenCalledWith('layanan_selesai', { p_tiket_id: 't1' });
  });

  it('jalur lama tetap memakai layanan_selesai_khusus bila ada identitas (email)', async () => {
    const { sb, rpc } = klien({ layanan_selesai_khusus: { data: { ok: true }, error: null } });
    await selesaikanTiketKhusus(sb, { ...dasar, identitas: { email: 'a@b.id' } }, true);
    expect(rpc.mock.calls[0][0]).toBe('layanan_selesai_khusus');
  });

  it('peringatan diteruskan; balasan kosong dan galat bukan sukses', async () => {
    const a = await selesaikanTiketKhusus(klien({ layanan_selesai_khusus: { data: { ok: true, peringatan: 'awas' }, error: null } }).sb, dasar);
    expect(a.data).toEqual({ peringatan: 'awas' });
    const b = await selesaikanTiketKhusus(klien({ layanan_selesai_khusus: { data: null, error: null } }).sb, dasar);
    expect(b.error).not.toBeNull();
    const c = await selesaikanTiketKhusus(klien({ layanan_selesai_khusus: { data: null, error: { message: 'KHUSUS_WAJIB: x' } } }).sb, dasar);
    expect(c.error?.asli).toMatchObject({ message: 'KHUSUS_WAJIB: x' });
  });
});

describe('muatDataDariFo', () => {
  const tiket = {
    id: 't1', penanganan_asal_id: null, waktu_terbit: '2026-11-17T01:00:00Z',
    kunjungan: { nama: 'Rina', kontak_hp: '0812', email: 'r@x.id', asal_instansi: 'PT A', kategori: 'umum', keperluan: 'Urus NIB', asal: 'walk_in', waktu_masuk: '2026-11-17T00:55:00Z', pencatat: { nama: 'Sari FO' } },
  };

  it('memilih kolom eksplisit (tanpa *) dan memetakan identitas, keperluan, pencatat, jam daftar', async () => {
    const { sb, dipilih } = klien({}, { tiket_antrean: { data: tiket, error: null } });
    const h = await muatDataDariFo(sb, 't1');
    expect(dipilih[0]).toBe(`tiket_antrean:${KOLOM_TIKET_DATA_FO}`);
    expect(KOLOM_TIKET_DATA_FO).not.toContain('*');
    expect(h.data).toMatchObject({
      nama: 'Rina', kontakHp: '0812', email: 'r@x.id', keperluan: 'Urus NIB', pencatatNama: 'Sari FO',
      waktuDaftar: '2026-11-17T00:55:00Z', hasilEskalasi: false, eskalasi: null,
    });
  });

  it('tiket hasil eskalasi: catatan eskalasi dan nama FO dari tahap asal', async () => {
    const { sb } = klien({}, {
      tiket_antrean: { data: { ...tiket, penanganan_asal_id: 'pn1', kunjungan: { ...tiket.kunjungan, pencatat: null } }, error: null },
      penanganan: { data: [{ id: 'pn1', topik: 'Konsultasi', catatan: 'Perlu verifikasi', penangan: { nama: 'Budi FO' } }], error: null },
    });
    const h = await muatDataDariFo(sb, 't1');
    expect(h.data?.hasilEskalasi).toBe(true);
    expect(h.data?.eskalasi).toEqual({ topik: 'Konsultasi', catatan: 'Perlu verifikasi', foNama: 'Budi FO' });
    expect(h.data?.pencatatNama).toBe('Budi FO');
  });

  it('tiket tidak terlihat (RLS) = data null tanpa galat; galat kueri dikembalikan', async () => {
    expect(await muatDataDariFo(klien({}, { tiket_antrean: { data: null, error: null } }).sb, 't1')).toEqual({ data: null, error: null });
    const h = await muatDataDariFo(klien({}, { tiket_antrean: { data: null, error: { message: 'boom' } } }).sb, 't1');
    expect(h.error).not.toBeNull();
  });
});
