import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  KOLOM_HARI_LIBUR,
  KOLOM_LAYANAN_RINGKAS,
  KOLOM_LAYANAN_SEBELUM_FASE1,
  KOLOM_PETUGAS_RINGKAS,
  KOLOM_TOPIK,
  KOLOM_TOPIK_ADMIN,
  KUNCI_REFERENSI,
  muatHariLibur,
  muatLayananRingkas,
  muatPetugasRingkas,
  muatSemuaTopik,
  muatTopik,
} from './referensi';

type Operasi = [nama: string, ...argumen: unknown[]];
type Hasil = { data: unknown; error: { message: string } | null };

/**
 * Klien tiruan: mencatat setiap panggilan berantai (from/select/eq/...) lalu menjawab dengan `hasil` atau melempar.
 * Bila `hasil` berupa daftar, panggilan `from()` ke-n dijawab elemen ke-n (elemen terakhir dipakai berulang).
 */
function buatKlien(hasil: Hasil | Error | Array<Hasil | Error>) {
  const ops: Operasi[] = [];
  let giliran = 0;
  const sb = {
    from: vi.fn((tabel: string) => {
      ops.push(['from', tabel]);
      const jawaban = Array.isArray(hasil) ? hasil[Math.min(giliran++, hasil.length - 1)] : hasil;
      const rantai: Record<string, unknown> = {};
      for (const nama of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) {
        rantai[nama] = (...argumen: unknown[]) => {
          ops.push([nama, ...argumen]);
          return rantai;
        };
      }
      rantai.then = (selesai: (v: Hasil) => unknown, tolak?: (e: unknown) => unknown) =>
        (jawaban instanceof Error ? Promise.reject(jawaban) : Promise.resolve(jawaban)).then(selesai, tolak);
      return rantai;
    }),
  } as unknown as SupabaseClient;
  return { sb, ops };
}

describe('daftar kolom referensi', () => {
  it('tidak ada yang memakai bintang dan sesuai kontrak rencana 4.1', () => {
    expect(KOLOM_LAYANAN_RINGKAS).toBe('id, nama, slug, form_pendataan, diarsipkan_at');
    expect(KOLOM_PETUGAS_RINGKAS).toBe('id, nama, role, layanan_id, aktif');
    expect(KOLOM_TOPIK).toBe('id, nama, urut');
    expect(KOLOM_TOPIK_ADMIN).toBe('id, layanan_id, nama, aktif, urut');
    expect(KOLOM_HARI_LIBUR).toBe('tanggal, keterangan');
    for (const k of [KOLOM_LAYANAN_RINGKAS, KOLOM_PETUGAS_RINGKAS, KOLOM_TOPIK, KOLOM_TOPIK_ADMIN, KOLOM_HARI_LIBUR]) {
      expect(k).not.toContain('*');
    }
  });

  it('kunci cache stabil dan topik dipisah per layanan', () => {
    expect(KUNCI_REFERENSI.layananRingkas).toBe('layanan-ringkas');
    expect(KUNCI_REFERENSI.petugasRingkas).toBe('petugas-ringkas');
    expect(KUNCI_REFERENSI.topik('l1')).toBe('topik:l1');
    expect(KUNCI_REFERENSI.topik('l1')).not.toBe(KUNCI_REFERENSI.topik('l2'));
  });
});

describe('muatLayananRingkas', () => {
  it('membaca layanan dengan kolom eksplisit, urut nama, tanpa batas (tabel referensi)', async () => {
    const baris = [{ id: 'l1', nama: 'Helpdesk OSS', slug: 'helpdesk-oss', form_pendataan: 'oss', diarsipkan_at: null }];
    const { sb, ops } = buatKlien({ data: baris, error: null });
    const hasil = await muatLayananRingkas(sb);
    expect(hasil).toEqual({ data: baris, error: null });
    expect(ops).toEqual([
      ['from', 'layanan'],
      ['select', KOLOM_LAYANAN_RINGKAS],
      ['order', 'nama'],
    ]);
  });

  it('galat DB menjadi { data: null, error: pesan } tanpa melempar', async () => {
    const { sb } = buatKlien({ data: null, error: { message: 'permission denied' } });
    expect(await muatLayananRingkas(sb)).toEqual({ data: null, error: 'permission denied' });
  });

  it('galat tanpa pesan tetap berupa string tidak kosong (agar terbaca sebagai galat)', async () => {
    const { sb } = buatKlien({ data: null, error: { message: '' } });
    const hasil = await muatLayananRingkas(sb);
    expect(hasil.data).toBeNull();
    expect(typeof hasil.error).toBe('string');
    expect(hasil.error).not.toBe('');
  });

  it('jaringan putus (promise ditolak) menjadi galat, bukan pengecualian', async () => {
    const { sb } = buatKlien(new Error('Failed to fetch'));
    expect(await muatLayananRingkas(sb)).toEqual({ data: null, error: 'Failed to fetch' });
  });

  it('data null tanpa galat menjadi daftar kosong', async () => {
    const { sb } = buatKlien({ data: null, error: null });
    expect(await muatLayananRingkas(sb)).toEqual({ data: [], error: null });
  });
});

describe('muatLayananRingkas: migrasi Fase 1 (202610270001: slug, diarsipkan_at) belum diterapkan', () => {
  const KOLOM_LAMA = 'id, nama, form_pendataan';
  const galatKolom = (code: string): Hasil => ({
    data: null,
    error: { code, message: 'column layanan.slug does not exist' } as { message: string },
  });
  const barisLama = [
    { id: 'l1', nama: 'Helpdesk OSS', form_pendataan: 'oss' },
    { id: 'l2', nama: 'BPJS', form_pendataan: null },
  ];

  it('kolom fallback hanya kolom yang sudah ada sebelum Fase 1 (tanpa slug/diarsipkan_at)', () => {
    expect(KOLOM_LAYANAN_SEBELUM_FASE1).toBe(KOLOM_LAMA);
    expect(KOLOM_LAYANAN_SEBELUM_FASE1).not.toMatch(/slug|diarsipkan_at|\*/);
  });

  it.each(['42703', 'PGRST204'])('galat %s: kueri diulang dengan kolom lama; hasil tetap berbentuk LayananRingkas', async (code) => {
    const { sb, ops } = buatKlien([galatKolom(code), { data: barisLama, error: null }]);
    const hasil = await muatLayananRingkas(sb);
    expect(ops).toEqual([
      ['from', 'layanan'],
      ['select', KOLOM_LAYANAN_RINGKAS],
      ['order', 'nama'],
      ['from', 'layanan'],
      ['select', KOLOM_LAMA],
      ['order', 'nama'],
    ]);
    expect(hasil).toEqual({
      data: [
        { id: 'l1', nama: 'Helpdesk OSS', form_pendataan: 'oss', slug: null, diarsipkan_at: null },
        { id: 'l2', nama: 'BPJS', form_pendataan: null, slug: null, diarsipkan_at: null },
      ],
      error: null,
    });
  });

  it('galat selain "kolom belum ada" (izin, jaringan) tidak memicu fallback dan dilaporkan sebagai galat', async () => {
    const izin = buatKlien([{ data: null, error: { code: '42501', message: 'permission denied' } as { message: string } }]);
    expect(await muatLayananRingkas(izin.sb)).toEqual({ data: null, error: 'permission denied' });
    expect(izin.ops.filter(([n]) => n === 'from')).toHaveLength(1);

    const putus = buatKlien(new Error('Failed to fetch'));
    expect(await muatLayananRingkas(putus.sb)).toEqual({ data: null, error: 'Failed to fetch' });
    expect(putus.ops.filter(([n]) => n === 'from')).toHaveLength(1);
  });

  it('tabel belum ada (42P01) juga bukan alasan fallback', async () => {
    const { sb, ops } = buatKlien([galatKolom('42P01')]);
    const hasil = await muatLayananRingkas(sb);
    expect(hasil.data).toBeNull();
    expect(ops.filter(([n]) => n === 'from')).toHaveLength(1);
  });

  it('fallback sendiri gagal: galat fallback dilaporkan, bukan data kosong', async () => {
    const { sb } = buatKlien([galatKolom('42703'), { data: null, error: { message: 'timeout' } }]);
    expect(await muatLayananRingkas(sb)).toEqual({ data: null, error: 'timeout' });
  });

  it('migrasi sudah diterapkan: satu kueri penuh, tanpa fallback', async () => {
    const baris = [{ id: 'l1', nama: 'X', slug: 'x', form_pendataan: null, diarsipkan_at: null }];
    const { sb, ops } = buatKlien([{ data: baris, error: null }]);
    expect(await muatLayananRingkas(sb)).toEqual({ data: baris, error: null });
    expect(ops.filter(([n]) => n === 'from')).toHaveLength(1);
  });
});

describe('muatPetugasRingkas', () => {
  it('membaca petugas dengan kolom eksplisit dan urut nama', async () => {
    const baris = [{ id: 'p1', nama: 'Ani', role: 'petugas', layanan_id: 'l1', aktif: true }];
    const { sb, ops } = buatKlien({ data: baris, error: null });
    expect(await muatPetugasRingkas(sb)).toEqual({ data: baris, error: null });
    expect(ops).toEqual([
      ['from', 'petugas'],
      ['select', KOLOM_PETUGAS_RINGKAS],
      ['order', 'nama'],
    ]);
  });
});

describe('muatTopik (topik aktif satu layanan)', () => {
  it('menyaring aktif dan layanan, urut urut lalu nama', async () => {
    const baris = [{ id: 't1', nama: 'Konsultasi', urut: 1 }];
    const { sb, ops } = buatKlien({ data: baris, error: null });
    expect(await muatTopik(sb, 'l1')).toEqual({ data: baris, error: null });
    expect(ops).toEqual([
      ['from', 'topik_penanganan'],
      ['select', KOLOM_TOPIK],
      ['eq', 'aktif', true],
      ['eq', 'layanan_id', 'l1'],
      ['order', 'urut'],
      ['order', 'nama'],
    ]);
  });

  it('galat dikembalikan sebagai string', async () => {
    const { sb } = buatKlien({ data: null, error: { message: 'boom' } });
    expect(await muatTopik(sb, 'l1')).toEqual({ data: null, error: 'boom' });
  });
});

describe('muatSemuaTopik (kelola topik, Admin: semua cakupan, termasuk nonaktif)', () => {
  it('tanpa saringan; urut urut lalu nama; kolom admin', async () => {
    const baris = [{ id: 't1', layanan_id: null, nama: 'Informasi umum', aktif: true, urut: 1 }];
    const { sb, ops } = buatKlien({ data: baris, error: null });
    expect(await muatSemuaTopik(sb)).toEqual({ data: baris, error: null });
    expect(ops).toEqual([
      ['from', 'topik_penanganan'],
      ['select', KOLOM_TOPIK_ADMIN],
      ['order', 'urut'],
      ['order', 'nama'],
    ]);
  });
});

describe('muatHariLibur', () => {
  it('rentang tanggal inklusif, urut tanggal', async () => {
    const baris = [{ tanggal: '2026-12-25', keterangan: 'Natal' }];
    const { sb, ops } = buatKlien({ data: baris, error: null });
    expect(await muatHariLibur(sb, '2026-12-01', '2026-12-31')).toEqual({ data: baris, error: null });
    expect(ops).toEqual([
      ['from', 'hari_libur'],
      ['select', KOLOM_HARI_LIBUR],
      ['gte', 'tanggal', '2026-12-01'],
      ['lte', 'tanggal', '2026-12-31'],
      ['order', 'tanggal'],
    ]);
  });
});
