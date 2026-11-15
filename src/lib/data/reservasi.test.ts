import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BATAS_DAFTAR_RESERVASI,
  VERSI_KEBIJAKAN_RESERVASI,
  batalkanReservasi,
  buatReservasi,
  catatPersetujuanReservasi,
  cekHariLibur,
  cekLayananBuka,
  muatEstimasiAntrean,
  muatJadwalBerikutnya,
  muatLayananReservasi,
  muatPengunjungReservasi,
  muatReservasiSaya,
} from './reservasi';

type Hasil = { data?: unknown; error?: unknown };

/** Builder berantai: setiap metode mengembalikan builder yang sama; `await`/metode terminal menghasilkan `hasil`. */
function builder(hasil: Hasil, terminal: 'then' | 'single' | 'maybeSingle' | 'limit' | 'order' = 'then') {
  const panggilan: Array<[string, unknown[]]> = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'order', 'limit', 'insert', 'single', 'maybeSingle']) {
    b[m] = vi.fn((...args: unknown[]) => {
      panggilan.push([m, args]);
      return m === terminal ? Promise.resolve({ data: null, error: null, ...hasil }) : b;
    });
  }
  if (terminal === 'then') {
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...hasil }).then(res);
  }
  return { b, panggilan };
}

const klien = (parts: Partial<Record<'from' | 'rpc' | 'auth', unknown>>) => parts as unknown as SupabaseClient;

describe('muatPengunjungReservasi', () => {
  it('pengguna + profil: kembalikan authUserId dan pengunjungId', async () => {
    const { b, panggilan } = builder({ data: { id: 'p-1', nama: 'Budi' } }, 'single');
    const sb = klien({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'a-1' } } }) }, from: vi.fn(() => b) });
    const hasil = await muatPengunjungReservasi(sb);
    expect(hasil).toEqual({ data: { authUserId: 'a-1', pengunjungId: 'p-1' }, error: null });
    expect(panggilan[0]).toEqual(['select', ['id, nama']]);
    expect(panggilan[1]).toEqual(['eq', ['auth_user_id', 'a-1']]);
  });

  it('tanpa pengguna: keduanya null, tabel tidak disentuh', async () => {
    const from = vi.fn();
    const sb = klien({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) }, from });
    expect(await muatPengunjungReservasi(sb)).toEqual({ data: { authUserId: null, pengunjungId: null }, error: null });
    expect(from).not.toHaveBeenCalled();
  });

  it('pengguna tanpa baris pengunjung: pengunjungId null', async () => {
    const { b } = builder({ data: null, error: { message: 'no rows' } }, 'single');
    const sb = klien({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'a-1' } } }) }, from: vi.fn(() => b) });
    expect((await muatPengunjungReservasi(sb)).data).toEqual({ authUserId: 'a-1', pengunjungId: null });
  });

  it('getUser melempar: hasil galat, tidak melempar', async () => {
    const sb = klien({ auth: { getUser: vi.fn().mockRejectedValue(new Error('putus')) } });
    const hasil = await muatPengunjungReservasi(sb);
    expect(hasil.data).toBeNull();
    expect(hasil.error?.asli).toBeInstanceOf(Error);
  });
});

describe('muatReservasiSaya', () => {
  it('filter pengunjung + asal reservasi, urut tanggal terbaru, dibatasi, kolom eksplisit', async () => {
    const baris = [{ id: 'k-1' }];
    const { b, panggilan } = builder({ data: baris }, 'limit');
    const from = vi.fn(() => b);
    const hasil = await muatReservasiSaya(klien({ from }), 'p-1');
    expect(hasil).toEqual({ data: baris, error: null });
    expect(from).toHaveBeenCalledWith('kunjungan');
    expect(panggilan).toEqual([
      ['select', ['id, tanggal, status, qr_token, tujuan, layanan_saran_id, jam_rencana, nama_yang_ditemui']],
      ['eq', ['pengunjung_id', 'p-1']],
      ['eq', ['asal', 'reservasi']],
      ['order', ['tanggal', { ascending: false }]],
      ['limit', [BATAS_DAFTAR_RESERVASI]],
    ]);
  });

  it('data null -> daftar kosong; galat -> hasil galat', async () => {
    expect((await muatReservasiSaya(klien({ from: () => builder({ data: null }, 'limit').b }), 'p')).data).toEqual([]);
    const galat = await muatReservasiSaya(klien({ from: () => builder({ error: { message: 'x' } }, 'limit').b }), 'p');
    expect(galat.data).toBeNull();
    expect(galat.error?.asli).toEqual({ message: 'x' });
  });

  it('from melempar (klien rusak): hasil galat, tidak melempar', async () => {
    const hasil = await muatReservasiSaya(klien({ from: () => ({}) }), 'p');
    expect(hasil.error).not.toBeNull();
  });
});

describe('muatLayananReservasi', () => {
  it('menyaring punya_antrean === false, bukan modul_publik, urut nama', async () => {
    const { b, panggilan } = builder(
      {
        data: [
          { id: 'a', nama: 'A', punya_antrean: true },
          { id: 'b', nama: 'B', punya_antrean: false },
          { id: 'c', nama: 'C' },
        ],
      },
      'order',
    );
    const from = vi.fn(() => b);
    const hasil = await muatLayananReservasi(klien({ from }));
    expect(hasil.data?.map((l) => l.id)).toEqual(['a', 'c']);
    expect(from).toHaveBeenCalledWith('v_layanan_publik');
    expect(panggilan).toEqual([
      ['select', ['id, nama, status_tampilan, punya_antrean']],
      ['neq', ['tipe', 'modul_publik']],
      ['order', ['nama']],
    ]);
  });

  it('galat query -> hasil galat (beda dari daftar kosong yang sah)', async () => {
    const galat = await muatLayananReservasi(klien({ from: () => builder({ error: { message: 'putus' } }, 'order').b }));
    expect(galat.data).toBeNull();
    const kosong = await muatLayananReservasi(klien({ from: () => builder({ data: [] }, 'order').b }));
    expect(kosong).toEqual({ data: [], error: null });
  });
});

describe('muatEstimasiAntrean', () => {
  it('membaca v_antrian_loket per layanan; tanpa baris = null', async () => {
    const { b, panggilan } = builder({ data: { antre_count: 4, estimasi_tunggu_total_menit: 20 } }, 'maybeSingle');
    const hasil = await muatEstimasiAntrean(klien({ from: vi.fn(() => b) }), 'l-1');
    expect(hasil.data).toEqual({ antre_count: 4, estimasi_tunggu_total_menit: 20 });
    expect(panggilan).toEqual([
      ['select', ['antre_count, estimasi_tunggu_total_menit']],
      ['eq', ['layanan_id', 'l-1']],
      ['maybeSingle', []],
    ]);
    expect((await muatEstimasiAntrean(klien({ from: () => builder({ data: null }, 'maybeSingle').b }), 'l')).data).toBeNull();
  });

  it('galat -> hasil galat', async () => {
    const hasil = await muatEstimasiAntrean(klien({ from: () => builder({ error: { message: 'x' } }, 'maybeSingle').b }), 'l');
    expect(hasil.error).not.toBeNull();
  });
});

describe('cekHariLibur', () => {
  it('ada baris = true, tidak ada = false, galat = hasil galat', async () => {
    expect((await cekHariLibur(klien({ from: () => builder({ data: { tanggal: 't' } }, 'maybeSingle').b }), 't')).data).toBe(true);
    expect((await cekHariLibur(klien({ from: () => builder({ data: null }, 'maybeSingle').b }), 't')).data).toBe(false);
    const galat = await cekHariLibur(klien({ from: () => builder({ error: { message: 'x' } }, 'maybeSingle').b }), 't');
    expect(galat.data).toBeNull();
    expect(galat.error).not.toBeNull();
  });
});

describe('RPC jadwal', () => {
  it('cekLayananBuka: kirim parameter kontrak; boolean diteruskan, selain itu null, galat = hasil galat', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    expect((await cekLayananBuka(klien({ rpc }), 'l-1', '2026-11-16')).data).toBe(false);
    expect(rpc).toHaveBeenCalledWith('is_layanan_buka_jadwal', { p_layanan_id: 'l-1', p_tanggal: '2026-11-16', p_jam: null });
    expect((await cekLayananBuka(klien({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }), 'l', 't')).data).toBeNull();
    const galat = await cekLayananBuka(klien({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } }) }), 'l', 't');
    expect(galat.error).not.toBeNull();
  });

  it('muatJadwalBerikutnya: string tanggal atau null; galat = hasil galat', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: '2099-01-05', error: null });
    expect((await muatJadwalBerikutnya(klien({ rpc }), 'l-1', '2026-11-16')).data).toBe('2099-01-05');
    expect(rpc).toHaveBeenCalledWith('jadwal_berikutnya', { p_layanan_id: 'l-1', p_dari_tanggal: '2026-11-16' });
    expect((await muatJadwalBerikutnya(klien({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }), 'l', 't')).data).toBeNull();
    expect((await muatJadwalBerikutnya(klien({ rpc: vi.fn().mockResolvedValue({ error: { message: 'x' } }) }), 'l', 't')).error).not.toBeNull();
  });
});

describe('catatPersetujuanReservasi', () => {
  it('menulis consent_log dengan versi kebijakan; galat insert = hasil galat', async () => {
    const insert = vi.fn().mockResolvedValue({ data: [{}], error: null });
    const from = vi.fn(() => ({ insert }));
    expect(await catatPersetujuanReservasi(klien({ from }), 'a-1')).toEqual({ data: true, error: null });
    expect(from).toHaveBeenCalledWith('consent_log');
    expect(insert).toHaveBeenCalledWith({
      subjek_ref: 'a-1',
      tujuan: 'reservasi_data',
      disetujui: true,
      versi_kebijakan: VERSI_KEBIJAKAN_RESERVASI,
    });
    const gagal = await catatPersetujuanReservasi(
      klien({ from: () => ({ insert: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } }) }) }),
      'a-1',
    );
    expect(gagal.data).toBeNull();
    expect(gagal.error).not.toBeNull();
  });

  it('insert menolak (jaringan putus): hasil galat, tidak melempar', async () => {
    const hasil = await catatPersetujuanReservasi(
      klien({ from: () => ({ insert: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) }) }),
      'a-1',
    );
    expect(hasil.error).not.toBeNull();
  });
});

describe('buatReservasi / batalkanReservasi', () => {
  const input = {
    tujuan: 'bertemu_seseorang' as const,
    layananId: '',
    namaYangDitemui: 'Kepala Bidang',
    tanggal: '2026-11-16',
    jamRencana: '',
    keperluan: '',
  };

  it('buatReservasi sukses: kunjunganId + qrToken', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, kunjungan_id: 'k-1', qr_token: 'q'.repeat(32), tanggal: '2026-11-16' },
      error: null,
    });
    const hasil = await buatReservasi(klien({ rpc }), input);
    expect(hasil.data).toEqual({ kunjunganId: 'k-1', qrToken: 'q'.repeat(32), tanggal: '2026-11-16' });
    expect(rpc).toHaveBeenCalledWith('reservasi_buat', expect.objectContaining({ p_tujuan: 'bertemu_seseorang' }));
  });

  it('buatReservasi galat server: pesan terpetakan + kode kontrak', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'RESERVASI_GANDA: sudah ada', code: 'P0001' } });
    const hasil = await buatReservasi(klien({ rpc }), input);
    expect(hasil.error?.kode).toBe('RESERVASI_GANDA');
    expect(hasil.error?.pesan).toMatch(/sudah memiliki reservasi yang sama/);
  });

  it('buatReservasi galat tak dikenal: pesan umum, kode null', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'aneh' } });
    const hasil = await buatReservasi(klien({ rpc }), input);
    expect(hasil.error).toMatchObject({ kode: null, pesan: 'Gagal membuat reservasi. Silakan coba lagi.' });
  });

  it('batalkanReservasi: sukses dan galat INVALID_STATUS', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, status: 'batal' }, error: null });
    expect(await batalkanReservasi(klien({ rpc }), 'k-9')).toEqual({ data: true, error: null });
    expect(rpc).toHaveBeenCalledWith('reservasi_batalkan', { p_kunjungan_id: 'k-9' });
    const gagal = await batalkanReservasi(
      klien({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'INVALID_STATUS: sudah check-in', code: 'P0001' } }) }),
      'k-9',
    );
    expect(gagal.error?.pesan).toMatch(/sudah tidak dapat dibatalkan/);
  });
});
