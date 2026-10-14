import { describe, expect, it } from 'vitest';
import {
  ossPelayananDraftSchema,
  ossPelayananFinalSchema,
  perizinanPelayananDraftSchema,
  perizinanPelayananFinalSchema,
} from './pelayanan';

const OSS = {
  nama_pemohon: 'Budi',
  alamat_pemohon: 'Bandar Lampung',
  no_hp: '081234567890',
  email: 'Tidak berlaku',
  keperluan_awal: 'Mengurus NIB',
  nama_usaha: 'Belum ada',
  tipe_pelaku_usaha: 'tidak_berlaku',
  status_penanaman_modal: 'tidak_ada',
  lokasi_usaha: 'Belum ada',
  skala_usaha: 'Tidak berlaku',
  sektor_usaha_kbli: 'Tidak berlaku',
  tindak_lanjut: 'Konsultasi Lanjutan',
  uraian_solusi: 'Konsultasi awal',
  catatan_internal: '-',
};
const PERIZINAN = {
  nama_pemohon: 'Siti',
  alamat_pemohon: 'Lampung Selatan',
  no_hp: '0812',
  email: 'siti@example.com',
  keperluan_awal: 'Izin usaha',
  nama_perusahaan: 'PT Maju',
  lokasi_usaha: 'Lampung Selatan',
  opd_teknis: 'DPMPTSP',
  uraian_permohonan: 'Izin usaha',
  tindak_lanjut: 'Diproses',
  catatan_petugas: '-',
};

describe('Pendataan: semua field wajib saat final (keputusan CEO G.5)', () => {
  it('OSS lengkap (termasuk opsi eksplisit Belum ada/Tidak berlaku/-) lolos', () => {
    expect(ossPelayananFinalSchema.safeParse(OSS).success).toBe(true);
  });

  it.each(Object.keys(OSS))('OSS: field %s yang kosong/hilang/spasi ditolak', (kunci) => {
    for (const nilai of [undefined, null, '', '   ']) {
      const r = ossPelayananFinalSchema.safeParse({ ...OSS, [kunci]: nilai });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].path).toEqual([kunci]);
    }
  });

  it('OSS: nilai enum di luar daftar ditolak', () => {
    expect(ossPelayananFinalSchema.safeParse({ ...OSS, tipe_pelaku_usaha: 'lain' }).success).toBe(false);
    expect(ossPelayananFinalSchema.safeParse({ ...OSS, skala_usaha: 'Raksasa' }).success).toBe(false);
    expect(ossPelayananFinalSchema.safeParse({ ...OSS, status_penanaman_modal: 'Asing' }).success).toBe(false);
  });

  it('Perizinan lengkap lolos dan setiap field wajib non-kosong', () => {
    expect(perizinanPelayananFinalSchema.safeParse(PERIZINAN).success).toBe(true);
    for (const kunci of Object.keys(PERIZINAN)) {
      for (const nilai of [undefined, null, '', '   ']) {
        expect(perizinanPelayananFinalSchema.safeParse({ ...PERIZINAN, [kunci]: nilai }).success).toBe(false);
      }
    }
  });

  it('draf (autosave) tetap longgar: hanya nama pemohon yang wajib', () => {
    expect(ossPelayananDraftSchema.safeParse({ nama_pemohon: 'Budi' }).success).toBe(true);
    expect(perizinanPelayananDraftSchema.safeParse({ nama_pemohon: 'Siti' }).success).toBe(true);
  });
});

describe('perizinanPelayanan schemas', () => {
  it('accepts lokasi_usaha as an optional string or null in drafts', () => {
    expect(
      perizinanPelayananDraftSchema.safeParse({
        nama_pemohon: 'Siti',
        lokasi_usaha: 'Bandar Lampung',
      }).data,
    ).toMatchObject({ lokasi_usaha: 'Bandar Lampung' });
    expect(
      perizinanPelayananDraftSchema.safeParse({
        nama_pemohon: 'Siti',
        lokasi_usaha: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a non-string lokasi_usaha in final payloads', () => {
    expect(
      perizinanPelayananFinalSchema.safeParse({ ...PERIZINAN, lokasi_usaha: 123 }).success,
    ).toBe(false);
  });
});
