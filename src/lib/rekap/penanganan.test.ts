import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPenangananQuery,
  kunciHasil,
  mapRawPenangananRow,
  namaFoSebelum,
  foSebelum,
  daftarOpsiFo,
  emailRekap,
  saringFo,
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
    tanggal: '2026-10-12', durasi_menit: 10, pengunjung_nama: 'Budi', pengunjung_instansi: 'CV Maju', email: null, tiket: null,
    fo_nama: 'Sari', fo_id: 'fo-1',
    ...sebagian,
  };
}

describe('tentukanCakupan (hak akses rekap penanganan)', () => {
  const FO = { id: 'fo-1', role: 'front_office', layanan_id: null };
  const ADMIN = { id: 'a-1', role: 'admin', layanan_id: null };
  const PTG = { id: 'p-1', role: 'petugas', layanan_id: 'lyn-oss' };

  // Keputusan CEO 2026-10-14 (keterbukaan data antar FO): FO setara Admin untuk cakupan baca rekap.
  it('rekap FO: Front Office melihat SEMUA FO dan boleh memfilter FO mana pun (termasuk FO lain)', () => {
    expect(tentukanCakupan(FO, { peran: 'fo' })).toEqual({ ok: true, penanganId: null, layananId: null });
    expect(tentukanCakupan(FO, { peran: 'fo', petugas_id: 'fo-1' })).toEqual({ ok: true, penanganId: 'fo-1', layananId: null });
    expect(tentukanCakupan(FO, { peran: 'fo', petugas_id: 'fo-2' })).toEqual({ ok: true, penanganId: 'fo-2', layananId: null });
  });

  it('Admin melihat semua FO dan boleh memfilter satu FO', () => {
    expect(tentukanCakupan(ADMIN, { peran: 'fo' })).toEqual({ ok: true, penanganId: null, layananId: null });
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

  it('rekap layanan: Admin dan Front Office semua, filter petugas/layanan opsional (tanpa batas "eskalasi asal")', () => {
    for (const me of [ADMIN, FO]) {
      expect(tentukanCakupan(me, { peran: 'layanan' })).toEqual({ ok: true, penanganId: null, layananId: null });
      expect(tentukanCakupan(me, { peran: 'layanan', petugas_id: 'p-9', layanan_id: 'lyn-x' })).toEqual({
        ok: true, penanganId: 'p-9', layananId: 'lyn-x',
      });
    }
  });

  it('peran tak dikenal ditolak untuk rekap layanan', () => {
    expect(tentukanCakupan({ id: 'x', role: 'pengunjung', layanan_id: null }, { peran: 'layanan' }))
      .toMatchObject({ ok: false, status: 403 });
  });
});

describe('emailRekap (kolom Email rekap, 202610140015)', () => {
  it('Pendataan tiket -> Pendataan terbaru kunjungan (eskalasi) -> email kunjungan -> null', () => {
    const kunj = {
      email: 'fo@x.id',
      pelayanan_oss: [{ email: 'lama@x.id', updated_at: '2026-10-12T01:00:00Z' }, { email: 'baru@x.id', updated_at: '2026-10-12T03:00:00Z' }],
      pelayanan_perizinan: [],
    };
    expect(emailRekap(kunj, { pelayanan_oss: { email: 'tiket@x.id' } })).toBe('tiket@x.id');
    expect(emailRekap(kunj, null)).toBe('baru@x.id');
    expect(emailRekap({ email: ' fo@x.id ', pelayanan_oss: [{ email: '  ' }] }, null)).toBe('fo@x.id');
    expect(emailRekap({ email: null }, null)).toBeNull();
    const fo = mapRawPenangananRow({
      id: 'p', kunjungan_id: 'k', tahap_ke: 1, peran_tahap: 'fo', saluran: 'walk_in', status: 'selesai',
      created_at: '2026-10-12T00:00:00Z', kunjungan: { nama: 'A', email: null, pelayanan_perizinan: [{ email: 'Tidak berlaku' }] },
    });
    expect(fo.email).toBe('Tidak berlaku');
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

  it('fo_nama: peran fo = penangan; peran layanan = FO tahap fo terakhir SEBELUM tahap ini', () => {
    const fo = mapRawPenangananRow({ id: 'p', kunjungan_id: 'k', tahap_ke: 1, peran_tahap: 'fo', saluran: 'walk_in', status: 'selesai', created_at: '2026-10-12T00:00:00Z', petugas: { nama: 'Sari' } });
    expect(fo.fo_nama).toBe('Sari');
    const tahap = [
      { tahap_ke: 1, peran_tahap: 'fo', penangan_id: 'fo-a', petugas: { nama: 'Ani (FO)' } },
      { tahap_ke: 2, peran_tahap: 'layanan', penangan_id: 'p-1', petugas: [{ nama: 'Rina' }] },
      { tahap_ke: 3, peran_tahap: 'fo', penangan_id: 'fo-b', petugas: [{ nama: 'Bayu (FO)' }] },
      { tahap_ke: 4, peran_tahap: 'layanan', penangan_id: null, petugas: null },
      { tahap_ke: 5, peran_tahap: 'fo', penangan_id: 'fo-c', petugas: { nama: 'Citra (FO, sesudah)' } },
    ];
    const lyn = (ke: number) => mapRawPenangananRow({
      id: `p${ke}`, kunjungan_id: 'k', tahap_ke: ke, peran_tahap: 'layanan', saluran: 'walk_in', status: 'selesai',
      created_at: '2026-10-12T00:00:00Z', petugas: { nama: 'Rina' }, kunjungan: { nama: 'Andi', tahap_fo: tahap },
    });
    expect(lyn(2).fo_nama).toBe('Ani (FO)');
    // Dikembalikan lalu diambil FO lain: tahap layanan berikutnya menampilkan FO terakhir sebelum tahap itu.
    expect(lyn(4).fo_nama).toBe('Bayu (FO)');
  });

  it('fo_nama null bila tidak ada tahap FO sebelumnya (mis. chat diambil langsung petugas)', () => {
    const r = mapRawPenangananRow({
      id: 'p', kunjungan_id: 'k', tahap_ke: 1, peran_tahap: 'layanan', saluran: 'chat', status: 'berjalan',
      created_at: '2026-10-12T00:00:00Z', kunjungan: [{ nama: 'Andi', tahap_fo: [{ tahap_ke: 1, peran_tahap: 'layanan', penangan_id: 'p-1' }] }],
    });
    expect(r.fo_nama).toBeNull();
    expect(namaFoSebelum(null, 3)).toBeNull();
    expect(namaFoSebelum([{ tahap_ke: 1, peran_tahap: 'fo', penangan_id: null, petugas: null }], 3)).toBeNull();
  });

  it('fo_id ikut dipetakan: peran fo = penangan; peran layanan = FO tahap fo sebelumnya; null bila tak diketahui', () => {
    const fo = mapRawPenangananRow({ id: 'p', kunjungan_id: 'k', tahap_ke: 1, peran_tahap: 'fo', penangan_id: 'fo-a', saluran: 'walk_in', status: 'selesai', created_at: '2026-10-12T00:00:00Z', petugas: { nama: 'Sari' } });
    expect(fo.fo_id).toBe('fo-a');
    const lyn = mapRawPenangananRow({
      id: 'p2', kunjungan_id: 'k', tahap_ke: 2, peran_tahap: 'layanan', saluran: 'walk_in', status: 'selesai', created_at: '2026-10-12T00:00:00Z',
      kunjungan: { nama: 'A', tahap_fo: [{ tahap_ke: 1, peran_tahap: 'fo', penangan_id: 'fo-a', petugas: { nama: 'Ani' } }] },
    });
    expect([lyn.fo_id, lyn.fo_nama]).toEqual(['fo-a', 'Ani']);
    const tanpa = mapRawPenangananRow({ id: 'p3', kunjungan_id: 'k', tahap_ke: 1, peran_tahap: 'layanan', saluran: 'chat', status: 'berjalan', created_at: '2026-10-12T00:00:00Z' });
    expect([tanpa.fo_id, tanpa.fo_nama]).toEqual([null, null]);
  });

  it('foSebelum(Infinity) = FO terakhir pada kunjungan; daftarOpsiFo unik + urut nama; saringFo', () => {
    const tahap = [
      { tahap_ke: 1, peran_tahap: 'fo', penangan_id: 'fo-a', petugas: { nama: 'Ani' } },
      { tahap_ke: 4, peran_tahap: 'fo', penangan_id: 'fo-b', petugas: { nama: 'Bayu' } },
    ];
    expect(foSebelum(tahap, Infinity)).toEqual({ id: 'fo-b', nama: 'Bayu' });
    expect(foSebelum(tahap, 4)).toEqual({ id: 'fo-a', nama: 'Ani' });
    const rows = [
      { fo_id: 'fo-b', fo_nama: 'Bayu' }, { fo_id: 'fo-a', fo_nama: 'Ani' }, { fo_id: 'fo-b', fo_nama: 'Bayu' }, { fo_id: null, fo_nama: null },
    ];
    expect(daftarOpsiFo(rows)).toEqual([{ id: 'fo-a', nama: 'Ani' }, { id: 'fo-b', nama: 'Bayu' }]);
    expect(saringFo(rows, 'fo-b')).toHaveLength(2);
    expect(saringFo(rows, null)).toHaveLength(4);
    expect(saringFo(rows, undefined)).toHaveLength(4);
    expect(saringFo(rows, 'tidak-ada')).toEqual([]);
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

  it('rekap layanan: embed tahap kunjungan (nama FO) tanpa inner join; tidak ada filter cakupan per FO', async () => {
    const h = buatHRekap();
    const klien = buatKlienRekap(h) as unknown as SupabaseClient;
    await buildPenangananQuery(klien, {
      peran: 'layanan', dari: '2026-10-12', sampai: '2026-10-12', penanganId: null, layananId: null, from: 0, to: 9,
    });
    const ops = h.log[0].ops;
    const select = String(ops.find(([m]) => m === 'select')?.[1][0]);
    expect(select).toContain('tahap_fo:penanganan!kunjungan_id(tahap_ke, peran_tahap, penangan_id, petugas:penangan_id(nama))');
    expect(select).toContain('tiket:tiket_id(');
    expect(select).not.toContain('!inner');
    expect(ops.filter(([m]) => m === 'eq').map(([, a]) => a[0])).toEqual(['peran_tahap']);
  });

  it('rekap FO: tanpa embed tahap kunjungan dan tanpa tiket', async () => {
    const h = buatHRekap();
    const klien = buatKlienRekap(h) as unknown as SupabaseClient;
    await buildPenangananQuery(klien, {
      peran: 'fo', dari: '2026-10-12', sampai: '2026-10-12', penanganId: null, layananId: null, from: 0, to: 9,
    });
    const select = String(h.log[0].ops.find(([m]) => m === 'select')?.[1][0]);
    expect(select).not.toContain('tahap_fo');
    expect(select).not.toContain('tiket:');
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
