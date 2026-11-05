// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildSurveiWorkbook,
  muatDataSurvei,
  type BarisSkm,
  type BarisSpak,
  type RingkasanRateRow,
} from './export';
import { PERTANYAAN_SPAK, UNSUR_SKM, SKALA_SPAK, SKALA_SKM } from './pertanyaan';

const KJ1 = 'a1b2c3d4-0000-4000-8000-000000000001';

function spak(sebagian: Partial<BarisSpak> = {}): BarisSpak {
  return {
    id: 's-1',
    kunjungan_id: KJ1,
    layanan_id: 'l-1',
    unit: 'layanan',
    created_at: '2026-10-12T03:00:00Z',
    p1_tanpa_diskriminasi: 6,
    p2_tanpa_kecurangan: 5,
    p3_tanpa_imbalan: 4,
    p4_tanpa_pungli: 3,
    p5_tanpa_percaloan: 2,
    kunjungan: { tanggal: '2026-10-12', kategori: 'UMKM' },
    layanan: { nama: 'Helpdesk OSS' },
    ...sebagian,
  };
}

function skm(sebagian: Partial<BarisSkm> = {}): BarisSkm {
  return {
    id: 'k-1',
    kunjungan_id: KJ1,
    layanan_id: 'l-1',
    unit: 'layanan',
    created_at: '2026-10-12T03:00:00Z',
    // Nilai bertetangga sengaja berbeda agar tertukarnya urutan kolom ketahuan.
    u1_persyaratan: 4, u2_prosedur: 3, u3_waktu: 2, u4_biaya: 1, u5_produk: 4,
    u6_kompetensi: 3, u7_perilaku: 2, u8_sarana: 1, u9_pengaduan: 4,
    u10_transparansi: 3, u11_integritas: 2,
    kunjungan: { tanggal: '2026-10-12', kategori: 'UMKM' },
    layanan: { nama: 'Helpdesk OSS' },
    ...sebagian,
  };
}

const ringkasanRate: RingkasanRateRow[] = [
  { layanan_id: 'l-1', unit: 'layanan', nama: 'Helpdesk OSS', diundang: 6, mengisi: 4 },
  { layanan_id: null, unit: 'fo', nama: 'Front Office', diundang: 0, mengisi: 0 },
];

async function muat(buf: Buffer | ExcelJS.Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buf as ArrayBuffer) as unknown as ArrayBuffer);
  return wb;
}

type Sel = string | number | null;

/** Nilai sel tiap baris sebagai larik (indeks 0 = kolom A); sel kosong = null. */
function baris(ws: ExcelJS.Worksheet): Sel[][] {
  const hasil: Sel[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const nilai: Sel[] = [];
    row.eachCell({ includeEmpty: true }, (cell, i) => {
      nilai[i - 1] = (cell.value as Sel) ?? null;
    });
    hasil.push(nilai);
  });
  return hasil;
}

async function bangun(sebagian: Partial<Parameters<typeof buildSurveiWorkbook>[0]> = {}) {
  const buf = await buildSurveiWorkbook({
    dari: '2026-10-12',
    sampai: '2026-10-14',
    spak: [spak()],
    skm: [skm()],
    ringkasanRate,
    ...sebagian,
  });
  return muat(buf);
}

describe('buildSurveiWorkbook', () => {
  it('memuat lembar Data responden setelah empat lembar hasil survei', async () => {
    const wb = await bangun();
    expect(wb.worksheets.map((w) => w.name)).toEqual(['SPAK', 'SKM', 'Ringkasan', 'Legenda', 'Data responden']);
  });

  it('Data responden menghubungkan setiap jawaban dengan identitas FO dan tanggal WIB', async () => {
    const kunjungan = {
      tanggal: '2026-10-12', kategori: 'UMKM', nama: 'Tomi', asal_instansi: 'PT Lampung',
      email: 'tomi@contoh.id', kontak_hp: '081234567890', keperluan: 'Mengurus izin usaha',
      tujuan: 'layanan', nama_yang_ditemui: null, asal: 'walk_in',
    };
    const wb = await bangun({
      spak: [spak({ kunjungan, jenis_kelamin: 'Laki-laki', pendidikan: 'SMA', created_at: '2026-10-12T20:00:00Z' })],
      skm: [skm({ kunjungan })],
    });
    const rows = baris(wb.getWorksheet('Data responden')!);
    expect(rows).toHaveLength(3);
    const row = Object.fromEntries(rows[0].map((h, i) => [h, rows[1][i] ?? null]));
    expect(row).toMatchObject({
      'Jenis survei': 'SPAK', 'ID jawaban': 's-1', 'ID kunjungan': KJ1,
      'Tanggal kunjungan (WIB)': '12/10/2026', 'Tanggal jawaban (WIB)': '13/10/2026',
      'Unit': 'Helpdesk OSS', 'Nama pengunjung': 'Tomi', 'Asal instansi': 'PT Lampung',
      'Email': 'tomi@contoh.id', 'Nomor HP': '081234567890', 'Kategori': 'UMKM',
      'Keperluan': 'Mengurus izin usaha', 'Tujuan': 'layanan', 'Asal kunjungan': 'walk_in',
      'Jenis kelamin': 'Laki-laki', 'Pendidikan': 'SMA',
    });
    expect(rows[2][0]).toBe('SKM');
  });

  it('Data responden mengamankan teks identitas dan mengosongkan data anonim, impor, atau tersembunyi RLS', async () => {
    const wb = await bangun({
      spak: [spak({ kunjungan: {
        tanggal: '2026-10-12', kategori: 'Instansi', nama: ' =HYPERLINK("jahat")',
        asal_instansi: '@SUM(1)', kontak_hp: '+6281234567890', email: '-rumus@contoh.id',
        keperluan: '\n=CMD()', nama_yang_ditemui: '\t=CMD()', tujuan: ' \t+CMD()',
      } })],
      skm: [
        skm({ id: 'anon', kunjungan: { tanggal: '2026-10-12', kategori: 'Umum', nama: '[anonim]', email: 'lama@contoh.id', kontak_hp: '081111111111', asal_instansi: 'Instansi lama', keperluan: 'Rahasia' } }),
        skm({ id: 'impor', kunjungan_id: null, kunjungan: null }),
        skm({ id: 'rls', kunjungan: null }),
      ],
    });
    const rows = baris(wb.getWorksheet('Data responden')!);
    expect(rows).toHaveLength(5);
    for (const i of [6, 7, 8, 9, 11, 12, 13]) expect(rows[1][i]).toMatch(/^'/);
    expect(rows[2][6]).toBe('[anonim]');
    for (const row of rows.slice(2)) {
      for (const i of [7, 8, 9, 11, 12, 13]) expect(row[i] ?? null).toBeNull();
    }
    const legenda = baris(wb.getWorksheet('Legenda')!).flat().join(' ');
    expect(legenda).toContain('hak akses akun pengunduh');
    expect(legenda).not.toContain('hanya yang diizinkan RLS');
    expect(legenda).toContain('akses dibatasi');
  });

  it('header SPAK: empat kolom identitas lalu kalimat pernyataan lengkap', async () => {
    const wb = await bangun();
    const header = baris(wb.getWorksheet('SPAK')!)[0];
    expect(header.slice(0, 4)).toEqual(['Tanggal Kunjungan', 'Unit', 'Kategori', 'Kode Kunjungan']);
    expect(header).toHaveLength(4 + PERTANYAAN_SPAK.length);
    PERTANYAAN_SPAK.forEach((p, i) => {
      expect(header[4 + i]).toContain(p.teks);
    });
  });

  it('header SKM: empat kolom identitas lalu sebelas unsur', async () => {
    const wb = await bangun();
    const header = baris(wb.getWorksheet('SKM')!)[0];
    expect(header.slice(0, 4)).toEqual(['Tanggal Kunjungan', 'Unit', 'Kategori', 'Kode Kunjungan']);
    expect(header).toHaveLength(4 + UNSUR_SKM.length);
    UNSUR_SKM.forEach((u, i) => {
      expect(header[4 + i]).toContain(u.teks);
    });
  });

  it('isi baris SPAK dan SKM: angka asli, kode 8 huruf besar, unsur lama kosong (bukan 0)', async () => {
    const wb = await bangun({
      skm: [
        skm(),
        skm({ id: 'k-2', u10_transparansi: null, u11_integritas: null, kunjungan: { tanggal: '2026-10-13', kategori: 'Umum' } }),
      ],
    });
    const spakRow = baris(wb.getWorksheet('SPAK')!)[1];
    expect(spakRow.slice(0, 4)).toEqual(['12/10/2026', 'Helpdesk OSS', 'UMKM', 'A1B2C3D4']);
    expect(spakRow.slice(4)).toEqual([6, 5, 4, 3, 2]);

    const skmRows = baris(wb.getWorksheet('SKM')!);
    expect(skmRows[1].slice(4)).toEqual([4, 3, 2, 1, 4, 3, 2, 1, 4, 3, 2]);
    expect(skmRows[2][0]).toBe('13/10/2026');
    expect(skmRows[2].slice(4, 13)).toEqual([4, 3, 2, 1, 4, 3, 2, 1, 4]);
    expect(skmRows[2][13] ?? null).toBeNull();
    expect(skmRows[2][14] ?? null).toBeNull();
  });

  it('baris impor tanpa kunjungan: kode "—", tanggal dari created_at menurut WIB, unit sesuai klasifikasi', async () => {
    // 20:00 UTC = 03:00 WIB hari berikutnya.
    const wb = await bangun({
      spak: [
        spak({ kunjungan_id: null, kunjungan: null, unit: 'tidak_diketahui', layanan_id: null, layanan: null, created_at: '2026-10-12T20:00:00Z' }),
        spak({ id: 's-3', unit: 'fo', layanan_id: null, layanan: null }),
      ],
      skm: [],
    });
    const rows = baris(wb.getWorksheet('SPAK')!);
    expect(rows[1].slice(0, 4)).toEqual(['13/10/2026', 'Tidak terklasifikasi (data lama/impor)', null, '—']);
    expect(rows[2][1]).toBe('Front Office');
    expect(rows[2][3]).toBe('A1B2C3D4');
  });

  it('mengabaikan identitas dan saran di luar relasi kunjungan yang diizinkan', async () => {
    const bocor = {
      nama: 'Budi Rahasia',
      nama_pengunjung: 'Budi Rahasia',
      email: 'budi@contoh.id',
      no_hp: '081234567890',
      saran: 'hubungi saya di budi@contoh.id',
    };
    const wb = await bangun({
      spak: [{ ...spak(), ...bocor } as BarisSpak],
      skm: [{ ...skm(), ...bocor } as BarisSkm],
    });
    for (const ws of wb.worksheets) {
      for (const r of baris(ws)) {
        for (const nilai of r) {
          const teks = String(nilai ?? '');
          expect(teks).not.toMatch(/Budi Rahasia|budi@contoh\.id|081234567890/);
        }
      }
    }
    for (const nama of ['SPAK', 'SKM']) {
      const header = baris(wb.getWorksheet(nama)!)[0].map((h) => String(h).toLowerCase());
      expect(header.filter((h) => /\bnama\b|\bhp\b|telepon|e-?mail|\bsaran\b/.test(h))).toEqual([]);
    }
  });

  it('sel teks berawalan = + - @ diawali apostrof (anti injeksi rumus)', async () => {
    const wb = await bangun({
      spak: [spak({ layanan: { nama: '=HYPERLINK("http://jahat")' }, kunjungan: { tanggal: '2026-10-12', kategori: '+cmd' } })],
      skm: [skm({ layanan: { nama: '-2+3' }, kunjungan: { tanggal: '2026-10-12', kategori: '@SUM(A1)' } })],
      ringkasanRate: [{ layanan_id: 'l-1', unit: 'layanan', nama: '+x', diundang: 1, mengisi: 1 }],
    });
    const spakRow = baris(wb.getWorksheet('SPAK')!)[1];
    expect(spakRow[1]).toBe(`'=HYPERLINK("http://jahat")`);
    expect(spakRow[2]).toBe("'+cmd");
    const skmRow = baris(wb.getWorksheet('SKM')!)[1];
    expect(skmRow[1]).toBe("'-2+3");
    expect(skmRow[2]).toBe("'@SUM(A1)");
    // Tidak ada sel string berawalan karakter rumus di sheet mana pun.
    for (const ws of wb.worksheets) {
      for (const r of baris(ws)) {
        for (const nilai of r) {
          if (typeof nilai === 'string') expect(nilai).not.toMatch(/^[=+\-@\t\r]/);
        }
      }
    }
  });

  it('Ringkasan GLOBAL: IKM, SPAK per pernyataan dengan persen, dan response rate total (tanpa pemecahan per unit)', async () => {
    const wb = await bangun({
      spak: [spak(), spak({ id: 's-2', layanan_id: null, unit: 'fo', layanan: null, p1_tanpa_diskriminasi: 2, p2_tanpa_kecurangan: 2, p3_tanpa_imbalan: 2, p4_tanpa_pungli: 2, p5_tanpa_percaloan: 2 })],
      ringkasanRate: [
        { layanan_id: 'l-1', unit: 'layanan', nama: 'Helpdesk OSS', diundang: 6, mengisi: 4 },
        { layanan_id: null, unit: 'fo', nama: 'Front Office', diundang: 0, mengisi: 0 },
      ],
    });
    const rows = baris(wb.getWorksheet('Ringkasan')!);
    const cari = (awal: string) => rows.findIndex((r) => r[0] === awal);

    expect(rows[cari('Periode')][1]).toBe('12/10/2026 s.d. 14/10/2026');
    expect(rows[cari('Cakupan')][1]).toMatch(/Seluruh pelayanan digabung/);

    const iIkm = cari('Ringkasan IKM (Indeks Kepuasan Masyarakat)');
    expect(rows[iIkm + 2]).toEqual(['Responden', 1]);
    // skm(): unsur 4,3,2,1,4,3,2,1,4,3,2 -> rata-rata 29/11 x 25 = 65,9
    expect(rows[iIkm + 3]).toEqual(['IKM (skala 25-100)', 65.9]);
    expect(rows[iIkm + 4]).toEqual(['Predikat', 'C — Kurang Baik']);
    const iUnsur = cari('IKM per Unsur');
    expect(rows[iUnsur + 1]).toEqual(['Unsur', 'Keterangan', 'Jawaban', 'Rata-rata (1-4)', 'Nilai IKM (25-100)']);
    expect(rows[iUnsur + 2]).toEqual(['U1', UNSUR_SKM[0].teks, 1, 4, 100]);

    const iSpak = cari('Ringkasan SPAK (Survey Persepsi Anti Korupsi)');
    expect(rows[iSpak + 2]).toEqual(['Responden', 2]);
    expect(rows[iSpak + 3]).toEqual(['Rata-rata (skala 1-6)', 3]); // (6+5+4+3+2 + 5x2) / 10
    expect(rows[iSpak + 4]).toEqual(['Indeks SPAK (skala 0-100)', 50]);
    const iButir = cari('SPAK per Pernyataan');
    expect(rows[iButir + 1].slice(0, 8)).toEqual(['Pernyataan', 'Keterangan', 'Jawaban', 'Rata-rata (1-6)', 'Indeks (0-100)', 'Setuju (%)', 'Netral (%)', 'Tidak setuju (%)']);
    expect(rows[iButir + 2].slice(0, 3)).toEqual(['P1', PERTANYAAN_SPAK[0].teks, 2]);

    const iRate = cari('Response Rate');
    expect(rows[iRate + 2]).toEqual(['Diundang', 6]);
    expect(rows[iRate + 3]).toEqual(['Mengisi', 4]);
    expect(rows[iRate + 4]).toEqual(['Persen (%)', 66.7]);

    // Tidak ada nama layanan/unit di sheet Ringkasan.
    const teksRingkasan = rows.flat().map((v) => String(v ?? '')).join('|');
    expect(teksRingkasan).not.toMatch(/Helpdesk OSS|Front Office|Tidak terklasifikasi/);
  });

  it('Ringkasan: tanpa jawaban tampil "—" dan catatan data terpotong muncul hanya bila terpotong', async () => {
    const kosong = await bangun({ spak: [], skm: [], ringkasanRate: [] });
    const rows = baris(kosong.getWorksheet('Ringkasan')!);
    const i = rows.findIndex((r) => r[0] === 'Ringkasan IKM (Indeks Kepuasan Masyarakat)');
    expect(rows[i + 2]).toEqual(['Responden', 0]);
    expect(rows[i + 3]).toEqual(['IKM (skala 25-100)', '—']);
    expect(rows[i + 4]).toEqual(['Predikat', 'N/A']);
    expect(rows.flat().some((v) => /terpotong/i.test(String(v ?? '')))).toBe(false);

    const terpotong = await bangun({ terpotong: true });
    expect(baris(terpotong.getWorksheet('Ringkasan')!).flat().some((v) => /terpotong/i.test(String(v ?? '')))).toBe(true);
  });

  it('Legenda memuat skala SPAK, skala SKM, dan teks pernyataan/unsur', async () => {
    const wb = await bangun();
    const semua = baris(wb.getWorksheet('Legenda')!).flat().map((v) => String(v ?? ''));
    for (const s of SKALA_SPAK) expect(semua).toContain(s.label);
    for (const s of SKALA_SKM) expect(semua).toContain(s.label);
    for (const p of PERTANYAAN_SPAK) expect(semua).toContain(p.teks);
    for (const u of UNSUR_SKM) expect(semua).toContain(u.teks);
  });
});

// Klien palsu: from(tabel).select().gte().lt().order().order().range() dengan batas baris server (meniru max-rows).
function klienPalsu(
  data: { skm_respons: unknown[]; spak_respons: unknown[]; [tabel: string]: unknown[] },
  serverCap = 1000,
  galat: Record<string, unknown> = {},
) {
  const log: { tabel: string; select: string; gte: unknown[][]; lt: unknown[][]; range: number[][]; filters: unknown[][] }[] = [];
  const from = vi.fn((tabel: string) => {
    const entri = { tabel, select: '', gte: [] as unknown[][], lt: [] as unknown[][], range: [] as number[][], filters: [] as unknown[][] };
    log.push(entri);
    const b: Record<string, unknown> = {};
    b.select = (s: string) => { entri.select = s; return b; };
    b.gte = (...a: unknown[]) => { entri.gte.push(a); return b; };
    b.lt = (...a: unknown[]) => { entri.lt.push(a); return b; };
    b.order = () => b;
    b.in = (...a: unknown[]) => { entri.filters.push(['in', ...a]); return b; };
    b.eq = (...a: unknown[]) => { entri.filters.push(['eq', ...a]); return b; };
    b.or = () => b;
    b.range = (dari: number, sampai: number) => {
      entri.range.push([dari, sampai]);
      if (galat[tabel]) return Promise.resolve({ data: null, error: galat[tabel] });
      const potong = Math.min(sampai - dari + 1, serverCap);
      return Promise.resolve({ data: (data[tabel] ?? []).slice(dari, dari + potong), error: null });
    };
    return b;
  });
  return { klien: { from } as never, log };
}

describe('muatDataSurvei', () => {
  it('mengambil identitas FO dan mengisi email kosong dari formulir selesai terbaru yang valid tanpa backfill', async () => {
    const { klien, log } = klienPalsu({
      skm_respons: [skm({ kunjungan: { tanggal: '2026-10-12', kategori: 'UMKM', nama: 'Tomi', email: '' } })],
      spak_respons: [],
      pelayanan_oss: [{ id: 'o-1', kunjungan_id: KJ1, email: 'Tidak berlaku', updated_at: '2026-10-14T00:00:00Z' },
        { id: 'o-2', kunjungan_id: KJ1, email: 'oss@contoh.id', updated_at: '2026-10-12T00:00:00Z' }],
      pelayanan_perizinan: [{ id: 'z-1', kunjungan_id: KJ1, email: ' Izin@Contoh.id ', updated_at: '2026-10-13T00:00:00Z' }],
    }, 1);
    const hasil = await muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-14' });
    expect(hasil.skm[0].kunjungan).toMatchObject({ nama: 'Tomi', email: 'izin@contoh.id' });
    expect(hasil.terpotong).toBe(false);
    for (const l of log.filter((l) => /_respons$/.test(l.tabel))) {
      expect(l.select).toContain('nama');
      expect(l.select).toContain('kontak_hp');
      expect(l.select).toContain('asal_instansi');
      expect(l.select).toContain('email');
      expect(l.select).not.toContain('*');
    }
    expect(log.filter((l) => l.tabel === 'pelayanan_perizinan').flatMap((l) => l.range)).toEqual([[0, 999], [1, 1000]]);
    for (const l of log.filter((l) => /^pelayanan_/.test(l.tabel))) {
      expect(l.filters).toContainEqual(['in', 'kunjungan_id', [KJ1]]);
      expect(l.filters).toContainEqual(['eq', 'status_draft', 'selesai']);
    }
    const khusus = log.find((l) => l.tabel === 'pendataan_khusus_jawaban')!;
    expect(khusus.filters).toContainEqual(['in', 'penanganan.kunjungan_id', [KJ1]]);
    expect(khusus.filters).toContainEqual(['eq', 'penanganan.status', 'selesai']);
  });

  it('email utama menang; cadangan khusus hanya label email dan nilai valid, lalu akun atau kontak chat', async () => {
    const k = (nama: string, email: string | null = null) => ({ tanggal: '2026-10-12', kategori: 'Umum', nama, email });
    const { klien } = klienPalsu({
      skm_respons: [
        skm({ id: 'utama', kunjungan_id: 'utama', kunjungan: k('Utama', ' FO@Contoh.id ') }),
        skm({ id: 'khusus', kunjungan_id: 'khusus', kunjungan: { ...k('Khusus'), pengunjung: { email: 'akun@contoh.id' } } }),
        skm({ id: 'akun', kunjungan_id: 'akun', kunjungan: { ...k('Akun'), pengunjung: [{ email: 'akun@contoh.id' }] } }),
        skm({ id: 'chat', kunjungan_id: 'chat', kunjungan: { ...k('Chat'), chat: { kontak_pengunjung: 'chat@contoh.id' } } }),
        skm({ id: 'chat-akun', kunjungan_id: 'chat-akun', kunjungan: { ...k('Chat akun'), chat: { kontak_pengunjung: '081234567890', pengunjung: { email: 'google@contoh.id' } } } }),
        skm({ id: 'kosong', kunjungan_id: 'kosong', kunjungan: k('Kosong', 'Tidak berlaku') }),
      ],
      spak_respons: [],
      pelayanan_oss: [{ id: 'o', kunjungan_id: 'utama', email: 'form@contoh.id', updated_at: '2026-10-13T00:00:00Z' }],
      pendataan_khusus_jawaban: [
        { id: 'x', label_snapshot: 'Catatan', nilai: 'salah@contoh.id', created_at: '2026-10-15T00:00:00Z', penanganan: { kunjungan_id: 'khusus' } },
        { id: 'y', label_snapshot: 'Email', nilai: 'Tidak berlaku', created_at: '2026-10-14T00:00:00Z', penanganan: { kunjungan_id: 'khusus' } },
        { id: 'z', label_snapshot: 'Alamat email', nilai: ' Khusus@Contoh.id ', created_at: '2026-10-13T00:00:00Z', penanganan: [{ kunjungan_id: 'khusus' }] },
        { id: 'array', label_snapshot: 'Email', nilai: ['bukan-teks@contoh.id'], created_at: '2026-10-13T00:00:00Z', penanganan: { kunjungan_id: 'kosong' } },
      ],
    });
    const hasil = await muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-14' });
    expect(hasil.skm.map((r) => (r.kunjungan as { email?: string }).email ?? null)).toEqual([
      'fo@contoh.id', 'khusus@contoh.id', 'akun@contoh.id', 'chat@contoh.id', 'google@contoh.id', null,
    ]);
  });

  it('tidak mencari cadangan untuk identitas teranonimkan, impor, atau kunjungan tersembunyi RLS', async () => {
    const { klien, log } = klienPalsu({
      skm_respons: [
        skm({ kunjungan: { tanggal: '2026-10-12', kategori: 'Umum', nama: '[anonim]', email: null, pengunjung: { email: 'lama@contoh.id' } } }),
        skm({ id: 'rls', kunjungan_id: 'tersembunyi', kunjungan: null }),
        skm({ id: 'impor', kunjungan_id: null, kunjungan: null }),
      ],
      spak_respons: [],
    });
    const hasil = await muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-14' });
    expect(log.every((l) => /_respons$/.test(l.tabel))).toBe(true);
    expect((hasil.skm[0].kunjungan as { email: string | null }).email).toBeNull();
    expect(hasil.skm[1].kunjungan).toBeNull();
    expect(hasil.skm[2].kunjungan).toBeNull();
  });

  it('menandai ekspor terpotong bila jawaban melampaui 50.000 baris', async () => {
    const { klien } = klienPalsu({
      skm_respons: Array.from({ length: 50001 }, (_, i) => skm({ id: `k-${i}`, kunjungan_id: null, kunjungan: null })),
      spak_respons: [],
    });
    const hasil = await muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-14' });
    expect(hasil.skm).toHaveLength(50000);
    expect(hasil.terpotong).toBe(true);
  });

  it('menandai ekspor terpotong bila data cadangan email melampaui batas dan tetap mengambil email nyata', async () => {
    const { klien } = klienPalsu({
      skm_respons: [skm({ kunjungan: { tanggal: '2026-10-12', kategori: 'Umum', nama: 'Tomi' } })],
      spak_respons: [],
      pelayanan_oss: Array.from({ length: 50001 }, (_, i) => ({ id: `o-${i}`, kunjungan_id: KJ1, email: 'tomi@contoh.id', updated_at: '2026-10-13T00:00:00Z' })),
    });
    const hasil = await muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-14' });
    expect(hasil.skm[0].kunjungan).toMatchObject({ email: 'tomi@contoh.id' });
    expect(hasil.terpotong).toBe(true);
  });

  it('mengambil 2.500 baris lengkap lewat paginasi (1000/1000/500) dan tidak terpotong', async () => {
    const dataSkm = Array.from({ length: 2500 }, (_, i) => skm({ id: `k-${i}` }));
    const dataSpak = Array.from({ length: 1200 }, (_, i) => spak({ id: `s-${i}` }));
    const { klien, log } = klienPalsu({ skm_respons: dataSkm, spak_respons: dataSpak });

    const hasil = await muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-12' });

    expect(hasil.skm).toHaveLength(2500);
    expect(hasil.spak).toHaveLength(1200);
    expect(hasil.terpotong).toBe(false);
    expect(new Set(hasil.skm.map((r) => r.id)).size).toBe(2500);
    const rangeSkm = log.filter((l) => l.tabel === 'skm_respons').flatMap((l) => l.range);
    expect(rangeSkm.slice(0, 3)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('batas server lebih kecil dari ukuran halaman tidak menghilangkan baris', async () => {
    const dataSkm = Array.from({ length: 700 }, (_, i) => skm({ id: `k-${i}` }));
    const { klien } = klienPalsu({ skm_respons: dataSkm, spak_respons: [] }, 300);
    const hasil = await muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-12' });
    expect(hasil.skm).toHaveLength(700);
  });

  it('filter tanggal memakai batas hari WIB pada created_at (>= 00:00 WIB dari, < 00:00 WIB sehari setelah sampai)', async () => {
    const { klien, log } = klienPalsu({ skm_respons: [], spak_respons: [] });
    await muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-14' });
    expect(log).toHaveLength(2);
    for (const l of log) {
      expect(l.gte).toEqual([['created_at', '2026-10-11T17:00:00.000Z']]);
      expect(l.lt).toEqual([['created_at', '2026-10-14T17:00:00.000Z']]);
      expect(l.select).toContain('kunjungan:kunjungan_id(tanggal, kategori, nama');
      expect(l.select).toContain('layanan:layanan_id(nama)');
    }
  });

  it('cadangan Pendataan Khusus belum ada (tabel belum diterapkan): lewati sumber itu, cadangan lain tetap jalan, ditandai', async () => {
    const { klien, log } = klienPalsu({
      skm_respons: [skm({ kunjungan: { tanggal: '2026-10-12', kategori: 'Umum', nama: 'Tomi', email: null } })],
      spak_respons: [],
      pelayanan_oss: [{ id: 'o', kunjungan_id: KJ1, email: 'form@contoh.id', updated_at: '2026-10-13T00:00:00Z' }],
    }, 1000, { pendataan_khusus_jawaban: { code: 'PGRST205', message: 'relation does not exist' } });
    const hasil = await muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-14' });
    expect(hasil.skm[0].kunjungan).toMatchObject({ nama: 'Tomi', email: 'form@contoh.id' });
    expect(hasil.cadanganKhususTidakTersedia).toBe(true);
    expect(hasil.terpotong).toBe(false);
    expect(log.some((l) => l.tabel === 'pendataan_khusus_jawaban')).toBe(true);
  });

  it.each(['PGRST200', '42P01', '42703'])('kode %s pada cadangan Khusus: relasi/tabel/kolom belum ada, tidak menggagalkan ekspor', async (code) => {
    const { klien } = klienPalsu({
      skm_respons: [skm({ kunjungan: { tanggal: '2026-10-12', kategori: 'Umum', nama: 'Tomi', email: null } })],
      spak_respons: [],
    }, 1000, { pendataan_khusus_jawaban: { code, message: 'x' } });
    const hasil = await muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-14' });
    expect(hasil.cadanganKhususTidakTersedia).toBe(true);
  });

  it('cadangan Khusus tersedia: tidak ditandai tidak tersedia', async () => {
    const { klien } = klienPalsu({ skm_respons: [skm()], spak_respons: [] });
    const hasil = await muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-14' });
    expect(hasil.cadanganKhususTidakTersedia).toBe(false);
  });

  it('galat lain pada cadangan Khusus (bukan objek belum ada) tetap menggagalkan ekspor', async () => {
    const { klien } = klienPalsu({
      skm_respons: [skm({ kunjungan: { tanggal: '2026-10-12', kategori: 'Umum', nama: 'Tomi', email: null } })],
      spak_respons: [],
    }, 1000, { pendataan_khusus_jawaban: { code: '57014', message: 'timeout' } });
    await expect(muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-14' })).rejects.toMatchObject({ code: '57014' });
  });

  it('tabel jawaban belum ada: galat diteruskan apa adanya agar route bisa menjawab 409', async () => {
    const { klien } = klienPalsu({ skm_respons: [], spak_respons: [] }, 1000, { spak_respons: { code: 'PGRST205', message: 'x' } });
    await expect(muatDataSurvei(klien, { dari: '2026-10-12', sampai: '2026-10-14' })).rejects.toMatchObject({ code: 'PGRST205' });
  });

  it('Ringkasan dan Legenda mencatat cadangan email Khusus tidak tersedia; Legenda tidak mengklaim pembatasan RLS', async () => {
    const wb = await muat(await buildSurveiWorkbook({
      dari: '2026-10-12', sampai: '2026-10-14', spak: [], skm: [], ringkasanRate, cadanganKhususTidakTersedia: true,
    }));
    const teksSheet = (nama: string) => { const t: string[] = []; wb.getWorksheet(nama)!.eachRow((r) => r.eachCell((c) => t.push(c.text))); return t.join(' | '); };
    expect(teksSheet('Ringkasan')).toMatch(/Pendataan Khusus belum tersedia/);
    expect(teksSheet('Legenda')).not.toMatch(/hanya yang diizinkan RLS/);
    expect(teksSheet('Legenda')).toMatch(/hak akses akun pengunduh/);
    const tanpa = await muat(await buildSurveiWorkbook({ dari: '2026-10-12', sampai: '2026-10-14', spak: [], skm: [], ringkasanRate }));
    const t2: string[] = []; tanpa.getWorksheet('Ringkasan')!.eachRow((r) => r.eachCell((c) => t2.push(c.text)));
    expect(t2.join(' | ')).not.toMatch(/Pendataan Khusus belum tersedia/);
  });

  it('meneruskan galat database', async () => {
    const from = vi.fn(() => {
      const b: Record<string, unknown> = {};
      for (const k of ['select', 'gte', 'lt', 'order']) b[k] = () => b;
      b.range = () => Promise.resolve({ data: null, error: { message: 'boom' } });
      return b;
    });
    await expect(muatDataSurvei({ from } as never, { dari: '2026-10-12', sampai: '2026-10-12' })).rejects.toBeTruthy();
  });
});
