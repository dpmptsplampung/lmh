// Util tanggal murni untuk pemilih tanggal. Semua nilai berupa string "YYYY-MM-DD" (kalender WIB, sama dengan nilai
// <input type="date">). Hitungan memakai kalender UTC di dalam (tanpa zona perangkat), jadi tidak bergeser oleh DST
// atau zona waktu mesin. "Hari ini" TIDAK dihitung di sini: ambil dari todayWIB() (src/lib/time.ts) lalu oper sebagai
// argumen, supaya util ini deterministik dan mudah diuji.

export const NAMA_BULAN = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

export const NAMA_BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

// Minggu dimulai Senin.
export const NAMA_HARI_PENDEK = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'] as const;
export const NAMA_HARI_PANJANG = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'] as const;

export interface UraianTanggal {
  tahun: number;
  bulan: number; // 1-12
  hari: number; // 1-31
}

const POLA = /^(\d{4})-(\d{2})-(\d{2})$/;

function keUTC(tahun: number, bulan: number, hari: number): Date {
  const d = new Date(0);
  d.setUTCFullYear(tahun, bulan - 1, hari);
  return d;
}

function dua(n: number): string {
  return String(n).padStart(2, '0');
}

/** Susun string "YYYY-MM-DD" dari komponen (tanpa validasi). */
export function susunTanggal(tahun: number, bulan: number, hari: number): string {
  return `${String(tahun).padStart(4, '0')}-${dua(bulan)}-${dua(hari)}`;
}

/** Uraikan "YYYY-MM-DD" ketat; null bila format salah atau tanggal tidak ada (mis. 2026-02-30). */
export function uraiTanggal(iso: unknown): UraianTanggal | null {
  if (typeof iso !== 'string') return null;
  const m = POLA.exec(iso);
  if (!m) return null;
  const tahun = Number(m[1]);
  const bulan = Number(m[2]);
  const hari = Number(m[3]);
  if (bulan < 1 || bulan > 12 || hari < 1) return null;
  const d = keUTC(tahun, bulan, hari);
  if (d.getUTCFullYear() !== tahun || d.getUTCMonth() !== bulan - 1 || d.getUTCDate() !== hari) return null;
  return { tahun, bulan, hari };
}

export function tanggalValid(iso: unknown): iso is string {
  return uraiTanggal(iso) !== null;
}

function dariUTC(d: Date): string {
  return susunTanggal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function wajibUrai(iso: string): UraianTanggal {
  const u = uraiTanggal(iso);
  if (!u) throw new RangeError(`Tanggal tidak valid: ${String(iso)}`);
  return u;
}

export function kabisat(tahun: number): boolean {
  return (tahun % 4 === 0 && tahun % 100 !== 0) || tahun % 400 === 0;
}

export function hariDalamBulan(tahun: number, bulan: number): number {
  return [31, kabisat(tahun) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][bulan - 1];
}

export function tambahHari(iso: string, n: number): string {
  const { tahun, bulan, hari } = wajibUrai(iso);
  return dariUTC(keUTC(tahun, bulan, hari + n));
}

/** Geser bulan; hari dipangkas ke akhir bulan tujuan (31 Jan + 1 bulan = 28/29 Feb). */
export function tambahBulan(iso: string, n: number): string {
  const { tahun, bulan, hari } = wajibUrai(iso);
  const indeks = tahun * 12 + (bulan - 1) + n;
  const t = Math.floor(indeks / 12);
  const b = (((indeks % 12) + 12) % 12) + 1;
  return susunTanggal(t, b, Math.min(hari, hariDalamBulan(t, b)));
}

/** Geser tahun; 29 Feb dipangkas ke 28 Feb pada tahun biasa. */
export function tambahTahun(iso: string, n: number): string {
  return tambahBulan(iso, n * 12);
}

/** Indeks hari dalam pekan: 0 = Senin ... 6 = Minggu. */
export function hariPekan(iso: string): number {
  const { tahun, bulan, hari } = wajibUrai(iso);
  return (keUTC(tahun, bulan, hari).getUTCDay() + 6) % 7;
}

export function awalPekan(iso: string): string {
  return tambahHari(iso, -hariPekan(iso));
}

export function akhirPekan(iso: string): string {
  return tambahHari(iso, 6 - hariPekan(iso));
}

export function awalBulan(iso: string): string {
  const { tahun, bulan } = wajibUrai(iso);
  return susunTanggal(tahun, bulan, 1);
}

export function akhirBulan(iso: string): string {
  const { tahun, bulan } = wajibUrai(iso);
  return susunTanggal(tahun, bulan, hariDalamBulan(tahun, bulan));
}

/** Urutan leksikografis string ISO sama dengan urutan kalender. Hasil negatif, nol, atau positif. */
export function bandingkanTanggal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Jumlah hari dari a ke b (b - a). */
export function selisihHari(a: string, b: string): number {
  const x = wajibUrai(a);
  const y = wajibUrai(b);
  return Math.round((keUTC(y.tahun, y.bulan, y.hari).getTime() - keUTC(x.tahun, x.bulan, x.hari).getTime()) / 86_400_000);
}

/** Jepit tanggal ke [min, max]; batas yang tidak valid atau kosong diabaikan. */
export function apitkan(iso: string, min?: string, max?: string): string {
  let hasil = iso;
  if (tanggalValid(max) && hasil > max) hasil = max;
  if (tanggalValid(min) && hasil < min) hasil = min;
  return hasil;
}

export function diLuarBatas(iso: string, min?: string, max?: string): boolean {
  return (tanggalValid(min) && iso < min) || (tanggalValid(max) && iso > max);
}

/** Urutkan dua tanggal menjadi [awal, akhir]. */
export function urutkanRentang(a: string, b: string): { dari: string; sampai: string } {
  return a <= b ? { dari: a, sampai: b } : { dari: b, sampai: a };
}

/**
 * Kisi bulan: daftar pekan (Senin sampai Minggu). Sel di luar bulan berisi null. Pekan pertama dan terakhir
 * hanya memuat hari bulan itu; jumlah pekan 4 sampai 6.
 */
export function susunBulan(tahun: number, bulan: number): Array<Array<string | null>> {
  const jumlah = hariDalamBulan(tahun, bulan);
  const awal = susunTanggal(tahun, bulan, 1);
  const geser = hariPekan(awal);
  const sel: Array<string | null> = Array.from({ length: geser }, () => null);
  for (let h = 1; h <= jumlah; h += 1) sel.push(susunTanggal(tahun, bulan, h));
  while (sel.length % 7 !== 0) sel.push(null);
  const pekan: Array<Array<string | null>> = [];
  for (let i = 0; i < sel.length; i += 7) pekan.push(sel.slice(i, i + 7));
  return pekan;
}

// ---------- Format tampilan (id-ID, tanpa Intl: tetap sama di server dan klien) ----------

function bagian(iso: string): UraianTanggal | null {
  return uraiTanggal(iso);
}

/** "4 Nov 2026". Tanggal tidak valid menghasilkan string kosong. */
export function formatPendek(iso: string): string {
  const u = bagian(iso);
  return u ? `${u.hari} ${NAMA_BULAN_PENDEK[u.bulan - 1]} ${u.tahun}` : '';
}

/** "4 November 2026". */
export function formatPanjang(iso: string): string {
  const u = bagian(iso);
  return u ? `${u.hari} ${NAMA_BULAN[u.bulan - 1]} ${u.tahun}` : '';
}

/** "Rabu, 4 November 2026". */
export function formatPanjangDenganHari(iso: string): string {
  const u = bagian(iso);
  return u ? `${NAMA_HARI_PANJANG[hariPekan(iso)]}, ${formatPanjang(iso)}` : '';
}

/** "November 2026". */
export function formatBulanTahun(iso: string): string {
  const u = bagian(iso);
  return u ? `${NAMA_BULAN[u.bulan - 1]} ${u.tahun}` : '';
}

/**
 * Rentang untuk chip: "6 Okt sampai 4 Nov 2026". Tahun awal ditulis hanya bila beda tahun. Awal = akhir menjadi
 * satu tanggal. Tanpa em dash.
 */
export function formatRentangPendek(dari: string, sampai: string): string {
  const a = bagian(dari);
  const b = bagian(sampai);
  if (!a || !b) return '';
  if (dari === sampai) return formatPendek(dari);
  const awal = a.tahun === b.tahun ? `${a.hari} ${NAMA_BULAN_PENDEK[a.bulan - 1]}` : formatPendek(dari);
  return `${awal} sampai ${formatPendek(sampai)}`;
}

/** Versi lengkap untuk pembaca layar: "6 Oktober sampai 4 November 2026". */
export function formatRentangPanjang(dari: string, sampai: string): string {
  const a = bagian(dari);
  const b = bagian(sampai);
  if (!a || !b) return '';
  if (dari === sampai) return formatPanjang(dari);
  const awal = a.tahun === b.tahun ? `${a.hari} ${NAMA_BULAN[a.bulan - 1]}` : formatPanjang(dari);
  return `${awal} sampai ${formatPanjang(sampai)}`;
}

// ---------- Pilihan cepat ----------

export interface RentangTanggal {
  dari: string;
  sampai: string;
}

export interface PilihanCepat {
  kunci: string;
  label: string;
  /** Hitung rentang dari "hari ini" WIB. Awal dan akhir termasuk. */
  hitung: (hariIni: string) => RentangTanggal;
}

export const PILIHAN_CEPAT_BAWAAN: PilihanCepat[] = [
  { kunci: 'hari-ini', label: 'Hari ini', hitung: (h) => ({ dari: h, sampai: h }) },
  { kunci: '7-hari', label: '7 hari terakhir', hitung: (h) => ({ dari: tambahHari(h, -6), sampai: h }) },
  { kunci: '30-hari', label: '30 hari terakhir', hitung: (h) => ({ dari: tambahHari(h, -29), sampai: h }) },
  { kunci: 'bulan-ini', label: 'Bulan ini', hitung: (h) => ({ dari: awalBulan(h), sampai: h }) },
  {
    kunci: 'bulan-lalu',
    label: 'Bulan lalu',
    hitung: (h) => {
      const lalu = tambahBulan(awalBulan(h), -1);
      return { dari: lalu, sampai: akhirBulan(lalu) };
    },
  },
];

/**
 * Jepit rentang ke [min, max]. Null bila seluruh rentang jatuh di luar batas (pilihan cepat dinonaktifkan).
 */
export function apitkanRentang(r: RentangTanggal, min?: string, max?: string): RentangTanggal | null {
  const dari = apitkan(r.dari, min, max);
  const sampai = apitkan(r.sampai, min, max);
  if (dari > r.sampai || sampai < r.dari) return null;
  return { dari, sampai };
}
