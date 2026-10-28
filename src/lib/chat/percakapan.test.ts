// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { bacaDibaca, belumDibaca, bersihkanPenutup, dariBarisRpc, dariBarisSesi, tulisDibaca } from './percakapan';

const L1 = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';

describe('dariBarisSesi (cadangan tanpa RPC)', () => {
  it('mengelompokkan per layanan, sesi terbuka terbaru, urut terbaru', () => {
    const hasil = dariBarisSesi(
      [
        { id: 'a', layanan_id: L1, status: 'selesai', created_at: '2026-10-01T01:00:00Z' },
        { id: 'b', layanan_id: L1, status: 'bot', created_at: '2026-10-03T01:00:00Z' },
        { id: 'c', layanan_id: L2, status: 'selesai', created_at: '2026-10-05T01:00:00Z' },
      ],
      { [L1]: 'Bank Lampung', [L2]: 'BPJS' },
    );
    expect(hasil.map((p) => p.layananId)).toEqual([L2, L1]);
    const l1 = hasil.find((p) => p.layananId === L1)!;
    expect(l1).toMatchObject({ jumlahSesi: 2, sesiTerakhirId: 'b', sesiTerbukaId: 'b', statusTerakhir: 'bot', layananNama: 'Bank Lampung' });
    expect(hasil.find((p) => p.layananId === L2)!.sesiTerbukaId).toBeNull();
  });
});

describe('dariBarisRpc', () => {
  it('memetakan kolom RPC ke bentuk klien dan membuang baris rusak', () => {
    const [p, ...sisa] = dariBarisRpc([
      {
        layanan_id: L1, layanan_nama: 'Bank', layanan_aktif: true, punya_chat: true, chatbot_aktif: true, jumlah_sesi: 3,
        sesi_terakhir_id: 's1', sesi_terbuka_id: null, status_terakhir: 'selesai', last_pesan: 'hai',
        last_pesan_at: '2026-10-01T00:00:00Z', last_pengirim: 'bot',
      },
      { layanan_id: null },
    ]);
    expect(sisa).toHaveLength(0);
    expect(p).toMatchObject({ layananId: L1, jumlahSesi: 3, lastPengirim: 'bot', sesiTerbukaId: null });
  });
  it('bukan array -> kosong', () => expect(dariBarisRpc(null)).toEqual([]));
});

describe('belumDibaca', () => {
  const base = { lastPesanAt: '2026-10-02T00:00:00Z', lastPengirim: 'petugas' as const };
  it('benar bila pesan terakhir dari bot/petugas dan lebih baru dari penanda', () => {
    expect(belumDibaca(base, '2026-10-01T00:00:00Z')).toBe(true);
    expect(belumDibaca(base, null)).toBe(true);
  });
  it('salah bila pengirim pengunjung, sudah dibaca, atau tanpa pesan', () => {
    expect(belumDibaca({ ...base, lastPengirim: 'pengunjung' }, null)).toBe(false);
    expect(belumDibaca(base, '2026-10-02T00:00:00Z')).toBe(false);
    expect(belumDibaca({ lastPesanAt: null, lastPengirim: null }, null)).toBe(false);
  });
});

describe('penanda dibaca (localStorage)', () => {
  beforeEach(() => window.localStorage.clear());
  it('tulis lalu baca per layanan', () => {
    tulisDibaca(L1, '2026-10-02T00:00:00Z');
    expect(bacaDibaca(L1)).toBe('2026-10-02T00:00:00Z');
    expect(bacaDibaca(L2)).toBeNull();
  });
});

describe('bersihkanPenutup', () => {
  it('menghapus kalimat survei lama saja', () => {
    expect(
      bersihkanPenutup(
        'Sesi chat telah selesai. Terima kasih telah menghubungi DPMPTSP Provinsi Lampung. Tautan survei kepuasan layanan akan disediakan di sini.',
      ),
    ).toBe('Sesi chat telah selesai. Terima kasih telah menghubungi DPMPTSP Provinsi Lampung.');
  });
  it('teks baru tidak berubah', () => {
    expect(bersihkanPenutup('Sesi chat telah selesai.')).toBe('Sesi chat telah selesai.');
  });
});
