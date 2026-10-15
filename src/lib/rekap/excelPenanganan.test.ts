import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { amanSel, buildRekapPenangananWorkbook } from './excelPenanganan';
import { ringkasPenanganan, type RekapPenangananRow } from './penanganan';

function baris(s: Partial<RekapPenangananRow> = {}): RekapPenangananRow {
  return {
    id: 'x', kunjungan_id: 'k', tahap_ke: 1, peran_tahap: 'fo', layanan_id: null, layanan_nama: null,
    saluran: 'walk_in', penangan_id: 'fo-1', penangan_nama: 'Sari Wulandari', status: 'selesai', hasil: 'selesai',
    topik: 'Informasi umum', catatan: 'Sudah dijelaskan', batal_karena: null,
    mulai_at: '2026-10-12T02:00:00Z', selesai_at: '2026-10-12T02:10:00Z', created_at: '2026-10-12T02:00:00Z',
    tanggal: '2026-10-12', durasi_menit: 10, pengunjung_nama: 'Budi', pengunjung_instansi: 'CV Maju', email: null, tiket: null,
    fo_nama: 'Sari Wulandari', fo_id: 'fo-1',
    ...s,
  };
}

async function baca(buf: ExcelJS.Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

describe('buildRekapPenangananWorkbook', () => {
  it('lembar FO memuat nama FO, topik, hasil, jam WIB; ada lembar Ringkasan', async () => {
    const rows = [baris(), baris({ id: 'y', hasil: 'dieskalasi', topik: 'Perizinan' })];
    const wb = await baca(await buildRekapPenangananWorkbook('fo', rows, ringkasPenanganan(rows)));
    const ws = wb.getWorksheet('Rekap FO');
    expect(ws).toBeDefined();
    const header = (ws!.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(expect.arrayContaining(['Nama FO', 'Topik', 'Hasil', 'Catatan', 'Jam Mulai', 'Jam Selesai', 'Durasi (mnt)']));
    expect(ws!.rowCount).toBe(3);
    const r2 = ws!.getRow(2);
    expect(r2.getCell(2).value).toBe('Sari Wulandari');
    expect(r2.getCell(3).value).toBe('09:00'); // 02:00Z = 09:00 WIB
    expect(r2.getCell(4).value).toBe('09:10');
    expect(r2.getCell(5).value).toBe(10);
    expect(ws!.getRow(3).getCell(header.indexOf('Hasil') + 1).value).toBe('Dieskalasi ke layanan');
    // Kolom Email (202610140015): kosong bila tidak ada email
    expect(header).toContain('Email');
    expect(ws!.getRow(2).getCell(header.indexOf('Email') + 1).value ?? '').toBe('');
    expect(wb.getWorksheet('Ringkasan')).toBeDefined();
  });

  it('lembar petugas layanan memuat layanan, nomor tiket, status tiket baru, dan pendataan', async () => {
    const rows = [
      baris({
        peran_tahap: 'layanan', layanan_id: 'l1', layanan_nama: 'Helpdesk OSS', hasil: 'dikembalikan', topik: null,
        fo_nama: '=Bayu FO',
        tiket: {
          nomor_display: 'OS-007', tanggal: '2026-10-12', status: 'dikembalikan', form_type: 'oss',
          pelayanan_oss: {
            id: 'o', nama_pemohon: 'Andi', nama_usaha: 'Warung A', tipe_pelaku_usaha: null, status_penanaman_modal: null,
            lokasi_usaha: null, skala_usaha: null, sektor_usaha_kbli: '47111', tindak_lanjut: 'Selesai', uraian_solusi: 'ok', catatan_internal: null,
          },
          pelayanan_perizinan: null,
        },
      }),
    ];
    const wb = await baca(await buildRekapPenangananWorkbook('layanan', rows, ringkasPenanganan(rows)));
    const ws = wb.getWorksheet('Rekap Petugas Layanan')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1) as string[];
    const nilai = (nama: string) => ws.getRow(2).getCell(header.indexOf(nama) + 1).value;
    expect(nilai('Petugas')).toBe('Sari Wulandari');
    // Kolom Front Office (keterbukaan antar FO): nama FO yang melayani, dinetralkan dari formula injection.
    expect(header.indexOf('Front Office')).toBe(header.indexOf('Petugas') + 1);
    expect(nilai('Front Office')).toBe("'=Bayu FO");
    expect(nilai('Layanan')).toBe('Helpdesk OSS');
    expect(nilai('No Antrian')).toBe('OS-007');
    expect(nilai('Status Tiket')).toBe('Dikembalikan ke Front Office');
    expect(nilai('Hasil')).toBe('Dikembalikan ke Front Office');
    expect(nilai('[OSS] Nama Usaha')).toBe('Warung A');
  });

  it('rentang kosong tetap menghasilkan berkas xlsx valid', async () => {
    const buf = await buildRekapPenangananWorkbook('fo', [], ringkasPenanganan([]));
    const u8 = new Uint8Array(buf as ArrayBuffer);
    expect([u8[0], u8[1]]).toEqual([0x50, 0x4b]);
  });
});

describe('amanSel (formula injection)', () => {
  it('menetralkan awalan rumus', () => {
    expect(amanSel('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    expect(amanSel('+1')).toBe("'+1");
    expect(amanSel('@SUM')).toBe("'@SUM");
    expect(amanSel('biasa')).toBe('biasa');
    expect(amanSel(null)).toBe('');
  });
});
