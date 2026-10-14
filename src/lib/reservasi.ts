// Reservasi pengunjung (UI-2): parameter RPC, pemetaan galat, label status, dan bacaan §6.6 kontrak
// (docs/analysis/FO-ESKALASI-KONTRAK-RPC.md). Reservasi kini baris `kunjungan` (asal='reservasi'), BUKAN `visit`.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TujuanReservasi } from '@/lib/constants';
import { GalatRpc, jalankanRpc } from '@/lib/rpc-galat';

export const PESAN_GALAT_RESERVASI_BUAT: Record<string, string> = {
  FORBIDDEN: 'Akun Anda belum memiliki profil pengunjung. Lengkapi profil terlebih dahulu, lalu coba lagi.',
  SESI_TIDAK_SAH: 'Sesi Anda sudah berakhir. Silakan masuk kembali.',
  DATA_TIDAK_VALID:
    'Data reservasi ditolak server. Periksa tujuan, nama yang ditemui (3–120 karakter), dan keperluan (maksimal 500 karakter).',
  TANGGAL_TIDAK_VALID:
    'Tanggal tidak valid. Pilih hari kerja (Senin–Jumat) mulai hari ini sampai 7 hari ke depan.',
  LAYANAN_TIDAK_VALID: 'Layanan yang dipilih tidak valid atau sedang tidak aktif.',
  LAYANAN_TIDAK_BUKA:
    'Layanan ini tidak beroperasi pada tanggal itu. Pilih tanggal lain, atau tanya lewat live chat.',
  RESERVASI_GANDA:
    'Anda sudah memiliki reservasi yang sama pada tanggal itu. Periksa daftar Reservasi Saya di bawah.',
  KUOTA_PENUH: 'Kuota layanan pada tanggal itu sudah penuh. Pilih tanggal lain.',
};
export const PESAN_GALAT_RESERVASI_UMUM = 'Gagal membuat reservasi. Silakan coba lagi.';
export const PESAN_JARINGAN_RESERVASI = 'Koneksi bermasalah, periksa jaringan Anda lalu coba lagi.';

export const PESAN_GALAT_RESERVASI_BATAL: Record<string, string> = {
  FORBIDDEN: 'Anda tidak berwenang membatalkan reservasi ini.',
  SESI_TIDAK_SAH: 'Sesi Anda sudah berakhir. Silakan masuk kembali.',
  NOT_FOUND: 'Reservasi tidak ditemukan.',
  INVALID_STATUS: 'Reservasi ini sudah tidak dapat dibatalkan (sudah check-in, batal, atau selesai).',
};
export const PESAN_GALAT_BATAL_UMUM = 'Gagal membatalkan reservasi. Silakan coba lagi.';

function pesanDari(e: unknown, peta: Record<string, string>, umum: string): string {
  if (e instanceof GalatRpc) {
    if (e.jaringan) return PESAN_JARINGAN_RESERVASI;
    if (e.kode && peta[e.kode]) return peta[e.kode];
  }
  return umum;
}

export const pesanGalatReservasiBuat = (e: unknown) =>
  pesanDari(e, PESAN_GALAT_RESERVASI_BUAT, PESAN_GALAT_RESERVASI_UMUM);
export const pesanGalatReservasiBatal = (e: unknown) =>
  pesanDari(e, PESAN_GALAT_RESERVASI_BATAL, PESAN_GALAT_BATAL_UMUM);

export interface InputReservasi {
  tujuan: TujuanReservasi;
  layananId: string;
  namaYangDitemui: string;
  tanggal: string;
  jamRencana: string;
  keperluan: string;
}

/** Argumen RPC `reservasi_buat` (§4.1). Layanan hanya untuk `loket`; nama yang ditemui hanya untuk `bertemu_seseorang`. */
export function bangunParamReservasiBuat(i: InputReservasi) {
  return {
    p_tujuan: i.tujuan,
    p_tanggal: i.tanggal,
    p_layanan_id: i.tujuan === 'loket' ? i.layananId : null,
    p_nama_yang_ditemui: i.tujuan === 'bertemu_seseorang' ? i.namaYangDitemui.trim() : null,
    p_keperluan: i.keperluan.trim() || null,
    p_jam_rencana: i.jamRencana || null,
  };
}

export interface HasilReservasiBuat {
  kunjunganId: string;
  qrToken: string;
  tanggal: string;
}

export async function panggilReservasiBuat(
  supabase: Pick<SupabaseClient, 'rpc'>,
  input: InputReservasi,
): Promise<HasilReservasiBuat> {
  const r = await jalankanRpc(supabase.rpc('reservasi_buat', bangunParamReservasiBuat(input)));
  if (typeof r.qr_token !== 'string' || typeof r.kunjungan_id !== 'string') {
    throw new GalatRpc('RESPON_TIDAK_VALID', { asal: r });
  }
  return {
    kunjunganId: r.kunjungan_id,
    qrToken: r.qr_token,
    tanggal: typeof r.tanggal === 'string' ? r.tanggal : input.tanggal,
  };
}

/** `reservasi_batalkan`; melempar `GalatRpc`. */
export async function panggilReservasiBatalkan(
  supabase: Pick<SupabaseClient, 'rpc'>,
  kunjunganId: string,
): Promise<void> {
  await jalankanRpc(supabase.rpc('reservasi_batalkan', { p_kunjungan_id: kunjunganId }));
}

/** Baris reservasi pengunjung dari tabel `kunjungan` (§6.6). */
export interface ReservasiKunjungan {
  id: string;
  tanggal: string;
  status: string;
  qr_token: string;
  tujuan: string | null;
  layanan_saran_id: string | null;
  jam_rencana: string | null;
  nama_yang_ditemui: string | null;
}

export const KOLOM_RESERVASI =
  'id, tanggal, status, qr_token, tujuan, layanan_saran_id, jam_rencana, nama_yang_ditemui';

export const STATUS_RESERVASI_LABEL: Record<string, { label: string; className: string }> = {
  terjadwal: { label: 'Terjadwal', className: 'badge--menunggu' },
  menunggu: { label: 'Menunggu', className: 'badge--aktif' },
  dilayani: { label: 'Sedang Dilayani', className: 'badge--published' },
  selesai: { label: 'Selesai', className: 'badge--selesai' },
  batal: { label: 'Dibatalkan', className: 'badge--nonaktif' },
  no_show: { label: 'Hangus — Tidak Hadir', className: 'badge--nonaktif' },
  tidak_terlayani: { label: 'Tidak Terlayani', className: 'badge--nonaktif' },
};

export function labelStatusReservasi(status: string): { label: string; className: string } {
  return STATUS_RESERVASI_LABEL[status] ?? { label: status, className: 'badge--draft' };
}
