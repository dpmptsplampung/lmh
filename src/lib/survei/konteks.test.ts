import { describe, expect, it, vi } from 'vitest';
import { ambilKonteks } from './konteks';

type Klien = Parameters<typeof ambilKonteks>[0];

function klienDengan(rpc: ReturnType<typeof vi.fn>): Klien {
  return { rpc } as unknown as Klien;
}

const TOKEN = 'b'.repeat(64);

describe('ambilKonteks', () => {
  it('memetakan hasil RPC get_survei_context ke bentuk kamelCase', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: 'ok',
        unit: 'layanan',
        layanan_nama: 'Konsultasi OSS',
        kedaluwarsa_pada: '2026-10-28T10:00:00+00:00',
      },
      error: null,
    });

    await expect(ambilKonteks(klienDengan(rpc), TOKEN)).resolves.toEqual({
      status: 'ok',
      unit: 'layanan',
      layananNama: 'Konsultasi OSS',
      kedaluwarsaPada: '2026-10-28T10:00:00+00:00',
    });
    expect(rpc).toHaveBeenCalledWith('get_survei_context', { p_token: TOKEN });
  });

  it.each(['kedaluwarsa', 'sudah_diisi'] as const)('mempertahankan status %s beserta unitnya', async (status) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status, unit: 'fo', layanan_nama: null, kedaluwarsa_pada: '2026-10-28T10:00:00+00:00' },
      error: null,
    });
    const hasil = await ambilKonteks(klienDengan(rpc), TOKEN);
    expect(hasil).toMatchObject({ status, unit: 'fo', layananNama: null });
  });

  it('tidak_valid (semua kolom null) dipetakan tanpa melempar', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: 'tidak_valid', unit: null, layanan_nama: null, kedaluwarsa_pada: null },
      error: null,
    });
    await expect(ambilKonteks(klienDengan(rpc), TOKEN)).resolves.toEqual({
      status: 'tidak_valid',
      unit: null,
      layananNama: null,
      kedaluwarsaPada: null,
    });
  });

  it('unit di luar layanan/fo (mis. tidak_diketahui) menjadi null', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: 'ok', unit: 'tidak_diketahui', layanan_nama: null, kedaluwarsa_pada: null },
      error: null,
    });
    const hasil = await ambilKonteks(klienDengan(rpc), TOKEN);
    expect(hasil.unit).toBeNull();
  });

  it('melempar saat RPC mengembalikan error (bukan menyamar sebagai tidak_valid)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch' } });
    await expect(ambilKonteks(klienDengan(rpc), TOKEN)).rejects.toThrow();
  });

  it('melempar saat permintaan ditolak (galat jaringan)', async () => {
    const rpc = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(ambilKonteks(klienDengan(rpc), TOKEN)).rejects.toThrow();
  });

  it.each([
    ['data kosong', null],
    ['bukan objek', 'ok'],
    ['status tidak dikenal', { status: 'aneh', unit: null, layanan_nama: null, kedaluwarsa_pada: null }],
  ])('melempar bila bentuk hasil tidak dikenal: %s', async (_nama, data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(ambilKonteks(klienDengan(rpc), TOKEN)).rejects.toThrow();
  });
});
