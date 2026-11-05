import { describe, it, expect } from 'vitest';
import { filterValid, namaPelapor, ringkasIsi, statusTertutup, teksBatas, teksSisaHariKerja, STATUS_LABEL, STATUS_PENJELASAN } from './tampilan';

describe('tampilan pengaduan', () => {
  it('filterValid: nilai tak dikenal kembali ke "aktif"', () => {
    expect(filterValid('terlambat')).toBe('terlambat');
    expect(filterValid('hapus')).toBe('aktif');
    expect(filterValid(null)).toBe('aktif');
  });

  it('teksSisaHariKerja: terlambat, hari ini, sisa; null bila server tidak memberi SLA', () => {
    expect(teksSisaHariKerja(-3, 'terlambat')).toBe('Terlambat 3 hari kerja');
    expect(teksSisaHariKerja(0, 'mendekati')).toBe('Batas hari ini');
    expect(teksSisaHariKerja(4, 'aman')).toBe('4 hari kerja lagi');
    expect(teksSisaHariKerja(4, null)).toBeNull();
    expect(teksSisaHariKerja(null, 'aman')).toBeNull();
  });

  it('teksBatas: pengaduan tertutup atau tanpa batas = "-"', () => {
    expect(teksBatas({ status: 'selesai', batas_aktif: '2026-10-05' })).toBe('-');
    expect(teksBatas({ status: 'baru', batas_aktif: null })).toBe('-');
    expect(teksBatas({ status: 'baru', batas_aktif: '2026-10-05' })).toMatch(/5 Oktober 2026/);
  });

  it('namaPelapor: anonim tidak pernah menampilkan nama, walau nama terisi', () => {
    expect(namaPelapor({ anonim: true, pelapor_nama: 'Sari' })).toBe('Anonim');
    expect(namaPelapor({ anonim: false, pelapor_nama: ' Sari ' })).toBe('Sari');
    expect(namaPelapor({ anonim: false, pelapor_nama: null })).toBe('Tanpa nama');
  });

  it('ringkasIsi memadatkan spasi dan memotong dengan elipsis', () => {
    expect(ringkasIsi('a\n\n b   c')).toBe('a b c');
    expect(ringkasIsi('x'.repeat(200), 10)).toBe('xxxxxxxxx…');
  });

  it('setiap status punya label dan penjelasan satu kalimat tanpa em dash', () => {
    for (const s of ['baru', 'diverifikasi', 'diproses', 'eskalasi', 'selesai', 'ditolak']) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_PENJELASAN[s]).not.toContain('—');
      expect(STATUS_PENJELASAN[s].match(/\./g)).toHaveLength(1);
    }
    expect(statusTertutup('ditolak')).toBe(true);
    expect(statusTertutup('diproses')).toBe(false);
  });
});
