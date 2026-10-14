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

describe('mapRawTicketRow: nama FO', () => {
  const dasar = {
    id: 't-9', nomor_display: 'A-009', tanggal: '2026-09-01', status: 'selesai',
    waktu_terbit: '2026-09-01T01:00:00Z', waktu_mulai_layan: null, waktu_selesai: null,
    petugas: null, pelayanan_oss: null, pelayanan_perizinan: null,
  };

  it('fo_nama = FO tahap fo terakhir pada kunjungan; embed tahap_fo tidak ikut keluar', () => {
    const row = mapRawTicketRow({
      ...dasar,
      kunjungan: { nama: 'Siti', asal: 'walk_in', qr_token: 'qr', tahap_fo: [
        { tahap_ke: 1, peran_tahap: 'fo', penangan_id: 'fo-a', petugas: { nama: 'Ani' } },
        { tahap_ke: 2, peran_tahap: 'layanan', penangan_id: 'p-1', petugas: { nama: 'Rina' } },
        { tahap_ke: 3, peran_tahap: 'fo', penangan_id: 'fo-b', petugas: [{ nama: 'Bayu' }] },
      ] },
    });
    expect(row.fo_nama).toBe('Bayu');
    expect(row.kunjungan).toEqual({ nama: 'Siti', asal: 'walk_in', qr_token: 'qr' });
  });

  it('tiket lama tanpa tahap FO / tanpa kunjungan -> fo_nama null', () => {
    expect(mapRawTicketRow({ ...dasar, kunjungan: { nama: 'A', asal: 'walk_in', qr_token: null, tahap_fo: [] } }).fo_nama).toBeNull();
    expect(mapRawTicketRow({ ...dasar, kunjungan: { nama: 'A', asal: 'walk_in', qr_token: null } }).fo_nama).toBeNull();
    expect(mapRawTicketRow({ ...dasar, kunjungan: null }).fo_nama).toBeNull();
    const k = mapRawTicketRow({ ...dasar, kunjungan: [{ nama: 'A', asal: 'walk_in', qr_token: null, tahap_fo: [{ tahap_ke: 1, peran_tahap: 'fo', penangan_id: null, petugas: null }] }] });
    expect(k.fo_nama).toBeNull();
    expect(k.kunjungan?.nama).toBe('A');
  });
});

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
