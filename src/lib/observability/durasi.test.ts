import { describe, expect, it } from 'vitest';
import { buatPengukur } from './durasi';

describe('buatPengukur', () => {
  it('mengembalikan hasil kerja dan mencatat durasi per nama', async () => {
    const p = buatPengukur();
    const hasil = await p.ukur('auth', async () => 42);
    expect(hasil).toBe(42);
    expect(p.header()).toMatch(/^auth;dur=\d+(\.\d+)?$/);
  });

  it('menggabungkan beberapa langkah dengan koma dan spasi, urut eksekusi', async () => {
    const p = buatPengukur();
    await p.ukur('auth', async () => 1);
    await p.ukur('lingkup', async () => 2);
    expect(p.header()).toMatch(/^auth;dur=[\d.]+, lingkup;dur=[\d.]+$/);
  });

  it('menormalkan nama ke [a-z0-9_-]', async () => {
    const p = buatPengukur();
    await p.ukur('Rekap Data/ABC!', async () => 1);
    expect(p.header()).toMatch(/^rekap_data_abc_;dur=/);
  });

  it('tetap mencatat durasi lalu melempar ulang bila kerja gagal', async () => {
    const p = buatPengukur();
    await expect(p.ukur('rpc', async () => { throw new Error('gagal'); })).rejects.toThrow('gagal');
    expect(p.header()).toMatch(/^rpc;dur=/);
  });

  it('header kosong bila belum ada langkah', () => {
    expect(buatPengukur().header()).toBe('');
  });
});
