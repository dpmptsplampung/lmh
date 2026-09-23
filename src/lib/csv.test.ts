import { describe, it, expect } from 'vitest';
import { toCsv, escapeCsvCell } from './csv';

describe('toCsv', () => {
  const cols = [
    { key: 'nama', label: 'Nama' },
    { key: 'asal', label: 'Asal' },
  ];

  it('menghasilkan header dan baris polos', () => {
    const csv = toCsv(cols, [{ nama: 'Budi', asal: 'Bandar Lampung' }]);
    expect(csv).toBe('Nama,Asal\r\nBudi,Bandar Lampung');
  });

  it('meng-escape nilai dengan koma, kutip, dan baris baru', () => {
    const csv = toCsv(cols, [
      { nama: 'Toko "Maju", Jaya', asal: 'Metro' },
      { nama: 'Budi\nPT Baru', asal: 'Pesawaran' },
    ]);
    expect(csv).toContain('"Toko ""Maju"", Jaya",Metro');
    expect(csv).toContain('"Budi\nPT Baru",Pesawaran');
  });

  it('menulis sel null sebagai kosong', () => {
    const csv = toCsv(cols, [{ nama: null, asal: undefined }]);
    expect(csv).toBe('Nama,Asal\r\n,');
  });
});

describe('escapeCsvCell', () => {
  it('membiarkan teks polos', () => {
    expect(escapeCsvCell('sederhana')).toBe('sederhana');
  });
  it('membungkus yang mengandung kutip', () => {
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
  });
  it('mengosongkan null', () => {
    expect(escapeCsvCell(null)).toBe('');
  });
});
