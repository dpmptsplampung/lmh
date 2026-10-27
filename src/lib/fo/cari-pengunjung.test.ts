import { describe, expect, it, vi } from 'vitest';
import { ambilPengunjung, cariPengunjung, jenisQuery, periksaKetersediaan } from './cari-pengunjung';

const klien = (hasil: unknown | (() => unknown)) => {
  const rpc = vi.fn(async () => (typeof hasil === 'function' ? (hasil as () => unknown)() : hasil));
  return { rpc, supabase: { rpc } as never };
};
const galat = (message: string, code = 'P0001') => klien({ data: null, error: { code, message } }).supabase;

describe('jenisQuery (minimal 3 karakter / 3 digit)', () => {
  it('nama: butuh 3 karakter non-spasi', () => {
    expect(jenisQuery('bu')).toBe('pendek');
    expect(jenisQuery('  bu ')).toBe('pendek');
    expect(jenisQuery('bud')).toBe('nama');
    expect(jenisQuery('Budi Santoso')).toBe('nama');
  });
  it('nomor: butuh 3 digit; pemisah diabaikan', () => {
    expect(jenisQuery('08')).toBe('pendek');
    expect(jenisQuery('081')).toBe('hp');
    expect(jenisQuery('+62 812-34')).toBe('hp');
    expect(jenisQuery('62')).toBe('pendek');
    expect(jenisQuery('')).toBe('pendek');
  });
  it('campuran huruf dan angka dianggap nama', () => {
    expect(jenisQuery('toko 88')).toBe('nama');
  });
});

describe('cariPengunjung', () => {
  const baris = {
    id: 'k-1',
    nama: ' Budi Santoso ',
    hp_samar: '0812****789',
    asal_instansi: 'PT Maju',
    tanggal: '2026-09-01',
  };

  it('query terlalu pendek: tidak memanggil server', async () => {
    const k = klien({ data: [], error: null });
    expect(await cariPengunjung(k.supabase, 'bu')).toEqual({ status: 'ok', hasil: [] });
    expect(k.rpc).not.toHaveBeenCalled();
  });

  it('memanggil RPC dan memetakan paling banyak 5 saran', async () => {
    const k = klien({ data: Array.from({ length: 8 }, (_, i) => ({ ...baris, id: `k-${i}` })), error: null });
    const r = await cariPengunjung(k.supabase, ' Budi ');
    expect(k.rpc).toHaveBeenCalledWith('fo_cari_pengunjung', { p_q: 'Budi' });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.hasil).toHaveLength(5);
    expect(r.hasil[0]).toEqual({ id: 'k-0', nama: 'Budi Santoso', hpSamar: '0812****789', asal: 'PT Maju', tanggal: '2026-09-01' });
  });

  it('baris rusak dibuang; hp_samar kosong diterima', async () => {
    const k = klien({ data: [{ ...baris, hp_samar: null }, { nama: 'x' }, null], error: null });
    const r = await cariPengunjung(k.supabase, 'budi');
    expect(r.status === 'ok' && r.hasil).toEqual([{ id: 'k-1', nama: 'Budi Santoso', hpSamar: '', asal: 'PT Maju', tanggal: '2026-09-01' }]);
  });

  it('RPC belum ada -> tidak_tersedia', async () => {
    expect(await cariPengunjung(galat('Could not find the function public.fo_cari_pengunjung', 'PGRST202'), 'budi')).toEqual({
      status: 'tidak_tersedia',
    });
  });

  it('FORBIDDEN -> tidak_tersedia; SESI_TIDAK_SAH -> sesi; lainnya/exception -> galat', async () => {
    expect(await cariPengunjung(galat('FORBIDDEN: x', '42501'), 'budi')).toEqual({ status: 'tidak_tersedia' });
    expect(await cariPengunjung(galat('SESI_TIDAK_SAH: x', '42501'), 'budi')).toEqual({ status: 'sesi' });
    expect(await cariPengunjung(galat('x', '08006'), 'budi')).toEqual({ status: 'galat' });
    const meledak = klien(() => {
      throw new Error('jaringan');
    });
    expect(await cariPengunjung(meledak.supabase, 'budi')).toEqual({ status: 'galat' });
  });
});

describe('periksaKetersediaan', () => {
  it('RPC ada -> tersedia; belum ada atau bukan FO/admin -> tidak', async () => {
    expect(await periksaKetersediaan(klien({ data: [], error: null }).supabase)).toBe(true);
    expect(await periksaKetersediaan(galat('function does not exist', '42883'))).toBe(false);
    expect(await periksaKetersediaan(galat('FORBIDDEN: x', '42501'))).toBe(false);
  });
  it('galat sementara (jaringan) -> tetap dianggap tersedia', async () => {
    expect(await periksaKetersediaan(galat('x', '08006'))).toBe(true);
  });
});

describe('ambilPengunjung', () => {
  const data = [{ nama: 'Siti Aminah', asal_instansi: 'CV Sentosa', kategori: 'Investor', email: 'siti@yahoo.com', kontak_hp: '081234567890' }];
  it('memetakan identitas lengkap; kategori tak dikenal dikosongkan', async () => {
    const k = klien({ data, error: null });
    expect(await ambilPengunjung(k.supabase, 'k-1')).toEqual({
      status: 'ok',
      data: { nama: 'Siti Aminah', asal_instansi: 'CV Sentosa', kategori: 'Investor', email: 'siti@yahoo.com', kontak_hp: '081234567890' },
    });
    expect(k.rpc).toHaveBeenCalledWith('fo_ambil_pengunjung', { p_id: 'k-1' });
    const r = await ambilPengunjung(klien({ data: [{ ...data[0], kategori: 'Aneh', email: null, kontak_hp: null }], error: null }).supabase, 'k-1');
    expect(r.status === 'ok' && r.data).toMatchObject({ kategori: '', email: '', kontak_hp: '' });
  });
  it('kode galat dipetakan', async () => {
    expect(await ambilPengunjung(galat('NOT_FOUND: x', 'P0002'), 'k')).toEqual({ status: 'tidak_ada' });
    expect(await ambilPengunjung(galat('RATE_LIMIT: x', '54000'), 'k')).toEqual({ status: 'dibatasi' });
    expect(await ambilPengunjung(galat('SESI_TIDAK_SAH: x', '42501'), 'k')).toEqual({ status: 'sesi' });
    expect(await ambilPengunjung(galat('boom', '08006'), 'k')).toEqual({ status: 'galat' });
    expect(await ambilPengunjung(klien({ data: [], error: null }).supabase, 'k')).toEqual({ status: 'tidak_ada' });
  });
});
