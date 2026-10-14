// Performa pelayanan (Tahap D): agregasi di TypeScript dari baris `penanganan` (paginasi penuh dilakukan pemanggil).
// Murni dan deterministik agar mudah diuji.
//
// Definisi (spec §6, kontrak §1.5):
//  - Tahap "selesai" = status 'selesai' dengan hasil terisi. Hanya tahap itu yang masuk durasi dan tingkat.
//  - Durasi tahap = selesai_at - mulai_at. Waktu tunggu layanan = mulai_at - created_at (tahap layanan saja).
//  - Tingkat eskalasi = tahap FO berhasil 'dieskalasi' / semua tahap FO selesai.
//  - Tingkat pengembalian = tahap layanan berhasil 'dikembalikan' / semua tahap layanan selesai.
//  - Pembagi nol -> null (ditampilkan "—"), bukan 0%: tidak ada data bukan berarti tingkatnya nol.
//  - Hari = tanggal WIB dari mulai_at.
// Keterbatasan yang diterima: waktu tunggu SEBELUM disapa FO tidak terukur (tidak ada tiket/baris di tahap itu).
import { hariWIB, selisihMenit } from './format';

export interface BarisPerforma {
  id: string;
  kunjungan_id: string;
  peran_tahap: 'fo' | 'layanan';
  layanan_id: string | null;
  penangan_id: string | null;
  status: string;
  hasil: string | null;
  mulai_at: string | null;
  selesai_at: string | null;
  created_at: string;
}

export interface Metrik {
  /** Tahap yang ditutup dengan hasil (selesai / dieskalasi / dikembalikan). */
  tahap_selesai: number;
  /** Pengunjung (kunjungan) berbeda pada tahap_selesai. */
  pengunjung: number;
  selesai_langsung: number;
  dieskalasi: number;
  dikembalikan: number;
  /** Tahap dibatalkan sistem/Admin (diambil alih, dialihkan) yang sempat mulai. */
  batal: number;
  /** Tahap yang masih berjalan (belum ditutup) pada rentang ini. */
  berjalan: number;
  rata_durasi_menit: number | null;
  rata_tunggu_menit: number | null;
  tingkat_eskalasi: number | null;
  tingkat_pengembalian: number | null;
}

export interface PerformaOrang extends Metrik {
  penangan_id: string;
  nama: string;
  peran: 'fo' | 'layanan';
}

export interface PerformaLayanan extends Metrik {
  layanan_id: string;
  nama: string;
}

export interface PerformaHari {
  tanggal: string;
  pengunjung: number;
  fo: Metrik;
  layanan: Metrik;
}

export interface HasilPerforma {
  ringkasan: { pengunjung_dilayani: number; total_baris: number; fo: Metrik; layanan: Metrik };
  per_orang: PerformaOrang[];
  per_layanan: PerformaLayanan[];
  per_hari: PerformaHari[];
}

export function bagi(a: number, b: number): number | null {
  return b === 0 ? null : a / b;
}

function rata(nilai: number[]): number | null {
  return nilai.length === 0 ? null : nilai.reduce((s, n) => s + n, 0) / nilai.length;
}

function tahapSelesai(r: BarisPerforma): boolean {
  return r.status === 'selesai' && (r.hasil === 'selesai' || r.hasil === 'dieskalasi' || r.hasil === 'dikembalikan');
}

/** Metrik satu kelompok baris. Pemanggil sebaiknya menyaring per peran agar tingkat bermakna. */
export function hitungMetrik(rows: BarisPerforma[]): Metrik {
  const selesai = rows.filter(tahapSelesai);
  const durasi: number[] = [];
  for (const r of selesai) {
    const d = selisihMenit(r.mulai_at, r.selesai_at);
    if (d != null) durasi.push(d);
  }
  const tunggu: number[] = [];
  for (const r of rows) {
    if (r.peran_tahap !== 'layanan') continue;
    const t = selisihMenit(r.created_at, r.mulai_at);
    if (t != null) tunggu.push(t);
  }
  const dieskalasi = selesai.filter((r) => r.hasil === 'dieskalasi').length;
  const dikembalikan = selesai.filter((r) => r.hasil === 'dikembalikan').length;
  return {
    tahap_selesai: selesai.length,
    pengunjung: new Set(selesai.map((r) => r.kunjungan_id)).size,
    selesai_langsung: selesai.length - dieskalasi - dikembalikan,
    dieskalasi,
    dikembalikan,
    batal: rows.filter((r) => r.status === 'batal').length,
    berjalan: rows.filter((r) => r.status === 'berjalan').length,
    rata_durasi_menit: rata(durasi),
    rata_tunggu_menit: rata(tunggu),
    tingkat_eskalasi: bagi(dieskalasi, selesai.length),
    tingkat_pengembalian: bagi(dikembalikan, selesai.length),
  };
}

function kelompokkan(rows: BarisPerforma[], kunci: (r: BarisPerforma) => string | null): Map<string, BarisPerforma[]> {
  const m = new Map<string, BarisPerforma[]>();
  for (const r of rows) {
    const k = kunci(r);
    if (k == null) continue;
    const daftar = m.get(k);
    if (daftar) daftar.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export function hitungPerforma(
  semua: BarisPerforma[],
  namaPetugas: Record<string, string> = {},
  namaLayanan: Record<string, string> = {},
): HasilPerforma {
  // Hanya tahap yang pernah mulai (punya mulai_at) yang punya hari/durasi; 'menunggu' tidak dihitung.
  const rows = semua.filter((r) => r.mulai_at != null);
  const fo = rows.filter((r) => r.peran_tahap === 'fo');
  const layanan = rows.filter((r) => r.peran_tahap === 'layanan');

  const pengunjungDilayani = new Set(rows.filter(tahapSelesai).map((r) => r.kunjungan_id)).size;

  const perOrang: PerformaOrang[] = [];
  for (const [peran, daftar] of [['fo', fo], ['layanan', layanan]] as const) {
    for (const [id, baris] of kelompokkan(daftar, (r) => r.penangan_id)) {
      perOrang.push({ penangan_id: id, nama: namaPetugas[id] ?? '(tidak dikenal)', peran, ...hitungMetrik(baris) });
    }
  }
  perOrang.sort((a, b) => b.tahap_selesai - a.tahap_selesai || a.nama.localeCompare(b.nama) || a.peran.localeCompare(b.peran));

  const perLayanan: PerformaLayanan[] = [...kelompokkan(layanan, (r) => r.layanan_id)]
    .map(([id, baris]) => ({ layanan_id: id, nama: namaLayanan[id] ?? '(tidak dikenal)', ...hitungMetrik(baris) }))
    .sort((a, b) => b.tahap_selesai - a.tahap_selesai || a.nama.localeCompare(b.nama));

  const perHari: PerformaHari[] = [...kelompokkan(rows, (r) => (r.mulai_at ? hariWIB(r.mulai_at) : null))]
    .map(([tanggal, baris]) => ({
      tanggal,
      pengunjung: new Set(baris.filter(tahapSelesai).map((r) => r.kunjungan_id)).size,
      fo: hitungMetrik(baris.filter((r) => r.peran_tahap === 'fo')),
      layanan: hitungMetrik(baris.filter((r) => r.peran_tahap === 'layanan')),
    }))
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal));

  return {
    ringkasan: {
      pengunjung_dilayani: pengunjungDilayani,
      total_baris: rows.length,
      fo: hitungMetrik(fo),
      layanan: hitungMetrik(layanan),
    },
    per_orang: perOrang,
    per_layanan: perLayanan,
    per_hari: perHari,
  };
}
