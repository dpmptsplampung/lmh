// Pendaftaran walk-in oleh Front Office (K3): validasi, parameter RPC, pemetaan galat, panggilan RPC.
// Dipakai halaman /admin/fo/daftar DAN replay antrean offline (src/lib/offline/replay.ts) agar kedua
// jalur identik. Kontrak: docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §2.1.
import type { SupabaseClient } from '@supabase/supabase-js';
import { KATEGORI_PENGUNJUNG } from '@/lib/constants';
import { GalatRpc, jalankanRpc } from '@/lib/rpc-galat';

export interface DataWalkin {
  nama: string;
  asal_instansi: string;
  kontak_hp: string;
  kategori: string;
  email: string;
  keperluan: string;
  layanan_saran_id: string;
}

export const WALKIN_KOSONG: DataWalkin = {
  nama: '',
  asal_instansi: '',
  kontak_hp: '',
  kategori: '',
  email: '',
  keperluan: '',
  layanan_saran_id: '',
};

/** Batas panjang = batas validasi di `fo_mulai_kunjungan`. */
export const BATAS_WALKIN = {
  namaMin: 3,
  namaMax: 120,
  asalMin: 2,
  asalMax: 200,
  keperluanMax: 500,
} as const;

export const KATEGORI_WALKIN = Object.keys(KATEGORI_PENGUNJUNG) as (keyof typeof KATEGORI_PENGUNJUNG)[];

const POLA_HP = /^(\+?62|0)[0-9]{8,14}$/;
const POLA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Spasi dan strip dibuang (sama dengan server). */
export function normalisasiHp(hp: string): string {
  return hp.replace(/[\s-]/g, '');
}

export type GalatFormWalkin = Partial<Record<keyof DataWalkin, string>>;

export function validasiWalkin(d: DataWalkin): GalatFormWalkin {
  const g: GalatFormWalkin = {};
  const nama = d.nama.trim();
  if (nama.length < BATAS_WALKIN.namaMin || nama.length > BATAS_WALKIN.namaMax) {
    g.nama = `Nama wajib diisi, ${BATAS_WALKIN.namaMin}–${BATAS_WALKIN.namaMax} karakter`;
  }
  const asal = d.asal_instansi.trim();
  if (asal.length < BATAS_WALKIN.asalMin || asal.length > BATAS_WALKIN.asalMax) {
    g.asal_instansi = `Asal / instansi wajib diisi, ${BATAS_WALKIN.asalMin}–${BATAS_WALKIN.asalMax} karakter`;
  }
  const hp = d.kontak_hp.trim();
  if (hp && !POLA_HP.test(normalisasiHp(hp))) {
    g.kontak_hp = 'Nomor handphone tidak valid. Contoh: 0812xxxxxxx';
  }
  if (d.kategori && !(KATEGORI_WALKIN as string[]).includes(d.kategori)) {
    g.kategori = 'Kategori tidak dikenal';
  }
  const email = d.email.trim();
  if (email && !POLA_EMAIL.test(email)) {
    g.email = 'Format email tidak valid';
  }
  if (d.keperluan.trim().length > BATAS_WALKIN.keperluanMax) {
    g.keperluan = `Keperluan maksimal ${BATAS_WALKIN.keperluanMax} karakter`;
  }
  return g;
}

/** Argumen RPC `fo_mulai_kunjungan` (nama parameter mengikuti kontrak §2.1). */
export interface ParamFoMulai {
  p_nama: string;
  p_asal_instansi: string;
  p_kontak_hp: string | null;
  p_kategori: string | null;
  p_email: string | null;
  p_keperluan: string | null;
  p_layanan_saran_id: string | null;
  p_client_request_id: string;
}

const atauNull = (s: string): string | null => (s.trim() ? s.trim() : null);

export function bangunParamFoMulai(d: DataWalkin, clientRequestId: string): ParamFoMulai {
  return {
    p_nama: d.nama.trim(),
    p_asal_instansi: d.asal_instansi.trim(),
    p_kontak_hp: d.kontak_hp.trim() ? normalisasiHp(d.kontak_hp.trim()) : null,
    p_kategori: atauNull(d.kategori),
    p_email: atauNull(d.email),
    p_keperluan: atauNull(d.keperluan),
    p_layanan_saran_id: atauNull(d.layanan_saran_id),
    p_client_request_id: clientRequestId,
  };
}

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stringAtauNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  return typeof v === 'string' ? v : undefined;
}

/**
 * Memvalidasi payload yang dibaca dari IndexedDB (data bisa rusak/dimanipulasi) dan mengembalikan HANYA
 * kolom yang dikenal (data berlebih dibuang). null bila bentuknya tidak sah.
 */
export function bacaParamTersimpan(payload: unknown): ParamFoMulai | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.p_nama !== 'string' || typeof p.p_asal_instansi !== 'string') return null;
  if (typeof p.p_client_request_id !== 'string' || !POLA_UUID.test(p.p_client_request_id)) return null;
  const hp = stringAtauNull(p.p_kontak_hp);
  const kategori = stringAtauNull(p.p_kategori);
  const email = stringAtauNull(p.p_email);
  const keperluan = stringAtauNull(p.p_keperluan);
  const saran = stringAtauNull(p.p_layanan_saran_id);
  if ([hp, kategori, email, keperluan, saran].some((v) => v === undefined)) return null;
  return {
    p_nama: p.p_nama,
    p_asal_instansi: p.p_asal_instansi,
    p_kontak_hp: hp as string | null,
    p_kategori: kategori as string | null,
    p_email: email as string | null,
    p_keperluan: keperluan as string | null,
    p_layanan_saran_id: saran as string | null,
    p_client_request_id: p.p_client_request_id,
  };
}

export const PESAN_GALAT_FO_MULAI: Record<string, string> = {
  LAYANAN_TUTUP: 'Layanan sudah tutup (pukul 16.00 WIB). Pendaftaran walk-in tidak dapat dilakukan lagi hari ini.',
  DATA_TIDAK_VALID:
    'Data ditolak server. Periksa nama (3–120 karakter), asal/instansi, nomor HP, kategori, dan email.',
  LAYANAN_TIDAK_VALID: 'Layanan saran tidak valid atau sedang tidak aktif. Pilih layanan lain atau kosongkan.',
  NOT_FOUND: 'Data pengunjung terdaftar tidak ditemukan.',
  IDEMPOTENSI_BENTROK: 'Permintaan ini bentrok dengan pendaftaran petugas lain. Muat ulang halaman, lalu coba lagi.',
  FORBIDDEN: 'Akun Anda tidak berwenang mendaftarkan kunjungan walk-in.',
  SESI_TIDAK_SAH: 'Sesi Anda sudah berakhir (mungkin akun ini masuk di perangkat lain). Silakan masuk kembali.',
  RESPON_TIDAK_VALID: 'Balasan server tidak dikenali. Periksa halaman Penanganan sebelum mencoba lagi.',
};
export const PESAN_GALAT_FO_MULAI_UMUM = 'Gagal menyimpan kunjungan. Silakan coba lagi.';
export const PESAN_GALAT_JARINGAN = 'Koneksi bermasalah, periksa jaringan Anda lalu coba lagi.';

export function pesanGalatFoMulai(e: unknown): string {
  if (e instanceof GalatRpc) {
    if (e.jaringan) return PESAN_GALAT_JARINGAN;
    if (e.kode && PESAN_GALAT_FO_MULAI[e.kode]) return PESAN_GALAT_FO_MULAI[e.kode];
  }
  return PESAN_GALAT_FO_MULAI_UMUM;
}

/**
 * Galat PERMANEN: mengulang dengan data yang sama pasti gagal lagi, jadi item antrean offline dibuang
 * (dan FO diberi tahu). Galat lain (jaringan, FORBIDDEN, SESI_TIDAK_SAH, tak dikenal) = boleh diulang.
 */
export function galatFoMulaiPermanen(e: unknown): boolean {
  if (!(e instanceof GalatRpc) || e.jaringan) return false;
  return (
    e.kode === 'LAYANAN_TUTUP' ||
    e.kode === 'DATA_TIDAK_VALID' ||
    e.kode === 'LAYANAN_TIDAK_VALID' ||
    e.kode === 'NOT_FOUND' ||
    e.kode === 'IDEMPOTENSI_BENTROK'
  );
}

export interface HasilFoMulai {
  sudahAda: boolean;
  kunjunganId: string;
  penangananId: string | null;
  qrToken: string | null;
}

/**
 * `rpc fo_mulai_kunjungan`. `sudah_ada: true` (id permintaan yang sama dari staf yang sama) = SUKSES
 * idempoten (kontrak §0.7). Melempar `GalatRpc` pada kegagalan.
 */
export async function panggilFoMulaiKunjungan(
  supabase: Pick<SupabaseClient, 'rpc'>,
  param: ParamFoMulai,
): Promise<HasilFoMulai> {
  let r: Record<string, unknown>;
  try {
    r = await jalankanRpc(supabase.rpc('fo_mulai_kunjungan', param));
  } catch (e) {
    // Kontrak §2.1: dua permintaan serentak dengan id sama, yang kalah bisa menerima 23505; panggil ulang = sudah_ada.
    const kodeSql = e instanceof GalatRpc ? (e.asal as { code?: string } | undefined)?.code : undefined;
    if (kodeSql !== '23505') throw e;
    r = await jalankanRpc(supabase.rpc('fo_mulai_kunjungan', param));
  }
  if (typeof r.kunjungan_id !== 'string') throw new GalatRpc('RESPON_TIDAK_VALID', { asal: r });
  return {
    sudahAda: r.sudah_ada === true,
    kunjunganId: r.kunjungan_id,
    penangananId: typeof r.penanganan_id === 'string' ? r.penanganan_id : null,
    qrToken: typeof r.qr_token === 'string' ? r.qr_token : null,
  };
}
