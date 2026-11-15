// Transisi mesin keadaan muat antrean (tugas 5.3), diturunkan dari perilaku page.tsx sebelum refaktor.
import { describe, it, expect } from 'vitest';
import type { DataAntrean, TiketBaris } from '@/lib/data/antrean';
import { KEADAAN_AWAL_ANTREAN as AWAL, kurangiAntrean as kurangi, type KeadaanAntrean } from './keadaanAntrean';

const t = { id: 't-1' } as TiketBaris;
const data: DataAntrean = {
  baris: [t], barisPanel: [t, t], totalTabel: 1, totalHarian: 4,
  statistik: { totalSelesai: 2, rataWaktuMenit: 9 }, aksesFo: true,
};

describe('kurangiAntrean', () => {
  it('awal: skeleton menyala, tanpa data, tanpa galat', () => {
    expect(AWAL).toMatchObject({ loading: true, menyegarkan: false, galatMuat: null, galatSegar: false, antrian: [], currentUser: null });
  });

  it('mulai biasa: skeleton + hapus galat muat; mulai senyap: hanya menyegarkan (galat dan data tetap)', () => {
    const ada: KeadaanAntrean = { ...AWAL, loading: false, galatMuat: 'x', antrian: [t] };
    expect(kurangi(ada, { jenis: 'mulai', senyap: false })).toMatchObject({ loading: true, galatMuat: null, antrian: [t] });
    expect(kurangi(ada, { jenis: 'mulai', senyap: true })).toMatchObject({ loading: false, menyegarkan: true, galatMuat: 'x' });
  });

  it('data: mengganti semua bagian sekaligus, menghapus galat dan catatan galatSegar, mencatat waktu', () => {
    const k = kurangi({ ...AWAL, unassigned: true, galatSegar: true, galatMuat: 'x' }, { jenis: 'data', data, waktu: 'W' });
    expect(k).toMatchObject({
      unassigned: false, aksesFo: true, antrian: [t], antrianPanel: [t, t], totalCount: 1, totalHarian: 4,
      serverStats: { totalSelesai: 2, rataWaktuMenit: 9 }, galatMuat: null, galatSegar: false, terakhir: 'W',
    });
    expect(k.loading).toBe(true); // skeleton dimatikan oleh 'selesai', bukan oleh data
  });

  it('belum ditugaskan: kosongkan daftar dan total; statistik dan waktu terakhir tidak disentuh', () => {
    const k = kurangi({ ...AWAL, antrian: [t], antrianPanel: [t], totalCount: 3, totalHarian: 3, terakhir: 'W' }, { jenis: 'belumDitugaskan' });
    expect(k).toMatchObject({ unassigned: true, antrian: [], antrianPanel: [], totalCount: 0, totalHarian: 0, terakhir: 'W' });
  });

  it('galat muat dan galat segar tidak mengubah data yang tampil', () => {
    const ada = { ...AWAL, antrian: [t] };
    expect(kurangi(ada, { jenis: 'galatMuat', pesan: 'p' })).toMatchObject({ galatMuat: 'p', antrian: [t] });
    expect(kurangi(ada, { jenis: 'galatSegar' })).toMatchObject({ galatSegar: true, antrian: [t] });
  });

  it('profil, catatan, survei', () => {
    const profil = { id: 'p', role: 'admin', layanan_id: '' };
    expect(kurangi(AWAL, { jenis: 'profil', profil }).currentUser).toBe(profil);
    expect(kurangi(AWAL, { jenis: 'catatan', catatan: { a: { topik: 'x', catatan: null, foNama: null } } }).catatanEskalasi.a.topik).toBe('x');
    const status = new Map([['k', 'belum_diisi' as const]]);
    expect(kurangi(AWAL, { jenis: 'survei', status }).statusSurvei).toBe(status);
  });

  it('selesai: matikan skeleton dan menyegarkan; bila keduanya sudah mati, keadaan sama (tanpa render ulang)', () => {
    expect(kurangi({ ...AWAL, loading: true, menyegarkan: true }, { jenis: 'selesai' })).toMatchObject({ loading: false, menyegarkan: false });
    const diam = { ...AWAL, loading: false };
    expect(kurangi(diam, { jenis: 'selesai' })).toBe(diam);
  });
});
