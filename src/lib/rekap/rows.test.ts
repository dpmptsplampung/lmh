import { describe, it, expect } from 'vitest';
import { mapRawTicketRow } from './rows';

const perizinan = {
  id: 'pz-1',
  nama_pemohon: 'Siti',
  nama_perusahaan: 'CV Maju',
  opd_teknis: 'DPMPTSP',
  uraian_permohonan: 'Izin usaha',
  tindak_lanjut: 'diproses',
  catatan_petugas: null,
};

describe('mapRawTicketRow', () => {
  it('membaca embed perizinan berbentuk objek', () => {
    const row = mapRawTicketRow({
      id: 't-1', nomor_display: 'A-001', tanggal: '2026-09-01', status: 'selesai',
      waktu_terbit: '2026-09-01T01:00:00Z', waktu_mulai_layan: null, waktu_selesai: null,
      kunjungan: { nama: 'Siti', asal: 'walk_in', qr_token: null },
      petugas: { nama: 'Andi' },
      pelayanan_oss: null,
      pelayanan_perizinan: perizinan,
    });
    expect(row.form_type).toBe('perizinan');
    expect(row.pelayanan_perizinan?.nama_perusahaan).toBe('CV Maju');
  });

  it('menormalkan embed berbentuk array', () => {
    const row = mapRawTicketRow({
      id: 't-2', nomor_display: 'A-002', tanggal: '2026-09-01', status: 'selesai',
      waktu_terbit: '2026-09-01T01:00:00Z', waktu_mulai_layan: null, waktu_selesai: null,
      kunjungan: null, petugas: null,
      pelayanan_oss: null,
      pelayanan_perizinan: [perizinan],
    });
    expect(row.form_type).toBe('perizinan');
    expect(row.pelayanan_perizinan?.nama_pemohon).toBe('Siti');
  });
});
