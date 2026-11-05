import { describe, it, expect } from 'vitest';
import { petaStatusBuka, type PetaStatusBuka } from './layananBuka';
import {
  hariIsoWIB,
  saringBerjadwalHariIni,
  namaTampil,
  urutkanLayar,
  bagiHalaman,
  kisiHalaman,
  posisiKartu,
  UKURAN_HALAMAN,
} from './tataLayar';

const b = (id: string, extra: Record<string, unknown> = {}) => ({
  layanan_id: id,
  layanan_nama: `Layanan ${id}`,
  nama_layar: null as string | null,
  urutan_layar: null as number | null,
  ...extra,
});

describe('hariIsoWIB: 1=Senin..7=Minggu menurut kalender WIB', () => {
  it('Senin 2026-11-02 pagi WIB = 1', () => {
    expect(hariIsoWIB(new Date('2026-11-02T01:00:00+07:00'))).toBe(1);
  });
  it('Minggu = 7', () => {
    expect(hariIsoWIB(new Date('2026-11-08T12:00:00+07:00'))).toBe(7);
  });
  it('00:30 WIB sudah hari berikutnya walau UTC masih kemarin', () => {
    // 2026-11-02 00:30 WIB = 2026-11-01 17:30 UTC (Minggu di UTC, Senin di WIB)
    expect(hariIsoWIB(new Date('2026-11-01T17:30:00Z'))).toBe(1);
  });
  it('23:59 WIB masih hari yang sama walau UTC sudah di hari yang sama', () => {
    expect(hariIsoWIB(new Date('2026-11-02T23:59:00+07:00'))).toBe(1);
  });
});

describe('petaStatusBuka memuat hari terjadwal', () => {
  it('membaca jadwal[].hari menjadi larik angka unik', () => {
    const peta = petaStatusBuka([
      {
        layanan_id: 'a',
        buka_sekarang: false,
        libur_keterangan: null,
        jadwal: [
          { hari: 1, jam_mulai: '08:00', jam_selesai: '15:30' },
          { hari: 3, jam_mulai: '08:00', jam_selesai: '15:30' },
          { hari: 3, jam_mulai: '13:00', jam_selesai: '15:30' },
        ],
      },
    ]);
    expect(peta?.get('a')?.hari).toEqual([1, 3]);
  });
  it('jadwal hilang atau bukan larik = tanpa hari (tidak ditebak)', () => {
    const peta = petaStatusBuka([
      { layanan_id: 'a', buka_sekarang: true },
      { layanan_id: 'b', buka_sekarang: true, jadwal: 'x' },
      { layanan_id: 'c', buka_sekarang: true, jadwal: [{ hari: 9 }, { hari: 'senin' }, null] },
    ]);
    expect(peta?.get('a')?.hari).toEqual([]);
    expect(peta?.get('b')?.hari).toEqual([]);
    expect(peta?.get('c')?.hari).toEqual([]);
  });
});

describe('saringBerjadwalHariIni: tampil sepanjang hari bila hari ini berjadwal', () => {
  const peta: PetaStatusBuka = new Map([
    ['senin', { buka: false, libur: null, hari: [1, 2, 3, 4, 5] }],
    ['sabtu', { buka: true, libur: null, hari: [6] }],
    ['libur', { buka: false, libur: 'Idul Fitri', hari: [1, 2, 3, 4, 5] }],
    ['kosong', { buka: false, libur: null, hari: [] }],
  ]);

  it('status tidak diketahui (null): semua baris apa adanya', () => {
    const data = [b('a'), b('z')];
    expect(saringBerjadwalHariIni(data, null, 1)).toEqual(data);
  });

  it('jadwal hari ini cocok = tampil walau sekarang di luar jam buka (buka=false)', () => {
    expect(saringBerjadwalHariIni([b('senin')], peta, 1).map(x => x.layanan_id)).toEqual(['senin']);
  });

  it('hari ini tidak ada di jadwal = tidak tampil walau buka_sekarang=true', () => {
    expect(saringBerjadwalHariIni([b('sabtu')], peta, 1)).toEqual([]);
  });

  it('hari libur kalender = tidak tampil', () => {
    expect(saringBerjadwalHariIni([b('libur')], peta, 1)).toEqual([]);
  });

  it('tanpa jadwal sama sekali = tidak tampil', () => {
    expect(saringBerjadwalHariIni([b('kosong')], peta, 1)).toEqual([]);
  });

  it('tidak ada di RPC (nonaktif/terarsip) = tidak tampil; TIDAK ada pengecualian tiket tersisa', () => {
    const baris = [b('hantu', { antre_count: 5, dilayani_count: 2 })];
    expect(saringBerjadwalHariIni(baris, peta, 1)).toEqual([]);
  });
});

describe('namaTampil dan urutkanLayar', () => {
  it('nama_layar dipakai bila terisi; kosong/spasi = nama layanan', () => {
    expect(namaTampil(b('a', { nama_layar: 'Helpdesk' }))).toBe('Helpdesk');
    expect(namaTampil(b('a', { nama_layar: '   ' }))).toBe('Layanan a');
    expect(namaTampil(b('a', { nama_layar: null }))).toBe('Layanan a');
    expect(namaTampil({ layanan_nama: 'X' })).toBe('X');
  });

  it('urutan_layar naik; null di akhir menurut nama; tidak mengubah larik asal', () => {
    const asal = [
      b('n2', { layanan_nama: 'Zeta' }),
      b('u2', { urutan_layar: 2 }),
      b('n1', { layanan_nama: 'Alfa' }),
      b('u1', { urutan_layar: 1 }),
    ];
    const salinan = [...asal];
    expect(urutkanLayar(asal).map(x => x.layanan_id)).toEqual(['u1', 'u2', 'n1', 'n2']);
    expect(asal).toEqual(salinan);
  });

  it('kolom urutan_layar belum ada (migrasi belum diterapkan) = urut menurut nama', () => {
    const data = [{ layanan_id: '2', layanan_nama: 'B' }, { layanan_id: '1', layanan_nama: 'A' }];
    expect(urutkanLayar(data).map(x => x.layanan_id)).toEqual(['1', '2']);
  });

  it('urutan sama: menurut nama', () => {
    const data = [b('x', { urutan_layar: 1, layanan_nama: 'B' }), b('y', { urutan_layar: 1, layanan_nama: 'A' })];
    expect(urutkanLayar(data).map(x => x.layanan_id)).toEqual(['y', 'x']);
  });
});

describe('halaman 8 kartu', () => {
  it('UKURAN_HALAMAN = 8', () => {
    expect(UKURAN_HALAMAN).toBe(8);
  });
  it('bagiHalaman memotong per 8, sisa di halaman terakhir', () => {
    const data = Array.from({ length: 19 }, (_, i) => i);
    const h = bagiHalaman(data);
    expect(h.map(x => x.length)).toEqual([8, 8, 3]);
    expect(h.flat()).toEqual(data);
  });
  it('kosong = tanpa halaman', () => {
    expect(bagiHalaman([])).toEqual([]);
  });
  it('kisiHalaman: > 8 layanan memakai kisi penuh untuk 8; <= 8 menurut jumlah', () => {
    expect(kisiHalaman(40)).toEqual(kisiHalaman(8));
    expect(kisiHalaman(9)).toEqual(kisiHalaman(8));
    const { kolom, baris } = kisiHalaman(5);
    expect(kolom * baris).toBeGreaterThanOrEqual(5);
    expect(kisiHalaman(1)).toEqual({ kolom: 1, baris: 1 });
  });
});

describe('posisiKartu: sisa baris dirata tengah (satuan setengah kartu)', () => {
  // Kisi 4x2: kolom = 8 satuan, baris = 4 satuan; kartu = 2x2 satuan.
  it('halaman penuh: tiap kartu di petak sendiri, tidak ada geseran', () => {
    const p = Array.from({ length: 8 }, (_, i) => posisiKartu(i, 8, 4, 2));
    expect(p.map(x => x.kolomMulai)).toEqual([1, 3, 5, 7, 1, 3, 5, 7]);
    expect(p.map(x => x.barisMulai)).toEqual([1, 1, 1, 1, 3, 3, 3, 3]);
  });
  it('baris terakhir 3 kartu dari 4 kolom: bergeser setengah kartu ke kanan (tengah)', () => {
    const p = [4, 5, 6].map(i => posisiKartu(i, 7, 4, 2));
    expect(p.map(x => x.kolomMulai)).toEqual([2, 4, 6]);
  });
  it('1 kartu dari kisi 4x2: di tengah horizontal dan vertikal', () => {
    expect(posisiKartu(0, 1, 4, 2)).toEqual({ kolomMulai: 4, barisMulai: 2 });
  });
  it('2 kartu: satu baris, tengah', () => {
    const p = [0, 1].map(i => posisiKartu(i, 2, 4, 2));
    expect(p.map(x => x.kolomMulai)).toEqual([3, 5]);
    expect(p.map(x => x.barisMulai)).toEqual([2, 2]);
  });
  it('kartu tidak pernah keluar kisi untuk 1..8 kartu di kisi mana pun', () => {
    for (const rasio of [16 / 9, 9 / 16]) {
      for (let n = 1; n <= 8; n++) {
        const { kolom, baris } = kisiHalaman(n, rasio);
        for (let i = 0; i < n; i++) {
          const p = posisiKartu(i, n, kolom, baris);
          expect(p.kolomMulai).toBeGreaterThanOrEqual(1);
          expect(p.kolomMulai + 1).toBeLessThanOrEqual(kolom * 2);
          expect(p.barisMulai).toBeGreaterThanOrEqual(1);
          expect(p.barisMulai + 1).toBeLessThanOrEqual(baris * 2);
        }
      }
    }
  });
});

describe('namaTampil memakai nama_tampil dari view lebih dulu', () => {
  it('nama_tampil > nama_layar > layanan_nama', () => {
    expect(namaTampil({ layanan_nama: 'A', nama_layar: 'B', nama_tampil: 'C' })).toBe('C');
    expect(namaTampil({ layanan_nama: 'A', nama_layar: 'B', nama_tampil: ' ' })).toBe('B');
  });
});
