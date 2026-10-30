// Unduhan XLSX "Pesan Perilaku" (survei terpadu Fase A, spec §9): sheet SPAK, SKM, Ringkasan, Legenda.
// Kolom identitas HANYA tanggal kunjungan, unit, kategori pengunjung, dan kode kunjungan; tanpa nama, HP, atau email
// (kolom itu memang tidak dibaca dari database, jadi tidak mungkin bocor lewat berkas). Teks yang berasal dari database
// (nama layanan, kategori) dinetralkan dari injeksi rumus lewat `amanSel`.
// Ringkasan (IKM, SPAK, response rate) bersifat GLOBAL (seluruh pelayanan digabung, tanpa pemecahan per unit; keputusan pemilik
// 2026-11-03): IKM dan SPAK dihitung dari jawaban yang sama dengan sheet data (`ringkasan-global.ts`); response rate datang dari
// RPC `ringkasan_response_rate` yang HARUS dipanggil dengan klien sesi pengguna (dijaga peran_saya()): pemanggil menyuplainya.
import ExcelJS from 'exceljs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPages } from '@/lib/rekap/exportAll';
import { awalHariBerikutnyaWIB, awalHariWIB, formatTanggalId } from '@/lib/rekap/format';
import { PERTANYAAN_SPAK, SKALA_SKM, SKALA_SPAK, UNSUR_SKM } from './pertanyaan';
import { hitungIkmGlobal, hitungSpakGlobal, persen as hitungPersen, type BarisMentah } from './ringkasan-global';

/** Teks diawali = + - @ tab/CR diberi apostrof agar tidak dieksekusi Excel sebagai rumus (formula injection). */
export function amanSel(v: string | null | undefined): string {
  const s = v ?? '';
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

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


export interface RingkasanRateRow { layanan_id: string | null; unit: string; nama: string; diundang: number; mengisi: number }

export interface DataSurvei {
  /** YYYY-MM-DD (WIB), inklusif. */
  dari: string;
  sampai: string;
  spak: BarisSpak[];
  skm: BarisSkm[];
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
  [44, 52, 14, 16, 18, 14, 14, 14, 10, 10, 10, 10, 10, 10].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const periodeGlobal = { dari: d.dari, sampai: d.sampai };
  const ikm = hitungIkmGlobal(d.skm as unknown as BarisMentah[], periodeGlobal);
  const spak = hitungSpakGlobal(d.spak as unknown as BarisMentah[], periodeGlobal);
  const pct = (v: number | null) => (v === null ? '—' : bulat1(v));

  const periode = ws.addRow(['Periode', `${formatTanggalId(d.dari)} s.d. ${formatTanggalId(d.sampai)}`]);
  periode.getCell(1).font = { bold: true };
  ws.addRow(['Cakupan', 'Seluruh pelayanan digabung (tidak dipecah per Layanan)']);
  if (d.terpotong) {
    ws.addRow(['Catatan', 'Data jawaban terpotong pada batas baris ekspor; persempit periode agar lengkap.']).getCell(1).font = { bold: true };
  }

  ws.addRow([]);
  judul(ws, 'Ringkasan IKM (Indeks Kepuasan Masyarakat)');
  gayaHeader(ws.addRow(['Indikator', 'Nilai']));
  ws.addRow(['Responden', ikm.responden]);
  ws.addRow(['IKM (skala 25-100)', pct(ikm.ikm)]);
  ws.addRow(['Predikat', ikm.mutuLabel]);
  ws.addRow([]);
  judul(ws, 'IKM per Unsur');
  gayaHeader(ws.addRow(['Unsur', 'Keterangan', 'Jawaban', 'Rata-rata (1-4)', 'Nilai IKM (25-100)']));
  for (const u of ikm.unsur) {
    ws.addRow([u.kunci.toUpperCase(), teks(u.teks), u.jawaban, u.rata === null ? '—' : Math.round(u.rata * 100) / 100, pct(u.nilai)]);
  }

  ws.addRow([]);
  judul(ws, 'Ringkasan SPAK (Survey Persepsi Anti Korupsi)');
  gayaHeader(ws.addRow(['Indikator', 'Nilai']));
  ws.addRow(['Responden', spak.responden]);
  ws.addRow(['Rata-rata (skala 1-6)', spak.rata === null ? '—' : Math.round(spak.rata * 100) / 100]);
  ws.addRow(['Indeks SPAK (skala 0-100)', pct(spak.indeks)]);
  ws.addRow(['Setuju (nilai 5-6), % jawaban', pct(spak.persenSetuju)]);
  ws.addRow(['Netral (nilai 3-4), % jawaban', pct(spak.persenNetral)]);
  ws.addRow(['Tidak setuju (nilai 1-2), % jawaban', pct(spak.persenTidakSetuju)]);
  ws.addRow([]);
  judul(ws, 'SPAK per Pernyataan');
  gayaHeader(ws.addRow(['Pernyataan', 'Keterangan', 'Jawaban', 'Rata-rata (1-6)', 'Indeks (0-100)', 'Setuju (%)', 'Netral (%)', 'Tidak setuju (%)', 'Nilai 1', 'Nilai 2', 'Nilai 3', 'Nilai 4', 'Nilai 5', 'Nilai 6']));
  for (const b of spak.butir) {
    ws.addRow([
      b.kunci.toUpperCase(), teks(b.teks), b.jawaban, b.rata === null ? '—' : Math.round(b.rata * 100) / 100,
      pct(b.indeks), pct(b.persenSetuju), pct(b.persenNetral), pct(b.persenTidakSetuju), ...b.distribusi,
    ]);
  }

  ws.addRow([]);
  judul(ws, 'Response Rate');
  gayaHeader(ws.addRow(['Indikator', 'Nilai']));
  const diundang = d.ringkasanRate.reduce((s, r) => s + r.diundang, 0);
  const mengisi = d.ringkasanRate.reduce((s, r) => s + r.mengisi, 0);
  ws.addRow(['Diundang', diundang]);
  ws.addRow(['Mengisi', mengisi]);
  ws.addRow(['Persen (%)', pct(hitungPersen(mengisi, diundang))]);
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
    ['Unit (sheet data)', 'Nama layanan, Front Office, atau "Tidak terklasifikasi (data lama/impor)". Hanya ada di sheet data mentah; sheet Ringkasan selalu gabungan seluruh pelayanan.'],
    ['Indeks SPAK', 'Rata-rata jawaban dibagi 6 dikali 100. Setuju = nilai 5-6, netral = 3-4, tidak setuju = 1-2.'],
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
