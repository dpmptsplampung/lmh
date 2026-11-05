// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { csvDariTabel, unduhCsv } from './unduhCsv';

afterEach(() => vi.restoreAllMocks());

const TABEL = {
  kolom: [
    { kunci: 'nama', label: 'Layanan' },
    { kunci: 'jumlah', label: 'Jumlah' },
  ],
  baris: [
    { nama: 'Perizinan, OSS', jumlah: 3 },
    { nama: 'Non "OSS"', jumlah: null },
  ],
};

describe('unduh CSV grafik', () => {
  it('CSV lewat lib/csv.ts: kutip-ganda untuk koma dan tanda kutip', () => {
    expect(csvDariTabel(TABEL)).toBe('Layanan,Jumlah\r\n"Perizinan, OSS",3\r\n"Non ""OSS""",');
  });

  it('memicu unduhan dengan ekstensi .csv', () => {
    const klik = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:uji');
    URL.revokeObjectURL = vi.fn();
    unduhCsv('kunjungan', TABEL);
    expect(klik).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
