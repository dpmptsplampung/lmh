import { describe, it, expect } from 'vitest';
import {
  KUNCI_PENGUMUMAN_LAYAR,
  BATAS_PENGUMUMAN_LAYAR,
  BATAS_NAMA_LAYAR,
  bacaPengumuman,
  namaTampilLayar,
  urutkanUntukLayar,
} from './pengaturan';

describe('bacaPengumuman', () => {
  it('memakai tiga kunci berurutan, kunci pertama tetap running_text_layar', () => {
    expect(KUNCI_PENGUMUMAN_LAYAR).toEqual(['running_text_layar', 'running_text_layar_2', 'running_text_layar_3']);
  });

  it('mengambil yang terisi sesuai urutan dan melewati yang kosong', () => {
    const s = { running_text_layar: ' Satu ', running_text_layar_2: '   ', running_text_layar_3: 'Tiga' };
    expect(bacaPengumuman(s)).toEqual(['Satu', 'Tiga']);
  });

  it('memotong ke batas panjang dan mengabaikan kunci lain', () => {
    const panjang = 'x'.repeat(BATAS_PENGUMUMAN_LAYAR + 50);
    const hasil = bacaPengumuman({ running_text_layar: panjang, lain: 'abaikan' });
    expect(hasil).toHaveLength(1);
    expect(hasil[0]).toHaveLength(BATAS_PENGUMUMAN_LAYAR);
  });

  it('kosong semua = daftar kosong', () => {
    expect(bacaPengumuman({})).toEqual([]);
  });
});

describe('namaTampilLayar', () => {
  it('memakai nama_layar bila terisi, selain itu nama', () => {
    expect(namaTampilLayar({ nama: 'Helpdesk OSS', nama_layar: ' OSS ' })).toBe('OSS');
    expect(namaTampilLayar({ nama: 'Helpdesk OSS', nama_layar: '  ' })).toBe('Helpdesk OSS');
    expect(namaTampilLayar({ nama: 'Helpdesk OSS', nama_layar: null })).toBe('Helpdesk OSS');
    expect(namaTampilLayar({ nama: 'Helpdesk OSS' })).toBe('Helpdesk OSS');
  });

  it('batas nama tampil 40 karakter', () => {
    expect(BATAS_NAMA_LAYAR).toBe(40);
  });
});

describe('urutkanUntukLayar', () => {
  it('urutan_layar naik, null di akhir menurut nama, tanpa mengubah masukan', () => {
    const masuk = [
      { nama: 'Zeta', urutan_layar: null },
      { nama: 'Beta', urutan_layar: 2 },
      { nama: 'Alfa', urutan_layar: null },
      { nama: 'Gama', urutan_layar: 1 },
    ];
    const salinan = masuk.map((x) => ({ ...x }));
    expect(urutkanUntukLayar(masuk).map((x) => x.nama)).toEqual(['Gama', 'Beta', 'Alfa', 'Zeta']);
    expect(masuk).toEqual(salinan);
  });

  it('urutan sama dibandingkan menurut nama', () => {
    const hasil = urutkanUntukLayar([
      { nama: 'B', urutan_layar: 1 },
      { nama: 'A', urutan_layar: 1 },
    ]);
    expect(hasil.map((x) => x.nama)).toEqual(['A', 'B']);
  });
});
