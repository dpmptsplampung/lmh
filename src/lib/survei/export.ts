// Unduhan XLSX "Pesan Perilaku" (survei terpadu Fase A, spec §9): sheet SPAK, SKM, Ringkasan, Legenda.
// Kolom identitas HANYA tanggal kunjungan, unit, kategori pengunjung, dan kode kunjungan; tanpa nama, HP, atau email
// (kolom itu memang tidak dibaca dari database, jadi tidak mungkin bocor lewat berkas). Teks yang berasal dari database
// (nama layanan, kategori) dinetralkan dari injeksi rumus lewat `amanSel`.
// Ringkasan (IKM, rata-rata SPAK, response rate) datang dari RPC `ringkasan_*` yang HARUS dipanggil dengan klien sesi
// pengguna (dijaga peran_saya(); kosong di bawah service role): pemanggil menyuplainya, modul ini tidak memanggil RPC.
import ExcelJS from 'exceljs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ikmQualityLabel } from '@/lib/ikm';
import { amanSel } from '@/lib/rekap/excelPenanganan';
import { fetchAllPages } from '@/lib/rekap/exportAll';
import { awalHariBerikutnyaWIB, awalHariWIB, formatTanggalId } from '@/lib/rekap/format';
import { PERTANYAAN_SPAK, SKALA_SKM, SKALA_SPAK, UNSUR_SKM } from './pertanyaan';

export const LABEL_UNIT_FO = 'Front Office';
export const LABEL_UNIT_TIDAK_DIKETAHUI = 'Tidak terklasifikasi (data lama/impor)';

export type UnitJawaban = 'layanan' | 'fo' | 'tidak_diketahui';
type Relasi<T> = T | T[] | null | undefined;
interface RefKunjungan { tanggal: string | null; kategori: string | null }
interface RefLayanan { nama: string | null }

interface BarisDasar {
  id: string;
  kunjungan_id: string | null;
  layanan_id: string | null;
  unit: UnitJawaban;
  created_at: string;
  kunjungan?: Relasi<RefKunjungan>;
  layanan?: Relasi<RefLayanan>;
}

export interface BarisSpak extends BarisDasar {
  p1_tanpa_diskriminasi: number;
  p2_tanpa_kecurangan: number;
  p3_tanpa_imbalan: number;
  p4_tanpa_pungli: number;
  p5_tanpa_percaloan: number;
}

export interface BarisSkm extends BarisDasar {
  u1_persyaratan: number | null;
  u2_prosedur: number | null;
  u3_waktu: number | null;
  u4_biaya: number | null;
  u5_produk: number | null;
  u6_kompetensi: number | null;
  u7_perilaku: number | null;
  u8_sarana: number | null;
  u9_pengaduan: number | null;
  /** Kosong pada baris lama (9 unsur). */
  u10_transparansi: number | null;
  u11_integritas: number | null;
}

type Angka = number | string | null;

export interface RingkasanIkmRow { layanan_id: string | null; unit: string; nama: string; ikm: Angka; responden: number }
export interface RingkasanSpakRow {
  layanan_id: string | null; unit: string; nama: string; responden: number;
  p1: Angka; p2: Angka; p3: Angka; p4: Angka; p5: Angka;
}
export interface RingkasanRateRow { layanan_id: string | null; unit: string; nama: string; diundang: number; mengisi: number }

export interface DataSurvei {
  /** YYYY-MM-DD (WIB), inklusif. */
  dari: string;
  sampai: string;
  spak: BarisSpak[];
  skm: BarisSkm[];
  ringkasanIkm: RingkasanIkmRow[];
  ringkasanSpak: RingkasanSpakRow[];
  ringkasanRate: RingkasanRateRow[];
  /** Data jawaban melebihi batas baris ekspor dan dipotong (diberi catatan di sheet Ringkasan). */
  terpotong?: boolean;
}

// Urutan kolom = urutan PERTANYAAN_SPAK / UNSUR_SKM (p1..p5, u1..u11); pemetaan nama kolom database ada di sini saja.
const KOLOM_SPAK = [
  'p1_tanpa_diskriminasi', 'p2_tanpa_kecurangan', 'p3_tanpa_imbalan', 'p4_tanpa_pungli', 'p5_tanpa_percaloan',
] as const satisfies readonly (keyof BarisSpak)[];
const KOLOM_SKM = [
  'u1_persyaratan', 'u2_prosedur', 'u3_waktu', 'u4_biaya', 'u5_produk', 'u6_kompetensi',
  'u7_perilaku', 'u8_sarana', 'u9_pengaduan', 'u10_transparansi', 'u11_integritas',
] as const satisfies readonly (keyof BarisSkm)[];

const KOLOM_DASAR = ['id', 'kunjungan_id', 'layanan_id', 'unit', 'created_at'];
const RELASI = 'kunjungan:kunjungan_id(tanggal, kategori), layanan:layanan_id(nama)';
// Kolom dipilih eksplisit (bukan '*'): saran teks bebas, visit_id, jenis kelamin, dan pendidikan tidak ikut dibaca.
const SELECT_SPAK = [...KOLOM_DASAR, ...KOLOM_SPAK, RELASI].join(', ');
const SELECT_SKM = [...KOLOM_DASAR, ...KOLOM_SKM, RELASI].join(', ');

const IDENTITAS = ['Tanggal Kunjungan', 'Unit', 'Kategori', 'Kode Kunjungan'];

const satu = <T,>(r: Relasi<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : (r ?? null));

/** Teks aman rumus; kosong menjadi null supaya sel benar-benar kosong. */
function teks(v: string | null | undefined): string | null {
  const s = amanSel(v);
  return s === '' ? null : s;
}

function labelUnit(r: BarisDasar): string {
  if (r.unit === 'fo') return LABEL_UNIT_FO;
  return satu(r.layanan)?.nama || LABEL_UNIT_TIDAK_DIKETAHUI;
}

function tanggalBaris(r: BarisDasar): string {
  const tanggal = satu(r.kunjungan)?.tanggal;
  // Baris impor tidak punya kunjungan: pakai waktu jawab (formatTanggalId menggeser ke WIB).
  return tanggal ? formatTanggalId(tanggal.slice(0, 10)) : formatTanggalId(r.created_at);
}

function identitas(r: BarisDasar): (string | null)[] {
  return [
    tanggalBaris(r),
    teks(labelUnit(r)),
    teks(satu(r.kunjungan)?.kategori),
    r.kunjungan_id ? r.kunjungan_id.slice(0, 8).toUpperCase() : '—',
  ];
}

const bulat1 = (n: number) => Math.round(n * 10) / 10;

function angka(v: Angka | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const angka1 = (v: Angka | undefined): number | string => {
  const n = angka(v);
  return n === null ? '—' : bulat1(n);
};

function gayaHeader(baris: ExcelJS.Row) {
  baris.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  baris.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  baris.alignment = { vertical: 'middle', wrapText: true };
}

function judul(ws: ExcelJS.Worksheet, teksJudul: string) {
  ws.addRow([teksJudul]).font = { bold: true, size: 12 };
}

/** Sheet data: header sel pertama dibekukan; kolom pernyataan lebar tetap dengan teks dibungkus. */
function sheetData(ws: ExcelJS.Worksheet, header: string[]) {
  const h = ws.addRow(header);
  gayaHeader(h);
  h.height = 80;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 16;
  for (let i = 5; i <= header.length; i++) ws.getColumn(i).width = 22;
}

function buatSheetSpak(wb: ExcelJS.Workbook, rows: BarisSpak[]) {
  const ws = wb.addWorksheet('SPAK');
  sheetData(ws, [
    ...IDENTITAS,
    ...PERTANYAAN_SPAK.map((p) => `${p.kunci.toUpperCase()}. ${p.teks}`),
  ]);
  for (const r of rows) ws.addRow([...identitas(r), ...KOLOM_SPAK.map((k) => r[k] ?? null)]);
}

function buatSheetSkm(wb: ExcelJS.Workbook, rows: BarisSkm[]) {
  const ws = wb.addWorksheet('SKM');
  sheetData(ws, [
    ...IDENTITAS,
    ...UNSUR_SKM.map((u) => `${u.kunci.toUpperCase()}. ${u.teks}`),
  ]);
  for (const r of rows) ws.addRow([...identitas(r), ...KOLOM_SKM.map((k) => r[k] ?? null)]);
}

function buatSheetRingkasan(wb: ExcelJS.Workbook, d: DataSurvei) {
  const ws = wb.addWorksheet('Ringkasan');
  [44, 14, 14, 22, 14, 14, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const periode = ws.addRow(['Periode', `${formatTanggalId(d.dari)} s.d. ${formatTanggalId(d.sampai)}`]);
  periode.getCell(1).font = { bold: true };
  if (d.terpotong) {
    ws.addRow(['Catatan', 'Data jawaban terpotong pada batas baris ekspor; persempit periode agar lengkap.']).getCell(1).font = { bold: true };
  }

  ws.addRow([]);
  judul(ws, 'IKM per Unit');
  gayaHeader(ws.addRow(['Unit', 'IKM', 'Responden', 'Predikat']));
  for (const r of d.ringkasanIkm) {
    const ikm = angka(r.ikm);
    ws.addRow([teks(r.nama), ikm === null ? '—' : bulat1(ikm), r.responden, ikmQualityLabel(ikm)]);
  }

  ws.addRow([]);
  judul(ws, 'Rata-rata SPAK per Unit (skala 1-6)');
  gayaHeader(ws.addRow(['Unit', 'Responden', 'P1', 'P2', 'P3', 'P4', 'P5']));
  for (const r of d.ringkasanSpak) {
    ws.addRow([teks(r.nama), r.responden, angka1(r.p1), angka1(r.p2), angka1(r.p3), angka1(r.p4), angka1(r.p5)]);
  }

  ws.addRow([]);
  judul(ws, 'Response Rate');
  gayaHeader(ws.addRow(['Unit', 'Diundang', 'Mengisi', 'Persen (%)']));
  const persen = (mengisi: number, diundang: number) => (diundang > 0 ? bulat1((mengisi / diundang) * 100) : '—');
  let totalDiundang = 0;
  let totalMengisi = 0;
  for (const r of d.ringkasanRate) {
    totalDiundang += r.diundang;
    totalMengisi += r.mengisi;
    ws.addRow([teks(r.nama), r.diundang, r.mengisi, persen(r.mengisi, r.diundang)]);
  }
  const total = ws.addRow(['Total', totalDiundang, totalMengisi, persen(totalMengisi, totalDiundang)]);
  total.font = { bold: true };
}

function buatSheetLegenda(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Legenda');
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 110;
  const blok = (judulBlok: string, kolom: [string, string], isi: readonly (readonly [string | number, string])[]) => {
    judul(ws, judulBlok);
    gayaHeader(ws.addRow(kolom));
    for (const [a, b] of isi) ws.addRow([a, b]);
    ws.addRow([]);
  };
  blok('Skala SPAK (1-6)', ['Nilai', 'Keterangan'], SKALA_SPAK.map((s) => [s.nilai, s.label] as const));
  blok('Skala SKM (1-4)', ['Nilai', 'Keterangan'], SKALA_SKM.map((s) => [s.nilai, s.label] as const));
  blok('Pernyataan SPAK', ['Kode', 'Pernyataan'], PERTANYAAN_SPAK.map((p) => [p.kunci.toUpperCase(), p.teks] as const));
  blok('Unsur SKM', ['Kode', 'Unsur'], UNSUR_SKM.map((u) => [u.kunci.toUpperCase(), u.teks] as const));
  blok('Catatan', ['Istilah', 'Penjelasan'], [
    ['IKM', 'Rata-rata nilai unsur yang terisi dikali 25 (skala 25-100). Data lama memuat 9 unsur; unsur 10 dan 11 kosong.'],
    ['Predikat IKM', 'A (88-100) Sangat Baik; B (76-87,99) Baik; C (60-75,99) Kurang Baik; D (di bawah 60) Tidak Baik.'],
    ['Unit', 'Nama layanan, Front Office, atau "Tidak terklasifikasi (data lama/impor)".'],
    ['Kode Kunjungan', '8 karakter pertama id kunjungan; "—" bila tidak ada kunjungan (data impor). Berkas tidak memuat nama, HP, atau email.'],
    ['Response Rate', 'Mengisi dibagi diundang dikali 100; undangan dihitung menurut tanggal dibuat (WIB).'],
  ]);
}

export async function buildSurveiWorkbook(data: DataSurvei): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DPMPTSP Lampung';
  wb.created = new Date();
  buatSheetSpak(wb, data.spak);
  buatSheetSkm(wb, data.skm);
  buatSheetRingkasan(wb, data);
  buatSheetLegenda(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Jawaban SPAK dan SKM pada periode (tanggal WIB inklusif) lewat klien SESI pengguna (RLS Admin/FO). Paginasi penuh
 * (`fetchAllPages`): PostgREST memotong 1.000 baris per respons. Urutan created_at lalu id agar offset stabil.
 */
export async function muatDataSurvei(
  supabase: SupabaseClient,
  periode: { dari: string; sampai: string },
): Promise<{ spak: BarisSpak[]; skm: BarisSkm[]; terpotong: boolean }> {
  const dari = awalHariWIB(periode.dari);
  const sebelum = awalHariBerikutnyaWIB(periode.sampai);
  const ambil = <T,>(tabel: 'spak_respons' | 'skm_respons', kolom: string) =>
    fetchAllPages<T>((from, to) =>
      supabase
        .from(tabel)
        .select(kolom)
        .gte('created_at', dari)
        .lt('created_at', sebelum)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: unknown }>,
    );
  const [spak, skm] = await Promise.all([
    ambil<BarisSpak>('spak_respons', SELECT_SPAK),
    ambil<BarisSkm>('skm_respons', SELECT_SKM),
  ]);
  return { spak: spak.rows, skm: skm.rows, terpotong: spak.truncated || skm.truncated };
}
