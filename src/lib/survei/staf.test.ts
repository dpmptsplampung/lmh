import { describe, expect, it, vi } from 'vitest';
import { ambilQrSurvei, ambilStatusSurvei, LABEL_STATUS_SURVEI, urlSurvei } from './staf';

type KlienRpc = Parameters<typeof ambilQrSurvei>[0];
type KlienTabel = Parameters<typeof ambilStatusSurvei>[0];

const TOKEN = 'c'.repeat(64);

describe('urlSurvei', () => {
  it('menyusun tautan /survei/<token> dari origin', () => {
    expect(urlSurvei('https://lmh.example.test', TOKEN)).toBe(`https://lmh.example.test/survei/${TOKEN}`);
  });
});

describe('LABEL_STATUS_SURVEI', () => {
  it('berisi label Indonesia untuk keempat status', () => {
    expect(LABEL_STATUS_SURVEI).toEqual({
      belum_diisi: 'Belum diisi',
      sudah_diisi: 'Sudah diisi',
      kedaluwarsa: 'Kedaluwarsa',
      tidak_ada: '—',
    });
  });
});

describe('ambilQrSurvei', () => {
  const klien = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as KlienRpc;

  it('memetakan hasil RPC ambil_qr_survei (belum diisi: token ikut)', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: 'belum_diisi',
        token: TOKEN,
        kedaluwarsa_pada: '2026-10-28T10:00:00+00:00',
        unit: 'layanan',
        layanan_nama: 'Konsultasi OSS',
      },
      error: null,
    });
    await expect(ambilQrSurvei(klien(rpc), 'k-1')).resolves.toEqual({
      status: 'belum_diisi',
      token: TOKEN,
      kedaluwarsaPada: '2026-10-28T10:00:00+00:00',
      layananNama: 'Konsultasi OSS',
    });
    expect(rpc).toHaveBeenCalledWith('ambil_qr_survei', { p_kunjungan_id: 'k-1' });
  });

  it.each(['sudah_diisi', 'kedaluwarsa', 'tidak_ada'] as const)('status %s: token null walau server mengirim token', async (status) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status, token: TOKEN, kedaluwarsa_pada: '2026-10-28T10:00:00+00:00', unit: 'fo', layanan_nama: null },
      error: null,
    });
    const hasil = await ambilQrSurvei(klien(rpc), 'k-1');
    expect(hasil.status).toBe(status);
    expect(hasil.token).toBeNull();
  });

  it('tidak_ada dari server (semua kolom null) dipetakan ke null', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status: 'tidak_ada', token: null, kedaluwarsa_pada: null, unit: null, layanan_nama: null },
      error: null,
    });
    await expect(ambilQrSurvei(klien(rpc), 'k-1')).resolves.toEqual({
      status: 'tidak_ada', token: null, kedaluwarsaPada: null, layananNama: null,
    });
  });

  it('belum_diisi tanpa token (bentuk rusak) menjadi token null, bukan string kosong', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'belum_diisi', token: '' }, error: null });
    const hasil = await ambilQrSurvei(klien(rpc), 'k-1');
    expect(hasil.token).toBeNull();
  });

  it('galat RPC (supabase-js tidak melempar) dan bentuk tak dikenal MELEMPAR', async () => {
    const galat = vi.fn().mockResolvedValue({ data: null, error: { message: 'FORBIDDEN', code: '42501' } });
    await expect(ambilQrSurvei(klien(galat), 'k-1')).rejects.toThrow();

    for (const data of [null, 'x', [], { status: 'aneh' }, {}]) {
      const rpc = vi.fn().mockResolvedValue({ data, error: null });
      await expect(ambilQrSurvei(klien(rpc), 'k-1')).rejects.toThrow();
    }
  });
});

describe('ambilStatusSurvei', () => {
  /** Klien palsu: from('v_survei_status').select(...).in('kunjungan_id', ids) -> baris sesuai `peta`. */
  function klienTabel(peta: Record<string, string>, galat: { message: string } | null = null) {
    const panggilan: { tabel: string; kolom: string; ids: string[] }[] = [];
    const klienPalsu = {
      from: (tabel: string) => ({
        select: (kolom: string) => ({
          in: (_kolomIn: string, ids: string[]) => {
            panggilan.push({ tabel, kolom, ids });
            const data = ids.filter((id) => id in peta).map((id) => ({ kunjungan_id: id, status: peta[id] }));
            return Promise.resolve({ data: galat ? null : data, error: galat });
          },
        }),
      }),
    } as unknown as KlienTabel;
    return { klien: klienPalsu, panggilan };
  }

  it('memecah 450 id menjadi 3 panggilan (200 + 200 + 50) ke v_survei_status', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `k-${i}`);
    const { klien, panggilan } = klienTabel({});
    await ambilStatusSurvei(klien, ids);
    expect(panggilan).toHaveLength(3);
    expect(panggilan.map((p) => p.ids.length).sort((a, b) => b - a)).toEqual([200, 200, 50]);
    expect(panggilan.every((p) => p.tabel === 'v_survei_status')).toBe(true);
    expect(panggilan[0].kolom).toContain('kunjungan_id');
    expect(panggilan[0].kolom).toContain('status');
    // Tiap id terkirim tepat sekali.
    expect(panggilan.flatMap((p) => p.ids).sort()).toEqual([...ids].sort());
  });

  it('id tanpa baris di view dipetakan ke tidak_ada; baris yang ada mempertahankan statusnya', async () => {
    const { klien } = klienTabel({ 'k-1': 'belum_diisi', 'k-2': 'sudah_diisi', 'k-3': 'kedaluwarsa' });
    const hasil = await ambilStatusSurvei(klien, ['k-1', 'k-2', 'k-3', 'k-4']);
    expect(hasil.get('k-1')).toBe('belum_diisi');
    expect(hasil.get('k-2')).toBe('sudah_diisi');
    expect(hasil.get('k-3')).toBe('kedaluwarsa');
    expect(hasil.get('k-4')).toBe('tidak_ada');
    expect(hasil.size).toBe(4);
  });

  it('nilai status yang tidak dikenal diperlakukan sebagai tidak_ada', async () => {
    const { klien } = klienTabel({ 'k-1': 'aneh' });
    const hasil = await ambilStatusSurvei(klien, ['k-1']);
    expect(hasil.get('k-1')).toBe('tidak_ada');
  });

  it('id ganda dikirim sekali; daftar kosong tanpa panggilan', async () => {
    const { klien, panggilan } = klienTabel({});
    await ambilStatusSurvei(klien, ['k-1', 'k-1', 'k-2']);
    expect(panggilan).toHaveLength(1);
    expect(panggilan[0].ids).toEqual(['k-1', 'k-2']);

    const kosong = klienTabel({});
    const hasil = await ambilStatusSurvei(kosong.klien, []);
    expect(hasil.size).toBe(0);
    expect(kosong.panggilan).toHaveLength(0);
  });

  it('galat kueri MELEMPAR (pemanggil memutuskan; lencana tidak boleh berbohong "—")', async () => {
    const { klien } = klienTabel({}, { message: 'boom' });
    await expect(ambilStatusSurvei(klien, ['k-1'])).rejects.toThrow();
  });
});
