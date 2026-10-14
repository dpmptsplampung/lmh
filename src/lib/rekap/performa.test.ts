import { describe, it, expect } from 'vitest';
import { bagi, hitungMetrik, hitungPerforma, type BarisPerforma } from './performa';

let n = 0;
function b(s: Partial<BarisPerforma>): BarisPerforma {
  n += 1;
  return {
    id: `r${n}`, kunjungan_id: `k${n}`, peran_tahap: 'fo', layanan_id: null, penangan_id: 'fo-1', status: 'selesai',
    hasil: 'selesai', mulai_at: '2026-10-12T02:00:00Z', selesai_at: '2026-10-12T02:10:00Z', created_at: '2026-10-12T02:00:00Z',
    ...s,
  };
}

describe('hitungMetrik', () => {
  it('tingkat eskalasi = dieskalasi / tahap FO selesai; pengembalian = dikembalikan / tahap layanan selesai', () => {
    const fo = [b({}), b({ hasil: 'dieskalasi' }), b({ hasil: 'dieskalasi' }), b({})];
    const m = hitungMetrik(fo);
    expect(m.tahap_selesai).toBe(4);
    expect(m.dieskalasi).toBe(2);
    expect(m.selesai_langsung).toBe(2);
    expect(m.tingkat_eskalasi).toBe(0.5);
    expect(m.tingkat_pengembalian).toBe(0);

    const lyn = [
      b({ peran_tahap: 'layanan', layanan_id: 'l1', hasil: 'dikembalikan' }),
      b({ peran_tahap: 'layanan', layanan_id: 'l1' }),
      b({ peran_tahap: 'layanan', layanan_id: 'l1' }),
      b({ peran_tahap: 'layanan', layanan_id: 'l1' }),
    ];
    expect(hitungMetrik(lyn).tingkat_pengembalian).toBe(0.25);
  });

  it('pembagi nol -> null (bukan 0 atau NaN)', () => {
    const m = hitungMetrik([]);
    expect(m.tingkat_eskalasi).toBeNull();
    expect(m.tingkat_pengembalian).toBeNull();
    expect(m.rata_durasi_menit).toBeNull();
    expect(m.rata_tunggu_menit).toBeNull();
    expect(bagi(3, 0)).toBeNull();
    // hanya tahap berjalan/batal: belum ada yang selesai -> tingkat tetap null
    const m2 = hitungMetrik([b({ status: 'berjalan', hasil: null, selesai_at: null }), b({ status: 'batal', hasil: null })]);
    expect(m2.tingkat_eskalasi).toBeNull();
    expect(m2).toMatchObject({ tahap_selesai: 0, berjalan: 1, batal: 1 });
  });

  it('durasi = selesai - mulai; waktu tunggu layanan = mulai - created_at (tahap FO tidak dihitung)', () => {
    const lyn = [
      b({ peran_tahap: 'layanan', layanan_id: 'l', created_at: '2026-10-12T02:00:00Z', mulai_at: '2026-10-12T02:06:00Z', selesai_at: '2026-10-12T02:36:00Z' }),
      b({ peran_tahap: 'layanan', layanan_id: 'l', created_at: '2026-10-12T03:00:00Z', mulai_at: '2026-10-12T03:02:00Z', selesai_at: '2026-10-12T03:12:00Z' }),
    ];
    const m = hitungMetrik(lyn);
    expect(m.rata_durasi_menit).toBe(20);
    expect(m.rata_tunggu_menit).toBe(4);
    expect(hitungMetrik([b({ created_at: '2026-10-12T01:00:00Z' })]).rata_tunggu_menit).toBeNull();
  });

  it('pengunjung dihitung berbeda (kunjungan yang sama dua tahap = satu)', () => {
    const m = hitungMetrik([b({ kunjungan_id: 'kk' }), b({ kunjungan_id: 'kk' }), b({ kunjungan_id: 'k2' })]);
    expect(m.tahap_selesai).toBe(3);
    expect(m.pengunjung).toBe(2);
  });
});

describe('hitungPerforma', () => {
  it('per orang, per layanan, per hari (batas WIB), pengunjung dilayani lintas peran', () => {
    const rows = [
      // 23:59 WIB 12 Okt -> hari 12
      b({ kunjungan_id: 'A', mulai_at: '2026-10-12T16:59:00Z', selesai_at: '2026-10-12T16:59:30Z', hasil: 'dieskalasi' }),
      // 00:00 WIB 13 Okt -> hari 13
      b({ kunjungan_id: 'B', mulai_at: '2026-10-12T17:00:00Z', selesai_at: '2026-10-12T17:05:00Z' }),
      b({ kunjungan_id: 'A', peran_tahap: 'layanan', layanan_id: 'l1', penangan_id: 'p-1', mulai_at: '2026-10-13T02:00:00Z', created_at: '2026-10-13T01:49:30Z', selesai_at: '2026-10-13T02:20:00Z' }),
      b({ kunjungan_id: 'C', peran_tahap: 'layanan', layanan_id: 'l1', penangan_id: 'p-1', hasil: 'dikembalikan', mulai_at: '2026-10-13T03:00:00Z', created_at: '2026-10-13T02:50:00Z', selesai_at: '2026-10-13T03:10:00Z' }),
      // belum mulai: diabaikan
      b({ status: 'menunggu', hasil: null, mulai_at: null, selesai_at: null }),
    ];
    const p = hitungPerforma(rows, { 'fo-1': 'Sari', 'p-1': 'Rina' }, { l1: 'Helpdesk OSS' });
    expect(p.ringkasan.total_baris).toBe(4);
    expect(p.ringkasan.pengunjung_dilayani).toBe(3); // A, B, C
    expect(p.ringkasan.fo.tingkat_eskalasi).toBe(0.5);
    expect(p.ringkasan.layanan.tingkat_pengembalian).toBe(0.5);
    expect(p.per_hari.map((h) => h.tanggal)).toEqual(['2026-10-12', '2026-10-13']);
    expect(p.per_hari[0]).toMatchObject({ pengunjung: 1 });
    expect(p.per_hari[0].fo.tahap_selesai).toBe(1);
    expect(p.per_hari[1].fo.tahap_selesai).toBe(1);
    expect(p.per_hari[1].layanan.tahap_selesai).toBe(2);
    expect(p.per_orang.map((o) => `${o.nama}:${o.peran}`)).toEqual(['Rina:layanan', 'Sari:fo']);
    expect(p.per_layanan).toHaveLength(1);
    expect(p.per_layanan[0]).toMatchObject({ nama: 'Helpdesk OSS', tahap_selesai: 2, dikembalikan: 1 });
    expect(p.per_layanan[0].rata_tunggu_menit).toBeCloseTo(10.25, 5);
  });

  it('tanpa data: struktur kosong, semua tingkat null', () => {
    const p = hitungPerforma([]);
    expect(p.ringkasan.pengunjung_dilayani).toBe(0);
    expect(p.ringkasan.fo.tingkat_eskalasi).toBeNull();
    expect(p.per_orang).toEqual([]);
    expect(p.per_layanan).toEqual([]);
    expect(p.per_hari).toEqual([]);
  });

  it('nama tidak dikenal tidak membuat galat', () => {
    const p = hitungPerforma([b({ penangan_id: 'asing' })]);
    expect(p.per_orang[0].nama).toBe('(tidak dikenal)');
  });
});
