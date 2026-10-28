// Sisi staf "Pesan Perilaku" (survei terpadu): QR untuk pengunjung dan lencana status di daftar staf.
// Membungkus RPC `ambil_qr_survei` dan view `v_survei_status` (migrasi 202611020001; keduanya dijaga boleh_kunjungan
// terhadap pemanggil). Modul murni: tidak menyentuh DOM atau env. Token HANYA dipakai untuk membentuk nilai QR dan
// tidak pernah ditampilkan sebagai teks.
import type { SupabaseClient } from '@supabase/supabase-js';

export type StatusSurvei = 'belum_diisi' | 'sudah_diisi' | 'kedaluwarsa' | 'tidak_ada';

export const LABEL_STATUS_SURVEI: Record<StatusSurvei, string> = {
  belum_diisi: 'Belum diisi',
  sudah_diisi: 'Sudah diisi',
  kedaluwarsa: 'Kedaluwarsa',
  tidak_ada: '—',
};

const STATUS_DIKENAL = Object.keys(LABEL_STATUS_SURVEI) as StatusSurvei[];

/** Batas id per `in()` agar URL kueri PostgREST tidak melewati batas panjang. */
const UKURAN_POTONGAN = 200;

const adalahStatus = (nilai: unknown): nilai is StatusSurvei =>
  typeof nilai === 'string' && STATUS_DIKENAL.includes(nilai as StatusSurvei);

function adalahObjek(nilai: unknown): nilai is Record<string, unknown> {
  return typeof nilai === 'object' && nilai !== null && !Array.isArray(nilai);
}

const teksAtauNull = (nilai: unknown): string | null => (typeof nilai === 'string' && nilai !== '' ? nilai : null);

export function urlSurvei(origin: string, token: string): string {
  return `${origin}/survei/${token}`;
}

export type QrSurvei = {
  status: StatusSurvei;
  /** Terisi hanya bila status `belum_diisi`. */
  token: string | null;
  kedaluwarsaPada: string | null;
  layananNama: string | null;
};

/**
 * Mengambil status + token undangan satu kunjungan. Galat RPC (supabase-js tidak melempar, jadi `{ error }` diubah
 * menjadi lemparan) dan bentuk hasil yang tidak dikenal MELEMPAR; pesan teknis server tidak diteruskan.
 */
export async function ambilQrSurvei(supabase: Pick<SupabaseClient, 'rpc'>, kunjunganId: string): Promise<QrSurvei> {
  const { data, error } = await supabase.rpc('ambil_qr_survei', { p_kunjungan_id: kunjunganId });
  if (error) throw new Error('Gagal memuat QR Pesan Perilaku');
  if (!adalahObjek(data) || !adalahStatus(data.status)) throw new Error('Bentuk QR Pesan Perilaku tidak dikenal');

  return {
    status: data.status,
    // Pertahanan berlapis: token dipakai hanya untuk undangan yang masih bisa diisi, apa pun isi kolom token.
    token: data.status === 'belum_diisi' ? teksAtauNull(data.token) : null,
    kedaluwarsaPada: teksAtauNull(data.kedaluwarsa_pada),
    layananNama: teksAtauNull(data.layanan_nama),
  };
}

/**
 * Status Pesan Perilaku untuk banyak kunjungan sekaligus (lencana di daftar staf). Id tanpa baris di view
 * (belum ada undangan) dipetakan ke `tidak_ada`. `in()` dipecah per 200 id. Galat kueri MELEMPAR: pemanggil memutuskan
 * (lencana tidak boleh diam-diam berbohong dengan "—").
 */
export async function ambilStatusSurvei(
  supabase: Pick<SupabaseClient, 'from'>,
  kunjunganIds: string[],
): Promise<Map<string, StatusSurvei>> {
  const unik = Array.from(new Set(kunjunganIds));
  const hasil = new Map<string, StatusSurvei>(unik.map((id) => [id, 'tidak_ada']));

  const potongan: string[][] = [];
  for (let i = 0; i < unik.length; i += UKURAN_POTONGAN) potongan.push(unik.slice(i, i + UKURAN_POTONGAN));

  const balasan = await Promise.all(
    potongan.map((ids) => supabase.from('v_survei_status').select('kunjungan_id, status').in('kunjungan_id', ids)),
  );
  for (const { data, error } of balasan) {
    if (error) throw new Error('Gagal memuat status Pesan Perilaku');
    for (const baris of (data ?? []) as Array<{ kunjungan_id: string; status: unknown }>) {
      if (adalahStatus(baris.status)) hasil.set(baris.kunjungan_id, baris.status);
    }
  }
  return hasil;
}
