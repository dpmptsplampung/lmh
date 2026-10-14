import { describe, expect, it, vi } from 'vitest';
import { GalatRpc, kodeDariPesan } from '@/lib/rpc-galat';
import {
  WALKIN_KOSONG,
  bacaParamTersimpan,
  bangunParamFoMulai,
  galatFoMulaiPermanen,
  panggilFoMulaiKunjungan,
  pesanGalatFoMulai,
  validasiWalkin,
  type DataWalkin,
} from './walkin';

const ID = '11111111-1111-4111-8111-111111111111';
const valid: DataWalkin = { ...WALKIN_KOSONG, nama: 'Budi Santoso', asal_instansi: 'PT Maju' };

describe('kodeDariPesan', () => {
  it('mengambil KODE di awal pesan', () => {
    expect(kodeDariPesan('LAYANAN_TUTUP: Layanan sudah tutup')).toBe('LAYANAN_TUTUP');
    expect(kodeDariPesan('SUDAH_DIAMBIL')).toBe('SUDAH_DIAMBIL');
    expect(kodeDariPesan('TypeError: Failed to fetch')).toBeNull();
    expect(kodeDariPesan('permission denied for table x')).toBeNull();
    expect(kodeDariPesan(undefined)).toBeNull();
  });
});

describe('validasiWalkin', () => {
  it('data minimal (nama + asal) lolos', () => {
    expect(validasiWalkin(valid)).toEqual({});
  });

  it('nama 3–120 dan asal 2–200 wajib', () => {
    expect(validasiWalkin({ ...valid, nama: 'Bu' }).nama).toBeDefined();
    expect(validasiWalkin({ ...valid, nama: '   ' }).nama).toBeDefined();
    expect(validasiWalkin({ ...valid, nama: 'x'.repeat(121) }).nama).toBeDefined();
    expect(validasiWalkin({ ...valid, asal_instansi: 'A' }).asal_instansi).toBeDefined();
    expect(validasiWalkin({ ...valid, asal_instansi: 'x'.repeat(201) }).asal_instansi).toBeDefined();
    expect(validasiWalkin({ ...valid, nama: 'Bud' }).nama).toBeUndefined();
  });

  it('HP opsional; spasi/strip dibuang sebelum diperiksa; format 08/62/+62', () => {
    expect(validasiWalkin({ ...valid, kontak_hp: '' }).kontak_hp).toBeUndefined();
    expect(validasiWalkin({ ...valid, kontak_hp: '0812-3456 7890' }).kontak_hp).toBeUndefined();
    expect(validasiWalkin({ ...valid, kontak_hp: '+6281234567890' }).kontak_hp).toBeUndefined();
    expect(validasiWalkin({ ...valid, kontak_hp: '12345' }).kontak_hp).toBeDefined();
    expect(validasiWalkin({ ...valid, kontak_hp: 'abc08123456789' }).kontak_hp).toBeDefined();
  });

  it('kategori harus salah satu kunci kategori pengunjung; email dan keperluan dibatasi', () => {
    for (const k of ['Umum', 'UMKM', 'Investor', 'Instansi']) {
      expect(validasiWalkin({ ...valid, kategori: k }).kategori).toBeUndefined();
    }
    expect(validasiWalkin({ ...valid, kategori: 'umum' }).kategori).toBeDefined();
    expect(validasiWalkin({ ...valid, email: 'bukan-email' }).email).toBeDefined();
    expect(validasiWalkin({ ...valid, email: 'a@b.co' }).email).toBeUndefined();
    expect(validasiWalkin({ ...valid, keperluan: 'x'.repeat(501) }).keperluan).toBeDefined();
    expect(validasiWalkin({ ...valid, keperluan: 'x'.repeat(500) }).keperluan).toBeUndefined();
  });
});

describe('bangunParamFoMulai', () => {
  it('memakai nama parameter kontrak §2.1, nilai kosong -> null, HP dinormalkan, id disertakan', () => {
    expect(
      bangunParamFoMulai(
        { ...valid, nama: '  Budi  ', kontak_hp: '0812 3456-7890', kategori: 'UMKM', layanan_saran_id: 'lay-1' },
        ID,
      ),
    ).toEqual({
      p_nama: 'Budi',
      p_asal_instansi: 'PT Maju',
      p_kontak_hp: '081234567890',
      p_kategori: 'UMKM',
      p_email: null,
      p_keperluan: null,
      p_layanan_saran_id: 'lay-1',
      p_client_request_id: ID,
    });
  });
});

describe('bacaParamTersimpan', () => {
  it('mengembalikan hanya kolom dikenal dan menolak bentuk tidak sah', () => {
    const p = bangunParamFoMulai(valid, ID);
    expect(bacaParamTersimpan({ ...p, ekstra: 'x' })).toEqual(p);
    expect(bacaParamTersimpan(null)).toBeNull();
    expect(bacaParamTersimpan({ ...p, p_client_request_id: 'bukan-uuid' })).toBeNull();
    expect(bacaParamTersimpan({ ...p, p_nama: 123 })).toBeNull();
    expect(bacaParamTersimpan({ ...p, p_email: 5 })).toBeNull();
  });
});

describe('pesan & klasifikasi galat', () => {
  it.each([
    ['LAYANAN_TUTUP', /sudah tutup/],
    ['DATA_TIDAK_VALID', /Data ditolak server/],
    ['LAYANAN_TIDAK_VALID', /Layanan saran tidak valid/],
    ['IDEMPOTENSI_BENTROK', /bentrok/],
    ['FORBIDDEN', /tidak berwenang/],
    ['SESI_TIDAK_SAH', /Sesi Anda sudah berakhir/],
  ])('%s -> pesan Indonesia', (kode, pola) => {
    expect(pesanGalatFoMulai(new GalatRpc(kode))).toMatch(pola);
  });

  it('jaringan dan galat tak dikenal memakai pesan umum yang tepat', () => {
    expect(pesanGalatFoMulai(new GalatRpc(null, { jaringan: true }))).toMatch(/Koneksi bermasalah/);
    expect(pesanGalatFoMulai(new GalatRpc('ANEH'))).toMatch(/Gagal menyimpan kunjungan/);
    expect(pesanGalatFoMulai(new Error('x'))).toMatch(/Gagal menyimpan kunjungan/);
  });

  it('hanya galat yang pasti gagal lagi yang permanen', () => {
    for (const k of ['LAYANAN_TUTUP', 'DATA_TIDAK_VALID', 'LAYANAN_TIDAK_VALID', 'NOT_FOUND', 'IDEMPOTENSI_BENTROK']) {
      expect(galatFoMulaiPermanen(new GalatRpc(k))).toBe(true);
    }
    for (const k of ['FORBIDDEN', 'SESI_TIDAK_SAH', 'RESPON_TIDAK_VALID', null]) {
      expect(galatFoMulaiPermanen(new GalatRpc(k))).toBe(false);
    }
    expect(galatFoMulaiPermanen(new GalatRpc('LAYANAN_TUTUP', { jaringan: true }))).toBe(false);
    expect(galatFoMulaiPermanen(new Error('x'))).toBe(false);
  });
});

describe('panggilFoMulaiKunjungan', () => {
  const param = bangunParamFoMulai(valid, ID);
  const sukses = { data: { ok: true, sudah_ada: false, kunjungan_id: 'k-1', penanganan_id: 'p-1', qr_token: 'qr' }, error: null };

  it('memanggil rpc fo_mulai_kunjungan dengan param apa adanya dan memetakan hasil', async () => {
    const rpc = vi.fn().mockResolvedValue(sukses);
    const h = await panggilFoMulaiKunjungan({ rpc } as never, param);
    expect(rpc).toHaveBeenCalledWith('fo_mulai_kunjungan', param);
    expect(h).toEqual({ sudahAda: false, kunjunganId: 'k-1', penangananId: 'p-1', qrToken: 'qr' });
  });

  it('sudah_ada:true (idempoten) diperlakukan sebagai sukses', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...sukses.data, sudah_ada: true }, error: null });
    expect((await panggilFoMulaiKunjungan({ rpc } as never, param)).sudahAda).toBe(true);
  });

  it('balasan tanpa ok:true / tanpa kunjungan_id = RESPON_TIDAK_VALID', async () => {
    for (const data of [null, { ok: false }, { ok: true }]) {
      const rpc = vi.fn().mockResolvedValue({ data, error: null });
      await expect(panggilFoMulaiKunjungan({ rpc } as never, param)).rejects.toMatchObject({ kode: 'RESPON_TIDAK_VALID' });
    }
  });

  it('galat server: kode dari awal pesan; jaringan ditandai', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'LAYANAN_TUTUP: tutup', code: 'P0001' } });
    await expect(panggilFoMulaiKunjungan({ rpc } as never, param)).rejects.toMatchObject({ kode: 'LAYANAN_TUTUP', jaringan: false });

    const rpcNet = vi.fn().mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } });
    await expect(panggilFoMulaiKunjungan({ rpc: rpcNet } as never, param)).rejects.toMatchObject({ jaringan: true });
  });

  it('23505 (balapan id sama) dicoba ulang SEKALI dan menghasilkan sudah_ada', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'duplicate key value', code: '23505' } })
      .mockResolvedValueOnce({ data: { ...sukses.data, sudah_ada: true }, error: null });
    const h = await panggilFoMulaiKunjungan({ rpc } as never, param);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(h.sudahAda).toBe(true);
  });

  it('23505 berulang tidak mengulang tanpa batas', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'duplicate key value', code: '23505' } });
    await expect(panggilFoMulaiKunjungan({ rpc } as never, param)).rejects.toBeInstanceOf(GalatRpc);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
