// A13: tanggal, saringan status, dan halaman Antrean disimpan di URL (?tanggal=&status=&halaman=) agar bertahan saat
// muat ulang dan bisa dibagikan antarstaf. Nilai bawaan tidak ditulis supaya URL polos tetap rapi.

export type FilterStatus = 'aktif' | 'selesai' | 'semua';

export const FILTER_BAWAAN: FilterStatus = 'aktif';

/** Status tiket per saringan. `null` = semua status (tanpa kondisi). */
export const STATUS_PER_FILTER: Record<FilterStatus, readonly string[] | null> = {
  aktif: ['menunggu', 'dilayani'],
  selesai: ['selesai'],
  semua: null,
};

export interface ParamAntrean {
  tanggal: string;
  status: FilterStatus;
  /** Indeks halaman berbasis 0 (URL memakai berbasis 1). */
  halaman: number;
}

interface PembacaParam {
  get(nama: string): string | null;
}

const POLA_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Tanggal kalender yang benar (bukan sekadar berpola), mis. 2026-02-30 ditolak. */
export function tanggalValid(nilai: string | null | undefined): nilai is string {
  if (!nilai) return false;
  const m = POLA_TANGGAL.exec(nilai);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === nilai;
}

export function bacaParamAntrean(sp: PembacaParam, hariIni: string): ParamAntrean {
  const tanggal = sp.get('tanggal');
  const status = sp.get('status');
  const halaman = Number.parseInt(sp.get('halaman') ?? '', 10);
  return {
    tanggal: tanggalValid(tanggal) ? tanggal : hariIni,
    status: status === 'aktif' || status === 'selesai' || status === 'semua' ? status : FILTER_BAWAAN,
    halaman: Number.isFinite(halaman) && halaman >= 1 ? Math.min(halaman, 100_000) - 1 : 0,
  };
}

/** String query tanpa tanda tanya; kosong bila semuanya bernilai bawaan. */
export function susunQueryAntrean(p: ParamAntrean, hariIni: string): string {
  const q = new URLSearchParams();
  if (p.tanggal !== hariIni) q.set('tanggal', p.tanggal);
  if (p.status !== FILTER_BAWAAN) q.set('status', p.status);
  if (p.halaman > 0) q.set('halaman', String(p.halaman + 1));
  return q.toString();
}
