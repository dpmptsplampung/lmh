// Nama Front Office per tiket untuk tab rekap yang bersumber dari view (OSS / Non OSS) dan ekspornya.
// View v_rekap_pelayanan_* tidak memuat penanganan, sehingga FO diambil dari tahap 'fo' pada kunjungan tiket itu
// (tabel penanganan lewat tiket_antrean.kunjungan_id). Modul ini bekerja dengan klien Supabase mana pun (browser atau
// server) dan TIDAK PERNAH melempar: gagal/RLS membatasi -> tiket tanpa nama (UI menampilkan '—'), rekap tetap jalan.
import type { SupabaseClient } from '@supabase/supabase-js';
import { namaFoSebelum } from './penanganan';

const UKURAN_CHUNK = 100;

export async function muatNamaFoPerTiket(
  supabase: SupabaseClient,
  tiketIds: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const hasil = new Map<string, string>();
  const ids = [...new Set(tiketIds.filter((x): x is string => !!x))];
  for (let i = 0; i < ids.length; i += UKURAN_CHUNK) {
    const potongan = ids.slice(i, i + UKURAN_CHUNK);
    try {
      const { data, error } = await supabase
        .from('tiket_antrean')
        .select(
          'id, kunjungan:kunjungan_id(tahap_fo:penanganan!kunjungan_id(tahap_ke, peran_tahap, penangan_id, petugas:penangan_id(nama)))',
        )
        .in('id', potongan);
      if (error) {
        console.error('[rekap/foTiket] gagal memuat FO per tiket:', error);
        continue;
      }
      for (const t of (data ?? []) as unknown as { id: string; kunjungan?: unknown }[]) {
        const k = Array.isArray(t.kunjungan) ? t.kunjungan[0] : t.kunjungan;
        const nama = namaFoSebelum((k as { tahap_fo?: unknown } | null | undefined)?.tahap_fo, Infinity);
        if (nama) hasil.set(t.id, nama);
      }
    } catch (e) {
      console.error('[rekap/foTiket] gagal memuat FO per tiket:', e);
    }
  }
  return hasil;
}

/** Tambahkan `fo_nama` (null bila tak diketahui) ke baris view yang punya `tiket_id`. */
export async function tambahNamaFo<T extends { tiket_id?: string | null }>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<(T & { fo_nama: string | null })[]> {
  const peta = await muatNamaFoPerTiket(supabase, rows.map((r) => r.tiket_id));
  return rows.map((r) => ({ ...r, fo_nama: (r.tiket_id && peta.get(r.tiket_id)) || null }));
}
