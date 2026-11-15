import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BATAS_TIKET_KLIEN,
  KOLOM_ABSENSI_REKAP,
  KOLOM_CATATAN_ESKALASI,
  KOLOM_TIKET_ANTREAN,
  KOLOM_TIKET_STATISTIK,
  PESAN_BATAS_TIKET,
  PESAN_DAFTAR_BERUBAH,
  galatAntreanDari,
  hitungStatistikSelesai,
  muatAbsensiRekap,
  muatAntrean,
  muatCatatanEskalasi,
  type ParamMuatAntrean,
} from './antrean';

// ── Klien tiruan: mencatat kueri yang DIKIRIM, menjawab dari data skenario, dan mengukur kueri yang berjalan bersamaan ──

type Baris = Record<string, unknown>;
type HasilDb = { data: unknown; count?: number | null; error: { message: string; code?: string } | null };
type Jenis = 'utama' | 'panel' | 'stats' | 'total' | 'catatan' | 'absensi' | 'lain';

interface Kueri {
  tabel: string;
  select: string;
  opsi: Record<string, unknown> | undefined;
  eq: Array<[string, unknown]>;
  in: Array<[string, readonly unknown[]]>;
  order: Array<[string, unknown]>;
  range: [number, number] | null;
}

function jenisKueri(k: Kueri): Jenis {
  if (k.tabel === 'penanganan') return 'catatan';
  if (k.tabel === 'absensi_petugas') return 'absensi';
  if (k.tabel === 'tiket_antrean') {
    if (k.opsi?.head) return 'total';
    if (k.eq.some(([kolom, nilai]) => kolom === 'status' && nilai === 'selesai')) return 'stats';
    if (k.range) return k.range[1] - k.range[0] === 199 ? 'panel' : 'utama';
  }
  return 'lain';
}

interface Skenario {
  rows?: Baris[];
  penanganan?: Baris[];
  absensi?: Baris[];
  /** Menimpa jawaban; `nomor` = urutan kueri jenis itu (mulai 1). Lempar untuk mensimulasikan promise yang menolak. */
  timpa?: (jenis: Jenis, nomor: number, k: Kueri) => Partial<HasilDb> | undefined;
  rpc?: (nama: string, args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null };
  latensiMs?: number;
}

function saring(rows: Baris[], k: Kueri): Baris[] {
  let hasil = rows;
  for (const [kolom, nilai] of k.eq) if (hasil.length && kolom in hasil[0]) hasil = hasil.filter((r) => r[kolom] === nilai);
  for (const [kolom, daftar] of k.in) hasil = hasil.filter((r) => daftar.includes(r[kolom]));
  return hasil;
}

function buatKlien(skn: Skenario = {}) {
  const log: Kueri[] = [];
  const nomorPerJenis: Partial<Record<Jenis, number>> = {};
  let aktif = 0;
  let maksBersamaan = 0;

  const jawabDefault = (jenis: Jenis, k: Kueri): HasilDb => {
    const rows = skn.rows ?? [];
    switch (jenis) {
      case 'utama':
      case 'panel': {
        const cocok = saring(rows, k);
        const [dari, sampai] = k.range as [number, number];
        return { data: cocok.slice(dari, sampai + 1), count: cocok.length, error: null };
      }
      case 'stats': {
        const cocok = saring(rows, k);
        return {
          data: cocok.map((r) => ({ waktu_mulai_layan: r.waktu_mulai_layan, waktu_selesai: r.waktu_selesai })),
          count: cocok.length,
          error: null,
        };
      }
      case 'total':
        return { data: null, count: saring(rows, k).length, error: null };
      case 'catatan': {
        const ids = (k.in.find(([kolom]) => kolom === 'id')?.[1] ?? []) as string[];
        return { data: (skn.penanganan ?? []).filter((p) => ids.includes(p.id as string)), error: null };
      }
      case 'absensi':
        return { data: skn.absensi ?? [], error: null };
      default:
        return { data: [], error: null };
    }
  };

  const jawab = async (k: Kueri): Promise<HasilDb> => {
    const jenis = jenisKueri(k);
    const nomor = (nomorPerJenis[jenis] = (nomorPerJenis[jenis] ?? 0) + 1);
    aktif += 1;
    maksBersamaan = Math.max(maksBersamaan, aktif);
    try {
      await new Promise((r) => setTimeout(r, skn.latensiMs ?? 3));
      const timpaan = skn.timpa?.(jenis, nomor, k);
      return timpaan ? { data: null, count: null, error: null, ...timpaan } : jawabDefault(jenis, k);
    } finally {
      aktif -= 1;
    }
  };

  const from = vi.fn((tabel: string) => {
    const k: Kueri = { tabel, select: '', opsi: undefined, eq: [], in: [], order: [], range: null };
    const b: Record<string, unknown> = {};
    b.select = (s: string, o?: Record<string, unknown>) => { k.select = s; k.opsi = o; return b; };
    b.eq = (kolom: string, nilai: unknown) => { k.eq.push([kolom, nilai]); return b; };
    b.in = (kolom: string, nilai: readonly unknown[]) => { k.in.push([kolom, nilai]); return b; };
    b.order = (kolom: string, o?: unknown) => { k.order.push([kolom, o]); return b; };
    b.range = (dari: number, sampai: number) => { k.range = [dari, sampai]; return b; };
    b.then = (selesai: (v: HasilDb) => unknown, tolak?: (e: unknown) => unknown) => {
      log.push(k);
      return jawab(k).then(selesai, tolak);
    };
    return b;
  });
  const rpc = vi.fn((nama: string, args: Record<string, unknown> = {}) =>
    Promise.resolve(skn.rpc ? skn.rpc(nama, args) : { data: null, error: { code: 'PGRST202', message: 'fungsi tidak ada' } }),
  );
  const sb = { from, rpc } as unknown as SupabaseClient;
  return { sb, log, from, rpc, maksBersamaan: () => maksBersamaan };
}

type Klien = ReturnType<typeof buatKlien>;
const kueriJenis = (klien: Klien, jenis: Jenis) => klien.log.filter((k) => jenisKueri(k) === jenis);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const tiket = (n: number, over: Baris = {}): Baris => ({
  id: `t-${n}`,
  kunjungan_id: `k-${n}`,
  legacy_visit_id: `v-${n}`,
  layanan_id: 'l-1',
  dilayani_oleh: null,
  penanganan_asal_id: null,
  nomor: n,
  nomor_display: `A-${String(n).padStart(3, '0')}`,
  status: 'menunggu',
  waktu_terbit: '2026-11-04T01:00:00.000Z',
  waktu_mulai_layan: null,
  waktu_selesai: null,
  layanan: { nama: 'Helpdesk OSS', form_pendataan: 'oss' },
  pelayan: null,
  kunjungan: { nama: `Tamu ${n}`, asal: 'walk_in', waktu_masuk: '2026-11-04T01:00:00.000Z' },
  ...over,
});
const selesaiMenit = (n: number, menit: number, over: Baris = {}) =>
  tiket(n, {
    status: 'selesai',
    waktu_mulai_layan: '2026-11-04T02:00:00.000Z',
    waktu_selesai: new Date(Date.parse('2026-11-04T02:00:00.000Z') + menit * 60_000).toISOString(),
    ...over,
  });

const param = (over: Partial<ParamMuatAntrean> = {}): ParamMuatAntrean => ({
  tanggal: '2026-11-04',
  status: ['menunggu', 'dilayani'],
  halaman: 0,
  ukuranHalaman: 25,
  peran: 'admin',
  layananId: null,
  denganPanel: true,
  ...over,
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('kolom antrean', () => {
  it('eksplisit (tanpa bintang) dan sesuai kontrak halaman', () => {
    for (const k of [KOLOM_TIKET_ANTREAN, KOLOM_TIKET_STATISTIK, KOLOM_CATATAN_ESKALASI, KOLOM_ABSENSI_REKAP]) {
      expect(k).not.toContain('*');
    }
    for (const kolom of ['id', 'kunjungan_id', 'legacy_visit_id', 'layanan_id', 'dilayani_oleh', 'penanganan_asal_id', 'nomor',
      'nomor_display', 'status', 'waktu_terbit', 'waktu_mulai_layan', 'waktu_selesai',
      'layanan:layanan_id(nama, form_pendataan)', 'pelayan:dilayani_oleh(nama)', 'kunjungan(nama, asal, waktu_masuk)']) {
      expect(norm(KOLOM_TIKET_ANTREAN)).toContain(kolom);
    }
    expect(KOLOM_TIKET_STATISTIK).toBe('waktu_mulai_layan, waktu_selesai');
    expect(KOLOM_CATATAN_ESKALASI).toBe('id, topik, catatan, penangan:penangan_id(nama)');
    expect(KOLOM_ABSENSI_REKAP).toBe('id, petugas_id, tanggal, jam_masuk, jam_pulang, status, petugas:petugas_id(nama)');
  });
});

describe('hitungStatistikSelesai', () => {
  it('rata-rata durasi dibulatkan; baris tanpa waktu tidak menambah durasi tetapi tetap dihitung; hitungan server diutamakan', () => {
    const rows = [
      { waktu_mulai_layan: '2026-11-04T02:00:00.000Z', waktu_selesai: '2026-11-04T02:10:00.000Z' },
      { waktu_mulai_layan: '2026-11-04T02:00:00.000Z', waktu_selesai: '2026-11-04T02:25:00.000Z' },
    ];
    expect(hitungStatistikSelesai(rows, 2)).toEqual({ totalSelesai: 2, rataWaktuMenit: 18 }); // 17,5 -> 18
    expect(hitungStatistikSelesai(rows, 40)).toEqual({ totalSelesai: 40, rataWaktuMenit: 18 });
    expect(hitungStatistikSelesai(rows, null)).toEqual({ totalSelesai: 2, rataWaktuMenit: 18 });
    expect(hitungStatistikSelesai([{ waktu_mulai_layan: null, waktu_selesai: '2026-11-04T02:25:00.000Z' }], 1))
      .toEqual({ totalSelesai: 1, rataWaktuMenit: 0 });
    expect(hitungStatistikSelesai([], 0)).toEqual({ totalSelesai: 0, rataWaktuMenit: 0 });
  });
});

describe('galatAntreanDari', () => {
  it('memilah galat: tanggal di luar batas, batas tiket, dan umum (objek asli tetap dibawa)', () => {
    const tanggal = { code: '22023', message: 'TANGGAL_DILUAR_BATAS: x' };
    expect(galatAntreanDari(tanggal)).toMatchObject({ jenis: 'tanggal_diluar_batas', asli: tanggal });
    expect(galatAntreanDari(new Error(PESAN_BATAS_TIKET))).toMatchObject({ jenis: 'batas_tiket', pesan: PESAN_BATAS_TIKET });
    const umum = { message: 'boom' };
    expect(galatAntreanDari(umum)).toEqual({ jenis: 'umum', pesan: 'boom', asli: umum });
    expect(galatAntreanDari(undefined).pesan.length).toBeGreaterThan(0);
    expect(galatAntreanDari('teks')).toMatchObject({ jenis: 'umum', pesan: 'teks' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('muatAntrean: kueri lama (Petugas, atau Admin/FO bila RPC belum ada)', () => {
  it('empat kueri (utama, panel, statistik, total harian) berjalan bersamaan dalam satu tahap', async () => {
    const klien = buatKlien({ rows: [tiket(1)] });
    const hasil = await muatAntrean(klien.sb, param());
    expect(hasil.error).toBeNull();
    expect(klien.log.map(jenisKueri).sort()).toEqual(['panel', 'stats', 'total', 'utama']);
    expect(klien.maksBersamaan()).toBe(4);
  });

  it('hasil gabungan: halaman tabel, panel, hitungan, statistik, total harian', async () => {
    const klien = buatKlien({
      rows: [tiket(1), tiket(2, { status: 'dilayani' }), selesaiMenit(3, 10), selesaiMenit(4, 25)],
    });
    const hasil = await muatAntrean(klien.sb, param({ status: null }));
    expect(hasil.error).toBeNull();
    const d = hasil.data!;
    expect(d.baris.map((b) => b.id)).toEqual(['t-1', 't-2', 't-3', 't-4']);
    expect(d.barisPanel.map((b) => b.id)).toEqual(['t-1', 't-2']);
    expect(d.totalTabel).toBe(4);
    expect(d.totalHarian).toBe(4);
    expect(d.statistik).toEqual({ totalSelesai: 2, rataWaktuMenit: 18 });
    expect(d.aksesFo).toBe(false);
  });

  it('bentuk tiap kueri: kolom eksplisit, tanggal, saringan status, urut, rentang, hitungan (Admin tanpa lingkup Layanan)', async () => {
    const klien = buatKlien({ rows: [tiket(1)] });
    await muatAntrean(klien.sb, param({ halaman: 2 }));
    const utama = kueriJenis(klien, 'utama')[0];
    expect(utama.tabel).toBe('tiket_antrean');
    expect(utama.select).toBe(KOLOM_TIKET_ANTREAN);
    expect(utama.opsi).toEqual({ count: 'exact' });
    expect(utama.eq).toEqual([['tanggal', '2026-11-04']]);
    expect(utama.in).toEqual([['status', ['menunggu', 'dilayani']]]);
    expect(utama.order).toEqual([['nomor', { ascending: true }]]);
    expect(utama.range).toEqual([50, 74]);

    const panel = kueriJenis(klien, 'panel')[0];
    expect(panel.select).toBe(KOLOM_TIKET_ANTREAN);
    expect(panel.opsi).toEqual({ count: 'exact' });
    expect(panel.eq).toEqual([['tanggal', '2026-11-04']]);
    expect(panel.in).toEqual([['status', ['menunggu', 'dilayani']]]);
    expect(panel.order).toEqual([['nomor', { ascending: true }]]);
    expect(panel.range).toEqual([0, 199]);

    const stats = kueriJenis(klien, 'stats')[0];
    expect(stats.select).toBe(KOLOM_TIKET_STATISTIK);
    expect(stats.opsi).toEqual({ count: 'exact' });
    expect(stats.eq).toEqual([['tanggal', '2026-11-04'], ['status', 'selesai']]);

    const total = kueriJenis(klien, 'total')[0];
    expect(total.select).toBe('id');
    expect(total.opsi).toEqual({ count: 'exact', head: true });
    expect(total.eq).toEqual([['tanggal', '2026-11-04']]);
    expect(total.in).toEqual([]);
  });

  it('Petugas: semua kueri tiket dibatasi ke Layanannya dan RPC FO tidak pernah dipanggil', async () => {
    const klien = buatKlien({ rows: [tiket(1), tiket(2, { layanan_id: 'l-2' })] });
    const hasil = await muatAntrean(klien.sb, param({ peran: 'petugas', layananId: 'l-1', status: null }));
    expect(klien.rpc).not.toHaveBeenCalled();
    for (const k of klien.log) expect(k.eq).toContainEqual(['layanan_id', 'l-1']);
    expect(hasil.data!.baris.map((b) => b.id)).toEqual(['t-1']);
    expect(hasil.data!.totalHarian).toBe(1);
  });

  it('Petugas tanpa Layanan di parameter: tidak ada saringan Layanan (pemanggil yang menolak lebih dulu)', async () => {
    const klien = buatKlien({ rows: [tiket(1)] });
    await muatAntrean(klien.sb, param({ peran: 'petugas', layananId: null }));
    for (const k of klien.log) expect(k.eq.some(([kolom]) => kolom === 'layanan_id')).toBe(false);
  });

  it('status null (tab Semua): kueri utama tanpa .in(status); panel tetap memakai menunggu+dilayani', async () => {
    const klien = buatKlien({ rows: [tiket(1)] });
    await muatAntrean(klien.sb, param({ status: null }));
    expect(kueriJenis(klien, 'utama')[0].in).toEqual([]);
    expect(kueriJenis(klien, 'panel')[0].in).toEqual([['status', ['menunggu', 'dilayani']]]);
  });

  it('tanpa panel (tab Selesai atau tanggal lain): kueri panel tidak dikirim dan barisPanel kosong', async () => {
    const klien = buatKlien({ rows: [selesaiMenit(1, 10)] });
    const hasil = await muatAntrean(klien.sb, param({ status: ['selesai'], denganPanel: false }));
    expect(klien.log.map(jenisKueri).sort()).toEqual(['stats', 'total', 'utama']);
    expect(hasil.data!.barisPanel).toEqual([]);
    expect(klien.maksBersamaan()).toBe(3);
  });

  it('panel dibaca bertahap per 200 sampai semua tiket aktif terkumpul', async () => {
    const klien = buatKlien({ rows: Array.from({ length: 250 }, (_, i) => tiket(i + 1)) });
    const hasil = await muatAntrean(klien.sb, param());
    expect(kueriJenis(klien, 'panel').map((k) => k.range)).toEqual([[0, 199], [200, 399]]);
    expect(hasil.data!.barisPanel).toHaveLength(250);
    expect(hasil.data!.baris).toHaveLength(25);
    expect(hasil.data!.totalTabel).toBe(250);
  });

  it.each(['utama', 'panel', 'stats', 'total'] as const)('galat kueri %s menggagalkan seluruh muat (galat umum, objek asli dibawa)', async (jenis) => {
    const klien = buatKlien({
      rows: [tiket(1)],
      timpa: (j) => (j === jenis ? { error: { message: `boom ${jenis}`, code: 'XX000' } } : undefined),
    });
    const hasil = await muatAntrean(klien.sb, param());
    expect(hasil.data).toBeNull();
    expect(hasil.error).toEqual({ jenis: 'umum', pesan: `boom ${jenis}`, asli: { message: `boom ${jenis}`, code: 'XX000' } });
  });

  it('beberapa bagian galat sekaligus: yang dilaporkan mengikuti prioritas lama (utama, panel, statistik, total)', async () => {
    const galat = (jenis: Jenis) => ({ error: { message: `boom ${jenis}` } });
    const kasus: Array<[Jenis[], string]> = [
      [['total', 'stats', 'panel', 'utama'], 'boom utama'],
      [['total', 'stats', 'panel'], 'boom panel'],
      [['total', 'stats'], 'boom stats'],
      [['total'], 'boom total'],
    ];
    for (const [yangGalat, harapan] of kasus) {
      const klien = buatKlien({ rows: [tiket(1)], timpa: (j) => (yangGalat.includes(j) ? galat(j) : undefined) });
      const hasil = await muatAntrean(klien.sb, param());
      expect(hasil.error?.pesan).toBe(harapan);
    }
  });

  it('promise yang menolak (jaringan putus) menjadi galat umum, bukan pengecualian', async () => {
    const klien = buatKlien({
      rows: [tiket(1)],
      timpa: (jenis) => { if (jenis === 'stats') throw new TypeError('Failed to fetch'); return undefined; },
    });
    const hasil = await muatAntrean(klien.sb, param());
    expect(hasil.data).toBeNull();
    expect(hasil.error?.jenis).toBe('umum');
    expect(hasil.error?.pesan).toBe('Failed to fetch');
    expect(hasil.error?.asli).toBeInstanceOf(TypeError);
  });

  it('batas 10.000 tiket pada panel: galat batas_tiket dengan pesan tetap, tanpa data parsial', async () => {
    const klien = buatKlien({
      rows: [tiket(1)],
      timpa: (jenis) => (jenis === 'panel' ? { data: [tiket(1)], count: BATAS_TIKET_KLIEN + 1 } : undefined),
    });
    const hasil = await muatAntrean(klien.sb, param());
    expect(hasil.data).toBeNull();
    expect(hasil.error).toMatchObject({ jenis: 'batas_tiket', pesan: PESAN_BATAS_TIKET });
  });

  it('halaman panel kosong padahal hitungan masih ada: galat umum "Daftar antrean berubah"', async () => {
    const klien = buatKlien({
      rows: [tiket(1)],
      timpa: (jenis) => (jenis === 'panel' ? { data: [], count: 3 } : undefined),
    });
    const hasil = await muatAntrean(klien.sb, param());
    expect(hasil.error).toMatchObject({ jenis: 'umum', pesan: PESAN_DAFTAR_BERUBAH });
  });

  it('masihBerlaku false di tengah pembacaan panel: berhenti (tanpa halaman berikutnya) dan melapor basi', async () => {
    const klien = buatKlien({ rows: Array.from({ length: 450 }, (_, i) => tiket(i + 1)) });
    // pengecekan pertama (sebelum bacaan pendukung dikirim) lolos; setelah halaman panel pertama sudah basi
    let panggilan = 0;
    const hasil = await muatAntrean(klien.sb, param({ masihBerlaku: () => ++panggilan <= 1 }));
    expect(hasil.data).toBeNull();
    expect(hasil.error?.jenis).toBe('basi');
    expect(kueriJenis(klien, 'panel')).toHaveLength(1);
  });

  it('permintaan yang sudah digantikan sebelum bacaan pendukung dikirim: hanya bacaan utama yang dikirim, hasil basi', async () => {
    const klien = buatKlien({ rows: [tiket(1)] });
    const hasil = await muatAntrean(klien.sb, param({ masihBerlaku: () => false }));
    expect(hasil.data).toBeNull();
    expect(hasil.error?.jenis).toBe('basi');
    expect(klien.log.map(jenisKueri)).toEqual(['utama']);
  });

  it('permintaan yang masih berlaku mengirim keempat bacaan walau masihBerlaku diberikan', async () => {
    const klien = buatKlien({ rows: [tiket(1)] });
    const hasil = await muatAntrean(klien.sb, param({ masihBerlaku: () => true }));
    expect(hasil.error).toBeNull();
    expect(klien.log.map(jenisKueri).sort()).toEqual(['panel', 'stats', 'total', 'utama']);
    expect(klien.maksBersamaan()).toBe(4);
  });

  it('Admin/FO tanpa data (count null): hitungan jatuh ke panjang data, total harian ke 0', async () => {
    const klien = buatKlien({
      rows: [tiket(1)],
      timpa: (jenis) => (jenis === 'utama' ? { data: [tiket(1)], count: null } : jenis === 'total' ? { data: null, count: null } : undefined),
    });
    const hasil = await muatAntrean(klien.sb, param());
    expect(hasil.data!.totalTabel).toBe(1);
    expect(hasil.data!.totalHarian).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('muatAntrean: RPC fo_antrean_daftar (Admin dan Front Office)', () => {
  const rpcFo = (semua: Baris[], over: Record<string, unknown> = {}) =>
    (nama: string, a: Record<string, unknown>) => {
      if (nama !== 'fo_antrean_daftar') return { data: null, error: { message: 'tak dikenal' } };
      return {
        data: {
          rows: semua.slice(Number(a.p_lewati), Number(a.p_lewati) + Number(a.p_batas)),
          total: semua.length,
          statistik: { totalSelesai: 7, rataWaktuMenit: 9 },
          ...over,
        },
        error: null,
      };
    };
  const baruFo = (n: number, over: Baris = {}) => {
    const { legacy_visit_id: _l, ...dasar } = tiket(n, { fo_nama: 'Rina FO', ...over });
    void _l;
    return dasar;
  };

  it.each(['admin', 'front_office'])('%s: membaca lewat RPC (halaman 25, sisanya per 200), tanpa kueri tiket_antrean', async (peran) => {
    const semua = Array.from({ length: 60 }, (_, i) => baruFo(i + 1));
    const klien = buatKlien({ rpc: rpcFo(semua) });
    const hasil = await muatAntrean(klien.sb, param({ peran, status: null }));
    expect(hasil.error).toBeNull();
    expect(klien.rpc.mock.calls).toEqual([
      ['fo_antrean_daftar', { p_tanggal: '2026-11-04', p_layanan_id: null, p_batas: 25, p_lewati: 0 }],
      ['fo_antrean_daftar', { p_tanggal: '2026-11-04', p_layanan_id: null, p_batas: 200, p_lewati: 25 }],
    ]);
    expect(klien.from).not.toHaveBeenCalled();
    const d = hasil.data!;
    expect(d.aksesFo).toBe(true);
    expect(d.barisPanel).toHaveLength(60);
    expect(d.baris).toHaveLength(25);
    expect(d.totalTabel).toBe(60);
    expect(d.totalHarian).toBe(60);
    expect(d.statistik).toEqual({ totalSelesai: 7, rataWaktuMenit: 9 });
  });

  it('baris RPC dinormalkan: kunjungan_id null -> "" dan legacy_visit_id ""', async () => {
    const klien = buatKlien({ rpc: rpcFo([baruFo(1, { kunjungan_id: null })]) });
    const hasil = await muatAntrean(klien.sb, param());
    expect(hasil.data!.baris[0]).toMatchObject({ id: 't-1', kunjungan_id: '', legacy_visit_id: '', fo_nama: 'Rina FO' });
  });

  it('saringan status diterapkan SEBELUM paginasi; panel tetap seluruh tiket tanggal itu', async () => {
    const semua = [
      ...Array.from({ length: 25 }, (_, i) => baruFo(i + 1, { status: 'selesai' })),
      baruFo(26),
      baruFo(27, { status: 'dilayani' }),
    ];
    const klien = buatKlien({ rpc: rpcFo(semua) });
    const aktif = (await muatAntrean(klien.sb, param({ status: ['menunggu', 'dilayani'] }))).data!;
    expect(aktif.baris.map((b) => b.id)).toEqual(['t-26', 't-27']);
    expect(aktif.totalTabel).toBe(2);
    expect(aktif.totalHarian).toBe(27);
    expect(aktif.barisPanel).toHaveLength(27);

    const selesai = (await muatAntrean(klien.sb, param({ status: ['selesai'], halaman: 0 }))).data!;
    expect(selesai.baris).toHaveLength(25);
    expect(selesai.totalTabel).toBe(25);
    const halaman2 = (await muatAntrean(klien.sb, param({ status: null, halaman: 1 }))).data!;
    expect(halaman2.baris.map((b) => b.id)).toEqual(['t-26', 't-27']);
  });

  it('RPC belum ada (PGRST202): jatuh ke kueri lama, aksesFo false', async () => {
    const klien = buatKlien({ rows: [tiket(1)] }); // rpc bawaan = fungsi tidak ada
    const hasil = await muatAntrean(klien.sb, param());
    expect(klien.rpc).toHaveBeenCalledTimes(1);
    expect(hasil.data!.aksesFo).toBe(false);
    expect(klien.log.map(jenisKueri).sort()).toEqual(['panel', 'stats', 'total', 'utama']);
  });

  it('RPC ditolak (FORBIDDEN): galat umum, TIDAK jatuh ke kueri lama', async () => {
    const klien = buatKlien({ rpc: () => ({ data: null, error: { code: '42501', message: 'FORBIDDEN: bukan staf' } }) });
    const hasil = await muatAntrean(klien.sb, param());
    expect(hasil.data).toBeNull();
    expect(hasil.error).toMatchObject({ jenis: 'umum', pesan: 'FORBIDDEN: bukan staf' });
    expect(klien.from).not.toHaveBeenCalled();
  });

  it('TANGGAL_DILUAR_BATAS dari server: jenis tanggal_diluar_batas dengan objek asli', async () => {
    const asli = { code: '22023', message: 'TANGGAL_DILUAR_BATAS: x' };
    const klien = buatKlien({ rpc: () => ({ data: null, error: asli }) });
    const hasil = await muatAntrean(klien.sb, param({ peran: 'front_office' }));
    expect(hasil.error).toMatchObject({ jenis: 'tanggal_diluar_batas', asli });
  });

  it('total melebihi 10.000: galat batas_tiket setelah satu panggilan RPC', async () => {
    const klien = buatKlien({ rpc: (n, a) => rpcFo([baruFo(1)], { total: BATAS_TIKET_KLIEN + 1 })(n, a) });
    const hasil = await muatAntrean(klien.sb, param());
    expect(hasil.error).toMatchObject({ jenis: 'batas_tiket', pesan: PESAN_BATAS_TIKET });
    expect(klien.rpc).toHaveBeenCalledTimes(1);
  });

  it('halaman lanjutan kosong padahal total belum tercapai: galat umum "Daftar antrean berubah"', async () => {
    const klien = buatKlien({
      rpc: (nama, a) => (Number(a.p_lewati) === 0
        ? { data: { rows: [baruFo(1)], total: 5, statistik: { totalSelesai: 0, rataWaktuMenit: 0 } }, error: null }
        : { data: { rows: [], total: 5, statistik: { totalSelesai: 0, rataWaktuMenit: 0 } }, error: null }),
    });
    const hasil = await muatAntrean(klien.sb, param());
    expect(hasil.error).toMatchObject({ jenis: 'umum', pesan: PESAN_DAFTAR_BERUBAH });
  });

  it('masihBerlaku false setelah halaman pertama: berhenti tanpa halaman lanjutan', async () => {
    const semua = Array.from({ length: 60 }, (_, i) => baruFo(i + 1));
    const klien = buatKlien({ rpc: rpcFo(semua) });
    const hasil = await muatAntrean(klien.sb, param({ masihBerlaku: () => false }));
    expect(hasil.error?.jenis).toBe('basi');
    expect(klien.rpc).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('muatCatatanEskalasi', () => {
  it('tanpa id: hasil kosong tanpa kueri', async () => {
    const klien = buatKlien();
    expect(await muatCatatanEskalasi(klien.sb, [])).toEqual({ data: {}, error: null });
    expect(klien.from).not.toHaveBeenCalled();
  });

  it('memetakan per id tahap asal; nama FO dari relasi objek maupun larik; kueri berkolom eksplisit', async () => {
    const klien = buatKlien({
      penanganan: [
        { id: 'pn-1', topik: 'Pertanyaan BPJS', catatan: 'Klaim', penangan: { nama: 'Siti FO' } },
        { id: 'pn-2', topik: null, catatan: null, penangan: [{ nama: 'Rina FO' }] },
        { id: 'pn-3', topik: 'x', catatan: 'y', penangan: null },
      ],
    });
    const hasil = await muatCatatanEskalasi(klien.sb, ['pn-1', 'pn-2', 'pn-3']);
    expect(hasil.data).toEqual({
      'pn-1': { topik: 'Pertanyaan BPJS', catatan: 'Klaim', foNama: 'Siti FO' },
      'pn-2': { topik: null, catatan: null, foNama: 'Rina FO' },
      'pn-3': { topik: 'x', catatan: 'y', foNama: null },
    });
    const k = kueriJenis(klien, 'catatan')[0];
    expect(k.select).toBe(KOLOM_CATATAN_ESKALASI);
    expect(k.in).toEqual([['id', ['pn-1', 'pn-2', 'pn-3']]]);
  });

  it('galat dibaca: dilaporkan sebagai galat umum (pemanggil memutuskan diam-diam kosong)', async () => {
    const klien = buatKlien({ timpa: () => ({ error: { message: 'boom' } }) });
    const hasil = await muatCatatanEskalasi(klien.sb, ['pn-1']);
    expect(hasil.data).toBeNull();
    expect(hasil.error).toMatchObject({ jenis: 'umum', pesan: 'boom' });
  });

  it('promise menolak: galat umum, bukan pengecualian', async () => {
    const klien = buatKlien({ timpa: () => { throw new Error('putus'); } });
    const hasil = await muatCatatanEskalasi(klien.sb, ['pn-1']);
    expect(hasil.error).toMatchObject({ jenis: 'umum', pesan: 'putus' });
  });
});

describe('muatAbsensiRekap', () => {
  const absensi = [
    { id: 'a-1', petugas_id: 'p-1', tanggal: '2026-11-04', jam_masuk: '01:00', jam_pulang: null, status: 'approved', petugas: { nama: 'Rina' } },
    { id: 'a-2', petugas_id: 'p-2', tanggal: '2026-11-04', jam_masuk: '02:00', jam_pulang: '09:00', status: 'pending', petugas: [{ nama: 'Dewi' }] },
    { id: 'a-3', petugas_id: 'p-3', tanggal: '2026-11-04', jam_masuk: null, jam_pulang: null, status: 'alpa', petugas: [] },
  ];

  it('kolom eksplisit, saringan tanggal, urut jam masuk; relasi larik dinormalkan menjadi objek atau null', async () => {
    const klien = buatKlien({ absensi });
    const hasil = await muatAbsensiRekap(klien.sb, { tanggal: '2026-11-04', layananId: null });
    expect(hasil.data!.map((a) => a.petugas)).toEqual([{ nama: 'Rina' }, { nama: 'Dewi' }, null]);
    const k = kueriJenis(klien, 'absensi')[0];
    expect(k.tabel).toBe('absensi_petugas');
    expect(k.select).toBe(KOLOM_ABSENSI_REKAP);
    expect(k.eq).toEqual([['tanggal', '2026-11-04']]);
    expect(k.order).toEqual([['jam_masuk', { ascending: true }]]);
  });

  it('Petugas: dibatasi ke Layanannya lewat petugas.layanan_id', async () => {
    const klien = buatKlien({ absensi });
    await muatAbsensiRekap(klien.sb, { tanggal: '2026-11-04', layananId: 'l-1' });
    expect(kueriJenis(klien, 'absensi')[0].eq).toEqual([['tanggal', '2026-11-04'], ['petugas.layanan_id', 'l-1']]);
  });

  it('data kosong/null menjadi daftar kosong; galat dilaporkan sebagai galat umum', async () => {
    const kosong = buatKlien({ timpa: () => ({ data: null }) });
    expect((await muatAbsensiRekap(kosong.sb, { tanggal: '2026-11-04', layananId: null })).data).toEqual([]);
    const galat = buatKlien({ timpa: () => ({ error: { message: 'boom' } }) });
    const hasil = await muatAbsensiRekap(galat.sb, { tanggal: '2026-11-04', layananId: null });
    expect(hasil.data).toBeNull();
    expect(hasil.error).toMatchObject({ jenis: 'umum', pesan: 'boom' });
  });
});
