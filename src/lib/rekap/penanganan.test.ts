import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPenangananQuery,
  kunciHasil,
  mapRawPenangananRow,
  ringkasPenanganan,
  tentukanCakupan,
  type RekapPenangananRow,
} from './penanganan';
import { buatHRekap, buatKlienRekap } from '@/test/rekap-supabase-mock';

function baris(sebagian: Partial<RekapPenangananRow> = {}): RekapPenangananRow {
  return {
    id: 'x', kunjungan_id: 'k', tahap_ke: 1, peran_tahap: 'fo', layanan_id: null, layanan_nama: null,
    saluran: 'walk_in', penangan_id: 'fo-1', penangan_nama: 'Sari', status: 'selesai', hasil: 'selesai',
    topik: 'Informasi umum', catatan: 'ok', batal_karena: null,
    mulai_at: '2026-10-12T02:00:00Z', selesai_at: '2026-10-12T02:10:00Z', created_at: '2026-10-12T02:00:00Z',
    tanggal: '2026-10-12', durasi_menit: 10, pengunjung_nama: 'Budi', pengunjung_instansi: 'CV Maju', tiket: null,
    ...sebagian,
  };
}

describe('tentukanCakupan (hak akses rekap penanganan)', () => {
  const FO = { id: 'fo-1', role: 'front_office', layanan_id: null };
  const ADMIN = { id: 'a-1', role: 'admin', layanan_id: null };
  const PTG = { id: 'p-1', role: 'petugas', layanan_id: 'lyn-oss' };

  it('FO hanya melihat penanganan miliknya, apa pun filter yang dikirim', () => {
    expect(tentukanCakupan(FO, { peran: 'fo' })).toEqual({ ok: true, penanganId: 'fo-1', layananId: null, eskalasiFoId: null });
    expect(tentukanCakupan(FO, { peran: 'fo', petugas_id: 'fo-1' })).toMatchObject({ ok: true, penanganId: 'fo-1' });
  });

  it('FO yang meminta FO lain ditolak 403', () => {
    expect(tentukanCakupan(FO, { peran: 'fo', petugas_id: 'fo-2' })).toMatchObject({ ok: false, status: 403 });
  });

  it('Admin melihat semua FO dan boleh memfilter satu FO', () => {
    expect(tentukanCakupan(ADMIN, { peran: 'fo' })).toEqual({ ok: true, penanganId: null, layananId: null, eskalasiFoId: null });
    expect(tentukanCakupan(ADMIN, { peran: 'fo', petugas_id: 'fo-9' })).toMatchObject({ penanganId: 'fo-9' });
  });

  it('Petugas ditolak untuk rekap FO', () => {
    expect(tentukanCakupan(PTG, { peran: 'fo' })).toMatchObject({ ok: false, status: 403 });
  });

  it('rekap layanan: Petugas dikunci ke layanannya; layanan lain atau tanpa layanan ditolak', () => {
    expect(tentukanCakupan(PTG, { peran: 'layanan' })).toMatchObject({ ok: true, layananId: 'lyn-oss' });
    expect(tentukanCakupan(PTG, { peran: 'layanan', layanan_id: 'lyn-oss' })).toMatchObject({ ok: true });
    expect(tentukanCakupan(PTG, { peran: 'layanan', layanan_id: 'lyn-lain' })).toMatchObject({ ok: false });
    expect(tentukanCakupan({ ...PTG, layanan_id: null }, { peran: 'layanan' })).toMatchObject({ ok: false });
  });

  it('rekap layanan: Admin semua tanpa batas eskalasi; Petugas tanpa batas eskalasi', () => {
    expect(tentukanCakupan(ADMIN, { peran: 'layanan', layanan_id: 'lyn-x' })).toEqual({
      ok: true, penanganId: null, layananId: 'lyn-x', eskalasiFoId: null,
    });
    expect(tentukanCakupan(PTG, { peran: 'layanan' })).toMatchObject({ eskalasiFoId: null });
  });

  it('rekap layanan: Front Office diizinkan, dibatasi ke eskalasi asal dirinya (id dari sesi, bukan input)', () => {
    expect(tentukanCakupan(FO, { peran: 'layanan' })).toEqual({
      ok: true, penanganId: null, layananId: null, eskalasiFoId: 'fo-1',
    });
    // Filter petugas/layanan opsional tetap di dalam cakupan eskalasi FO.
    expect(tentukanCakupan(FO, { peran: 'layanan', petugas_id: 'p-9', layanan_id: 'lyn-x' })).toEqual({
      ok: true, penanganId: 'p-9', layananId: 'lyn-x', eskalasiFoId: 'fo-1',
    });
  });

  it('peran tak dikenal ditolak untuk rekap layanan', () => {
    expect(tentukanCakupan({ id: 'x', role: 'pengunjung', layanan_id: null }, { peran: 'layanan' }))
      .toMatchObject({ ok: false, status: 403 });
  });
});

describe('mapRawPenangananRow', () => {
  it('menormalkan embed (objek/larik), menurunkan tanggal WIB dan durasi', () => {
    const r = mapRawPenangananRow({
      id: 'p1', kunjungan_id: 'k1', tahap_ke: 2, peran_tahap: 'layanan', layanan_id: 'l1', saluran: 'qr',
      penangan_id: 'u1', status: 'selesai', hasil: 'dikembalikan', topik: null, catatan: 'kembali',
      batal_karena: null, mulai_at: '2026-10-12T16:59:00Z', selesai_at: '2026-10-12T17:14:30Z', created_at: '2026-10-12T16:50:00Z',
      kunjungan: [{ nama: 'Andi', asal_instansi: 'PT X' }],
      petugas: { nama: 'Rina' },
      layanan: { nama: 'Helpdesk OSS' },
      tiket: { nomor_display: 'OS-003', tanggal: '2026-10-12', status: 'dikembalikan', pelayanan_oss: [{ nama_pemohon: 'A' }], pelayanan_perizinan: null },
    });
    expect(r.penangan_nama).toBe('Rina');
    expect(r.layanan_nama).toBe('Helpdesk OSS');
    expect(r.pengunjung_nama).toBe('Andi');
    expect(r.tanggal).toBe('2026-10-12'); // 23:59 WIB masih 12 Okt
    expect(r.durasi_menit).toBeCloseTo(15.5, 5);
    expect(r.tiket?.form_type).toBe('oss');
    expect(r.tiket?.status).toBe('dikembalikan');
  });

  it('tahap belum mulai/selesai: tanggal kosong dan durasi null', () => {
    const r = mapRawPenangananRow({ id: 'p', kunjungan_id: 'k', tahap_ke: 1, peran_tahap: 'fo', saluran: 'walk_in', status: 'menunggu', created_at: '2026-10-12T00:00:00Z' });
    expect(r.tanggal).toBe('');
    expect(r.durasi_menit).toBeNull();
    expect(r.penangan_nama).toBeNull();
  });

  it('00:00 WIB berikutnya (17:00 UTC) jatuh ke hari berikutnya', () => {
    const r = mapRawPenangananRow({ id: 'p', kunjungan_id: 'k', tahap_ke: 1, peran_tahap: 'fo', saluran: 'walk_in', status: 'berjalan', mulai_at: '2026-10-12T17:00:00Z', created_at: '2026-10-12T17:00:00Z' });
    expect(r.tanggal).toBe('2026-10-13');
  });
});

describe('buildPenangananQuery', () => {
  it('batas rentang = 00:00 WIB dari..sampai+1 (eksklusif)', async () => {
    const h = buatHRekap();
    const klien = buatKlienRekap(h) as unknown as SupabaseClient;
    await buildPenangananQuery(klien, {
      peran: 'fo', dari: '2026-10-12', sampai: '2026-10-13', penanganId: null, layananId: null, from: 0, to: 9,
    });
    const ops = h.log[0].ops;
    expect(ops).toContainEqual(['gte', ['mulai_at', '2026-10-11T17:00:00.000Z']]);
    expect(ops).toContainEqual(['lt', ['mulai_at', '2026-10-13T17:00:00.000Z']]);
    expect(h.log[0].range).toEqual([0, 9]);
  });

  it('filter penangan dan layanan dipasang bila ada; urutan deterministik (mulai_at, id)', async () => {
    const h = buatHRekap();
    const klien = buatKlienRekap(h) as unknown as SupabaseClient;
    await buildPenangananQuery(klien, {
      peran: 'layanan', dari: '2026-10-12', sampai: '2026-10-12', penanganId: 'u1', layananId: 'l1', from: 0, to: 9,
    });
    const ops = h.log[0].ops;
    expect(ops).toContainEqual(['eq', ['peran_tahap', 'layanan']]);
    expect(ops).toContainEqual(['eq', ['penangan_id', 'u1']]);
    expect(ops).toContainEqual(['eq', ['layanan_id', 'l1']]);
    expect(ops.filter(([m]) => m === 'order').map(([, a]) => a[0])).toEqual(['mulai_at', 'id']);
  });

  it('tanpa filter penangan/layanan tidak ada eq untuk keduanya', async () => {
    const h = buatHRekap();
    const klien = buatKlienRekap(h) as unknown as SupabaseClient;
    await buildPenangananQuery(klien, {
      peran: 'fo', dari: '2026-10-12', sampai: '2026-10-12', penanganId: null, layananId: null, from: 0, to: 9,
    });
    const kolomEq = h.log[0].ops.filter(([m]) => m === 'eq').map(([, a]) => a[0]);
    expect(kolomEq).toEqual(['peran_tahap']);
  });

  it('rekap layanan untuk FO: inner join bertingkat ke tahap FO pemanggil', async () => {
    const h = buatHRekap();
    const klien = buatKlienRekap(h) as unknown as SupabaseClient;
    await buildPenangananQuery(klien, {
      peran: 'layanan', dari: '2026-10-12', sampai: '2026-10-12', penanganId: null, layananId: null,
      eskalasiFoId: 'fo-1', from: 0, to: 9,
    });
    const ops = h.log[0].ops;
    const select = String(ops.find(([m]) => m === 'select')?.[1][0]);
    expect(select).toContain('kunjungan:kunjungan_id!inner(');
    expect(select).toContain('fo_asal:penanganan!kunjungan_id!inner(');
    expect(select).toContain('tiket:tiket_id(');
    expect(ops).toContainEqual(['eq', ['kunjungan.fo_asal.peran_tahap', 'fo']]);
    expect(ops).toContainEqual(['eq', ['kunjungan.fo_asal.penangan_id', 'fo-1']]);
  });

  it('eskalasiFoId diabaikan untuk peran fo dan bila kosong (Admin/Petugas tidak berubah)', async () => {
    for (const p of [
      { peran: 'fo' as const, eskalasiFoId: 'fo-1' },
      { peran: 'layanan' as const, eskalasiFoId: null },
    ]) {
      const h = buatHRekap();
      const klien = buatKlienRekap(h) as unknown as SupabaseClient;
      await buildPenangananQuery(klien, {
        ...p, dari: '2026-10-12', sampai: '2026-10-12', penanganId: null, layananId: null, from: 0, to: 9,
      });
      const ops = h.log[0].ops;
      expect(String(ops.find(([m]) => m === 'select')?.[1][0])).not.toContain('!inner');
      expect(ops.filter(([m]) => m === 'eq').map(([, a]) => a[0])).toEqual(['peran_tahap']);
    }
  });
});

describe('ringkasPenanganan', () => {
  it('menghitung per hasil, per topik, dan per FO per hari', () => {
    const rows = [
      baris({ id: '1' }),
      baris({ id: '2', hasil: 'dieskalasi', topik: 'Perizinan', durasi_menit: 20 }),
      baris({ id: '3', penangan_id: 'fo-2', penangan_nama: 'Dewi', topik: 'Informasi umum', durasi_menit: 6 }),
      baris({ id: '4', tanggal: '2026-10-13', status: 'berjalan', hasil: null, topik: null, selesai_at: null, durasi_menit: null }),
      baris({ id: '5', status: 'batal', hasil: null, batal_karena: 'diambil_alih', topik: null }),
    ];
    const r = ringkasPenanganan(rows);
    expect(r.total).toBe(5);
    expect(Object.fromEntries(r.per_hasil.map((h) => [h.kunci, h.jumlah]))).toEqual({
      selesai: 2, dieskalasi: 1, dikembalikan: 0, belum_ditutup: 1, batal: 1,
    });
    expect(r.per_topik).toEqual([
      { topik: 'Informasi umum', jumlah: 2 },
      { topik: 'Perizinan', jumlah: 1 },
    ]);
    const sari12 = r.per_penangan_hari.find((g) => g.nama === 'Sari' && g.tanggal === '2026-10-12');
    expect(sari12).toMatchObject({ total: 3, selesai: 1, dieskalasi: 1, batal: 1 });
    expect(sari12?.rata_durasi_menit).toBeCloseTo((10 + 20 + 10) / 3, 5);
    const urutan = r.per_penangan_hari.map((g) => `${g.tanggal}/${g.nama}`);
    expect(urutan).toEqual(['2026-10-12/Dewi', '2026-10-12/Sari', '2026-10-13/Sari']);
  });

  it('rekap kosong: semua jumlah nol, tanpa pembagian nol', () => {
    const r = ringkasPenanganan([]);
    expect(r.total).toBe(0);
    expect(r.per_hasil.every((h) => h.jumlah === 0)).toBe(true);
    expect(r.per_penangan_hari).toEqual([]);
  });

  it('tahap tanpa topik tampil sebagai (tanpa topik); status asing dianggap belum ditutup', () => {
    const r = ringkasPenanganan([baris({ topik: null, hasil: 'dikembalikan' })]);
    expect(r.per_topik).toEqual([{ topik: '(tanpa topik)', jumlah: 1 }]);
    expect(kunciHasil({ status: 'aneh', hasil: null })).toBe('belum_ditutup');
  });
});
