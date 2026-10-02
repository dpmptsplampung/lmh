import { describe, expect, it } from 'vitest';
import {
  perizinanPelayananDraftSchema,
  perizinanPelayananFinalSchema,
} from './pelayanan';

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
      perizinanPelayananFinalSchema.safeParse({
        nama_pemohon: 'Siti',
        nama_perusahaan: 'PT Maju',
        lokasi_usaha: 123,
        opd_teknis: 'DPMPTSP',
        uraian_permohonan: 'Izin usaha',
        tindak_lanjut: 'Diproses',
      }).success,
    ).toBe(false);
  });
});
