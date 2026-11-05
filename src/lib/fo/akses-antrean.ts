// Klien RPC akses Front Office (migrasi 202611030015, kontrak .tim/akses-fo/KONTRAK.md "Data dan API tersedia").
// Antrean, kunjungan, dan pratinjau reservasi dibuka untuk semua Front Office lewat RPC berkolom aman: tanpa HP, email,
// dan isian pendataan milik FO lain. Modul ini murni (tanpa React).
//
// Aturan klien: objek belum ada (migrasi belum diterapkan) -> `{ tersedia: false }` dan halaman kembali ke kueri lama.
// Galat lain DILEMPAR agar tampil sebagai gagal memuat, bukan daftar kosong.
import type { SupabaseClient } from '@supabase/supabase-js';
import { objekBelumAda } from '@/lib/akses-data/galat';
import { addDaysWIB, todayWIB } from '@/lib/time';
import type { RingkasanDilayani } from '@/lib/rekap/ringkasan';

type KlienRpc = Pick<SupabaseClient, 'rpc'>;

export type HasilAkses<T> = { tersedia: true; data: T } | { tersedia: false };

export interface BarisAntreanFo {
  id: string;
  kunjungan_id: string | null;
  layanan_id: string;
  dilayani_oleh: string | null;
  penanganan_asal_id: string | null;
  nomor: number;
  nomor_display: string;
  status: string;
  waktu_terbit: string | null;
  waktu_mulai_layan: string | null;
  waktu_selesai: string | null;
  layanan: { nama: string; form_pendataan: string | null } | null;
  pelayan: { nama: string } | null;
  kunjungan: { nama: string; asal: string; waktu_masuk: string | null } | null;
  fo_nama: string | null;
}

export interface HalamanAntreanFo {
  rows: BarisAntreanFo[];
  total: number;
  statistik: { totalSelesai: number; rataWaktuMenit: number };
}

export interface BarisKunjunganFo {
  id: string;
  nama: string;
  asal: string;
  status: string;
  waktu_masuk: string | null;
  tanggal: string;
  fo_nama: string | null;
  tiket_antrean: Array<{ nomor_display: string | null; waktu_selesai: string | null; layanan: { nama: string } | null }>;
}

export interface HalamanKunjunganFo {
  rows: BarisKunjunganFo[];
  /** Jumlah SETELAH filter cari/status (sebelum paginasi) bila `disaringServer`; selain itu total tanggal itu. */
  total: number;
  /** false = RPC lama tanpa p_cari/p_status: filter belum diterapkan server, pemanggil menyaring halaman di klien. */
  disaringServer: boolean;
}

/** Batas panjang p_cari di server (202611040001). */
export const BATAS_CARI = 100;

export type StatusKunjunganFilter = 'semua' | 'menunggu' | 'dilayani' | 'selesai';

export interface FilterKunjungan {
  cari?: string | null;
  status?: StatusKunjunganFilter | null;
  signal?: AbortSignal;
}

export interface PratinjauReservasiAman {
  id: string;
  nama: string;
  tanggal: string;
  status: string;
  jam_rencana: string | null;
  layanan_saran_id: string | null;
  layanan_nama: string | null;
}

export interface ParamHalaman {
  tanggal: string;
  batas: number;
  lewati: number;
}

const adalahObjek = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const adalahAngka = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Panggil RPC; objek belum ada -> null, galat lain dilempar. */
async function panggil(
  supabase: KlienRpc, nama: string, args: Record<string, unknown>, signal?: AbortSignal,
): Promise<{ data: unknown } | null> {
  const q = supabase.rpc(nama, args) as unknown as PromiseLike<{ data: unknown; error: unknown }> & {
    abortSignal?: (s: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>;
  };
  const { data, error } = await (signal && typeof q.abortSignal === 'function' ? q.abortSignal(signal) : q);
  if (error) {
    if (objekBelumAda(error)) return null;
    throw error;
  }
  return { data };
}

export async function muatAntreanFo(
  supabase: KlienRpc,
  p: ParamHalaman & { layananId?: string | null },
): Promise<HasilAkses<HalamanAntreanFo>> {
  const h = await panggil(supabase, 'fo_antrean_daftar', {
    p_tanggal: p.tanggal, p_layanan_id: p.layananId ?? null, p_batas: p.batas, p_lewati: p.lewati,
  });
  if (!h) return { tersedia: false };
  const d = h.data;
  if (
    !adalahObjek(d) || !Array.isArray(d.rows) || !adalahAngka(d.total) || !adalahObjek(d.statistik)
    || !adalahAngka(d.statistik.totalSelesai) || !adalahAngka(d.statistik.rataWaktuMenit)
  ) {
    throw new Error('Respons daftar antrean tidak valid.');
  }
  return {
    tersedia: true,
    data: {
      rows: d.rows as BarisAntreanFo[],
      total: d.total,
      statistik: { totalSelesai: d.statistik.totalSelesai, rataWaktuMenit: d.statistik.rataWaktuMenit },
    },
  };
}

/**
 * Daftar kunjungan satu tanggal. Pencarian (`cari`) dan `status` diterapkan server SEBELUM paginasi (`p_cari`/`p_status`,
 * migrasi 202611040001) sehingga `total` = jumlah terfilter. RPC masih bentuk lama (3 argumen) -> diulang tanpa filter dan
 * ditandai `disaringServer:false`; halaman lalu menyaring halaman yang tampil (perilaku sebelum migrasi).
 */
export async function muatKunjunganFo(
  supabase: KlienRpc,
  p: ParamHalaman & FilterKunjungan,
): Promise<HasilAkses<HalamanKunjunganFo>> {
  const dasar = { p_tanggal: p.tanggal, p_batas: p.batas, p_lewati: p.lewati };
  const cari = p.cari?.trim() ? p.cari.trim().slice(0, BATAS_CARI) : null;
  const status = p.status && p.status !== 'semua' ? p.status : null;
  let disaringServer = true;
  let h = await panggil(supabase, 'fo_kunjungan_daftar', { ...dasar, p_cari: cari, p_status: status }, p.signal);
  if (!h) {
    disaringServer = false;
    h = await panggil(supabase, 'fo_kunjungan_daftar', dasar, p.signal);
  }
  if (!h) return { tersedia: false };
  const d = h.data;
  if (!adalahObjek(d) || !Array.isArray(d.rows) || !adalahAngka(d.total)) {
    throw new Error('Respons daftar kunjungan tidak valid.');
  }
  return { tersedia: true, data: { rows: d.rows as BarisKunjunganFo[], total: d.total, disaringServer } };
}

// ---------------------------------------------------------------------------
// Jendela tanggal FO non-Koordinator (migrasi 202611040001): [hari ini-7, hari ini+1] WIB
// ---------------------------------------------------------------------------

export interface JendelaTanggal {
  min: string;
  max: string;
}

export const JENDELA_FO_MUNDUR_HARI = 7;
export const JENDELA_FO_MAJU_HARI = 1;

/** Jendela hanya untuk FO yang bukan Koordinator; Admin, Koordinator, petugas, dan peran belum diketahui = null (bebas). */
export function jendelaTanggalFo(
  peran: { role: string; koordinator?: boolean } | null | undefined,
  hariIni: string = todayWIB(),
): JendelaTanggal | null {
  if (!peran || peran.role !== 'front_office' || peran.koordinator === true) return null;
  const [y, m, d] = hariIni.split('-').map((v) => parseInt(v, 10));
  const dasar = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    min: addDaysWIB(-JENDELA_FO_MUNDUR_HARI, dasar),
    max: addDaysWIB(JENDELA_FO_MAJU_HARI, dasar),
  };
}

export function tanggalDalamJendela(tanggal: string, jendela: JendelaTanggal | null): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return false;
  if (!jendela) return true;
  return tanggal >= jendela.min && tanggal <= jendela.max;
}

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const tanggalPendek = (iso: string) => {
  const [y, m, d] = iso.split('-').map((v) => parseInt(v, 10));
  return `${d} ${BULAN[m - 1]} ${y}`;
};

/** Pesan untuk tanggal di luar jendela; tanpa jendela (galat dari server saat peran belum diketahui) = versi umum. */
export function pesanJendelaTanggal(j?: JendelaTanggal | null): string {
  const rentang = j ? `tanggal ${tanggalPendek(j.min)} sampai ${tanggalPendek(j.max)} ` : 'tanggal dalam rentang ';
  return `Front Office hanya dapat membuka ${rentang}(7 hari ke belakang sampai besok). `
    + 'Untuk tanggal lain, minta Koordinator atau Admin.';
}

/** Galat server karena tanggal di luar jendela FO (pesan diawali `TANGGAL_DILUAR_BATAS`). */
export function galatTanggalDiluarBatas(err: unknown): boolean {
  const msg = err && typeof err === 'object' ? (err as { message?: unknown }).message : null;
  return typeof msg === 'string' && msg.startsWith('TANGGAL_DILUAR_BATAS');
}

/** `data: null` = token tidak dikenal; `tersedia:false` = RPC belum ada (pemindai memakai kueri lama). */
export async function muatPratinjauReservasi(
  supabase: KlienRpc,
  token: string,
): Promise<HasilAkses<PratinjauReservasiAman | null>> {
  const h = await panggil(supabase, 'fo_pratinjau_reservasi', { p_qr_token: token.trim() });
  if (!h) return { tersedia: false };
  if (h.data == null) return { tersedia: true, data: null };
  if (!adalahObjek(h.data) || typeof h.data.id !== 'string' || typeof h.data.nama !== 'string') {
    throw new Error('Respons pratinjau reservasi tidak valid.');
  }
  return { tersedia: true, data: h.data as unknown as PratinjauReservasiAman };
}

// ---------------------------------------------------------------------------
// Ringkasan "dilayani saya / total (persen)" (rekap tertutup)
// ---------------------------------------------------------------------------

export type Dilayani = RingkasanDilayani;

const angkaId = new Intl.NumberFormat('id-ID');
const persenId = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

/** "45 / 120 (37,5%)". Persen dari server (dua desimal) ditampilkan paling banyak satu desimal. */
export function formatDilayani(d: Dilayani): string {
  return `${angkaId.format(d.saya)} / ${angkaId.format(d.total)} (${persenId.format(d.persen)}%)`;
}

/** Ambil `dilayani` dari body API rekap. Null / bentuk salah -> null (disembunyikan, tidak pernah nol palsu). */
export function ambilDilayani(body: Record<string, unknown> | null | undefined): Dilayani | null {
  const d = body?.dilayani;
  if (!adalahObjek(d)) return null;
  const { saya, total, persen } = d;
  if (!adalahAngka(saya) || !adalahAngka(total) || !adalahAngka(persen)) return null;
  if (saya < 0 || total < 0 || persen < 0) return null;
  return { saya, total, persen };
}
