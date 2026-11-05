import { describe, it, expect, vi } from 'vitest';
import {
  muatAntreanFo,
  muatKunjunganFo,
  muatPratinjauReservasi,
  jendelaTanggalFo,
  tanggalDalamJendela,
  pesanJendelaTanggal,
  galatTanggalDiluarBatas,
  type BarisKunjunganFo,
  formatDilayani,
  ambilDilayani,
} from './akses-antrean';

type Hasil = { data: unknown; error: { code?: string; message: string } | null };
const klien = (hasil: Hasil | (() => Hasil)) => {
  const rpc = vi.fn(() => Promise.resolve(typeof hasil === 'function' ? hasil() : hasil));
  return { rpc } as unknown as Parameters<typeof muatAntreanFo>[0] & { rpc: typeof rpc };
};

const barisAntrean = {
  id: 't-1', kunjungan_id: 'k-1', layanan_id: 'l-1', dilayani_oleh: null, penanganan_asal_id: null,
  nomor: 1, nomor_display: 'A-001', status: 'menunggu', waktu_terbit: '2026-11-04T01:00:00Z',
  waktu_mulai_layan: null, waktu_selesai: null,
  layanan: { nama: 'Helpdesk OSS', form_pendataan: 'oss' }, pelayan: null,
  kunjungan: { nama: 'Budi', asal: 'walk_in', waktu_masuk: '2026-11-04T01:00:00Z' }, fo_nama: 'Sari',
};

describe('muatAntreanFo', () => {
  it('memanggil fo_antrean_daftar dengan parameter halaman dan mengembalikan baris, total, statistik', async () => {
    const k = klien({
      data: { rows: [barisAntrean], total: 41, statistik: { totalSelesai: 3, rataWaktuMenit: 12 } },
      error: null,
    });
    const h = await muatAntreanFo(k, { tanggal: '2026-11-04', batas: 25, lewati: 50 });
    expect(k.rpc).toHaveBeenCalledWith('fo_antrean_daftar', {
      p_tanggal: '2026-11-04', p_layanan_id: null, p_batas: 25, p_lewati: 50,
    });
    expect(h).toEqual({
      tersedia: true,
      data: { rows: [barisAntrean], total: 41, statistik: { totalSelesai: 3, rataWaktuMenit: 12 } },
    });
  });

  it('objek belum ada (PGRST202) -> tersedia:false agar halaman memakai kueri lama', async () => {
    const h = await muatAntreanFo(klien({ data: null, error: { code: 'PGRST202', message: 'tidak ada' } }), {
      tanggal: '2026-11-04', batas: 25, lewati: 0,
    });
    expect(h).toEqual({ tersedia: false });
  });

  it('galat lain (FORBIDDEN) dilempar, bukan disamarkan menjadi daftar kosong', async () => {
    await expect(
      muatAntreanFo(klien({ data: null, error: { code: '42501', message: 'FORBIDDEN: bukan staf' } }), {
        tanggal: '2026-11-04', batas: 25, lewati: 0,
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('respons yang bentuknya salah dilempar sebagai galat', async () => {
    await expect(
      muatAntreanFo(klien({ data: { rows: 'x' }, error: null }), { tanggal: '2026-11-04', batas: 25, lewati: 0 }),
    ).rejects.toThrow(/antrean/i);
  });
});

describe('muatKunjunganFo', () => {
  const baris: BarisKunjunganFo = {
    id: 'k-1', nama: 'Budi', asal: 'walk_in', status: 'selesai', waktu_masuk: '2026-11-04T01:00:00Z',
    tanggal: '2026-11-04', fo_nama: 'Sari',
    tiket_antrean: [{ nomor_display: 'A-001', waktu_selesai: null, layanan: { nama: 'Helpdesk OSS' } }],
  };
  const dasar = { tanggal: '2026-11-04', batas: 25, lewati: 0 };

  it('mengirim p_cari dan p_status ke RPC, mengembalikan baris dan total terfilter dari server', async () => {
    const k = klien({ data: { rows: [baris], total: 1 }, error: null });
    const h = await muatKunjunganFo(k, { ...dasar, cari: '  budi ', status: 'selesai' });
    expect(k.rpc).toHaveBeenCalledTimes(1);
    expect(k.rpc).toHaveBeenCalledWith('fo_kunjungan_daftar', {
      p_tanggal: '2026-11-04', p_batas: 25, p_lewati: 0, p_cari: 'budi', p_status: 'selesai',
    });
    expect(h).toEqual({ tersedia: true, data: { rows: [baris], total: 1, disaringServer: true } });
  });

  it('tanpa filter: p_cari dan p_status null (cari kosong/spasi dan status "semua" = tanpa filter)', async () => {
    const k = klien({ data: { rows: [baris], total: 1 }, error: null });
    await muatKunjunganFo(k, { ...dasar, cari: '   ', status: 'semua' });
    expect(k.rpc).toHaveBeenCalledWith('fo_kunjungan_daftar', {
      p_tanggal: '2026-11-04', p_batas: 25, p_lewati: 0, p_cari: null, p_status: null,
    });
  });

  it('p_cari dipangkas ke 100 karakter agar tidak ditolak server', async () => {
    const k = klien({ data: { rows: [], total: 0 }, error: null });
    await muatKunjunganFo(k, { ...dasar, cari: 'x'.repeat(150) });
    const args = (k.rpc.mock.calls[0] as unknown as [string, { p_cari: string }])[1];
    expect(args.p_cari).toHaveLength(100);
  });

  it('RPC lama tanpa p_cari/p_status (PGRST202) -> ulangi bentuk 3 argumen, ditandai belum disaring server', async () => {
    const hasil = [
      { data: null, error: { code: 'PGRST202', message: 'tidak ada' } },
      { data: { rows: [baris], total: 40 }, error: null },
    ];
    const k = klien(() => hasil.shift() as Hasil);
    const h = await muatKunjunganFo(k, { ...dasar, cari: 'budi', status: 'selesai' });
    expect(k.rpc).toHaveBeenNthCalledWith(2, 'fo_kunjungan_daftar', { p_tanggal: '2026-11-04', p_batas: 25, p_lewati: 0 });
    expect(h).toEqual({ tersedia: true, data: { rows: [baris], total: 40, disaringServer: false } });
  });

  it('objek belum ada (42883) pada kedua bentuk -> tersedia:false', async () => {
    const k = klien({ data: null, error: { code: '42883', message: 'fungsi tidak ada' } });
    expect(await muatKunjunganFo(k, dasar)).toEqual({ tersedia: false });
    expect(k.rpc).toHaveBeenCalledTimes(2);
  });

  it('galat selain objek belum ada dilempar tanpa mencoba bentuk lama', async () => {
    const k = klien({ data: null, error: { code: '42501', message: 'FORBIDDEN: bukan staf' } });
    await expect(muatKunjunganFo(k, dasar)).rejects.toMatchObject({ code: '42501' });
    expect(k.rpc).toHaveBeenCalledTimes(1);
  });

  it('respons bentuk salah dilempar', async () => {
    await expect(muatKunjunganFo(klien({ data: { rows: 1 }, error: null }), dasar)).rejects.toThrow(/kunjungan/i);
  });

  it('meneruskan AbortSignal ke permintaan bila builder mendukungnya', async () => {
    const abortSignal = vi.fn();
    const q = Object.assign(Promise.resolve({ data: { rows: [], total: 0 }, error: null }), { abortSignal });
    abortSignal.mockReturnValue(q);
    const rpc = vi.fn(() => q);
    const ctl = new AbortController();
    await muatKunjunganFo({ rpc } as unknown as Parameters<typeof muatKunjunganFo>[0], { ...dasar, signal: ctl.signal });
    expect(abortSignal).toHaveBeenCalledWith(ctl.signal);
  });
});

describe('jendela tanggal Front Office non-Koordinator', () => {
  const hariIni = '2026-11-04';
  it('FO biasa: [hari ini-7, hari ini+1]; Admin, Koordinator, petugas, dan peran belum diketahui: bebas', () => {
    expect(jendelaTanggalFo({ role: 'front_office', koordinator: false }, hariIni)).toEqual({ min: '2026-10-28', max: '2026-11-05' });
    expect(jendelaTanggalFo({ role: 'front_office' }, hariIni)).toEqual({ min: '2026-10-28', max: '2026-11-05' });
    expect(jendelaTanggalFo({ role: 'front_office', koordinator: true }, hariIni)).toBeNull();
    expect(jendelaTanggalFo({ role: 'admin', koordinator: false }, hariIni)).toBeNull();
    expect(jendelaTanggalFo({ role: 'petugas', koordinator: false }, hariIni)).toBeNull();
    expect(jendelaTanggalFo(null, hariIni)).toBeNull();
  });
  it('tanggalDalamJendela: batas inklusif; tanpa jendela selalu benar; tanggal kosong/aneh salah', () => {
    const j = { min: '2026-10-28', max: '2026-11-05' };
    expect(tanggalDalamJendela('2026-10-28', j)).toBe(true);
    expect(tanggalDalamJendela('2026-11-05', j)).toBe(true);
    expect(tanggalDalamJendela('2026-10-27', j)).toBe(false);
    expect(tanggalDalamJendela('2026-11-06', j)).toBe(false);
    expect(tanggalDalamJendela('2020-01-01', null)).toBe(true);
    expect(tanggalDalamJendela('', j)).toBe(false);
  });
  it('pesan jelas menyebut rentang tanggal dan siapa yang dapat membukakan tanggal lain', () => {
    const t = pesanJendelaTanggal({ min: '2026-10-28', max: '2026-11-05' });
    expect(t).toMatch(/28 Okt/);
    expect(t).toMatch(/5 Nov/);
    expect(t).toMatch(/Koordinator atau Admin/);
  });
  it('pesan tanpa jendela (peran belum diketahui) tetap jelas', () => {
    expect(pesanJendelaTanggal(null)).toMatch(/7 hari ke belakang sampai besok/);
  });
  it('galatTanggalDiluarBatas mengenali pesan server TANGGAL_DILUAR_BATAS', () => {
    expect(galatTanggalDiluarBatas({ code: '22023', message: 'TANGGAL_DILUAR_BATAS: x' })).toBe(true);
    expect(galatTanggalDiluarBatas({ code: '22023', message: 'MASUKAN_TIDAK_VALID' })).toBe(false);
    expect(galatTanggalDiluarBatas(null)).toBe(false);
  });
});

describe('muatPratinjauReservasi', () => {
  it('memangkas token dan mengembalikan pratinjau aman', async () => {
    const data = {
      id: 'k-1', nama: 'Budi', tanggal: '2026-11-04', status: 'terjadwal', jam_rencana: '09:00:00',
      layanan_saran_id: 'l-1', layanan_nama: 'Helpdesk OSS',
    };
    const k = klien({ data, error: null });
    const h = await muatPratinjauReservasi(k, '  tok-123  ');
    expect(k.rpc).toHaveBeenCalledWith('fo_pratinjau_reservasi', { p_qr_token: 'tok-123' });
    expect(h).toEqual({ tersedia: true, data });
  });

  it('token tidak dikenal (null) -> tersedia:true, data:null', async () => {
    const h = await muatPratinjauReservasi(klien({ data: null, error: null }), 'x');
    expect(h).toEqual({ tersedia: true, data: null });
  });

  it('objek belum ada -> tersedia:false', async () => {
    const h = await muatPratinjauReservasi(klien({ data: null, error: { code: 'PGRST202', message: 'x' } }), 'x');
    expect(h).toEqual({ tersedia: false });
  });
});

describe('formatDilayani', () => {
  it('menulis "45 / 120 (37,5%)" dengan koma desimal Indonesia', () => {
    expect(formatDilayani({ saya: 45, total: 120, persen: 37.5 })).toBe('45 / 120 (37,5%)');
  });
  it('persen dua desimal dibulatkan ke satu desimal; bilangan bulat tanpa desimal', () => {
    expect(formatDilayani({ saya: 1, total: 3, persen: 33.33 })).toBe('1 / 3 (33,3%)');
    expect(formatDilayani({ saya: 120, total: 120, persen: 100 })).toBe('120 / 120 (100%)');
  });
  it('total nol -> 0 / 0 (0%)', () => {
    expect(formatDilayani({ saya: 0, total: 0, persen: 0 })).toBe('0 / 0 (0%)');
  });
  it('ribuan memakai titik', () => {
    expect(formatDilayani({ saya: 1200, total: 4800, persen: 25 })).toBe('1.200 / 4.800 (25%)');
  });
});

describe('ambilDilayani', () => {
  it('mengambil objek dilayani yang valid dari body API', () => {
    expect(ambilDilayani({ dilayani: { saya: 1, total: 2, persen: 50 } })).toEqual({ saya: 1, total: 2, persen: 50 });
  });
  it('null / hilang / bentuk salah -> null (disembunyikan, bukan nol palsu)', () => {
    expect(ambilDilayani({ dilayani: null })).toBeNull();
    expect(ambilDilayani({})).toBeNull();
    expect(ambilDilayani({ dilayani: { saya: 'a', total: 2, persen: 1 } })).toBeNull();
    expect(ambilDilayani({ dilayani: { saya: -1, total: 2, persen: 1 } })).toBeNull();
  });
});
