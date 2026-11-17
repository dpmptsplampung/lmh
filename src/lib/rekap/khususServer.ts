// Jawaban rekap memakai klien pengguna: RPC memeriksa lingkup setiap id dan mengaudit FO lintas pembuat.
// Hak SELECT tabel sensitif tetap mengikuti RLS tabel, terpisah dari izin batch rekap.
import type { SupabaseClient } from '@supabase/supabase-js';
import { objekBelumAda } from '@/lib/akses-data/galat';
import { petaFieldKhusus, type FieldKhusus, type NilaiKhusus } from '@/lib/pendataan-khusus/jenis';

const KOLOM = 'id, layanan_id, label, jenis, wajib, opsi, urut, tersembunyi, pernah_diisi';
/** Id per panggilan RPC (lewat badan permintaan, bukan URL) dan jumlah panggilan serentak. */
export const UKURAN_POTONGAN = 500;
export const PARALEL = 4;

/**
 * Isian Layanan untuk kolom rekap: yang tampil, atau tersembunyi tetapi pernah diisi. Tabel belum ada (migrasi belum
 * diterapkan) = kosong sehingga rekap tetap berjalan; galat lain DILEMPAR agar kolom Khusus tidak hilang diam-diam.
 */
export async function muatFieldKhusus(
  supabase: SupabaseClient, layananId: string | undefined, opsi: { semuaHalaman?: boolean } = {},
): Promise<FieldKhusus[]> {
  if (!layananId) return [];
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ;) {
    let qb = supabase.from('pendataan_khusus_field').select(KOLOM).eq('layanan_id', layananId)
      .order('urut').order('created_at').order('id');
    // Ekspor membaca seluruh definisi, termasuk riwayat isian nonaktif di atas cap PostgREST.
    if (opsi.semuaHalaman) qb = qb.range(offset, offset + UKURAN_POTONGAN - 1);
    const { data, error } = await qb;
    if (error) {
      if (objekBelumAda(error)) return [];
      throw error;
    }
    const halaman = (data ?? []) as Record<string, unknown>[];
    rows.push(...halaman);
    if (!opsi.semuaHalaman || !halaman.length) break;
    offset += halaman.length;
  }
  return rows.map(petaFieldKhusus).filter((f) => !f.tersembunyi || f.pernah_diisi);
}

/**
 * Jawaban per pelayanan_id (= penanganan.id). RPC menolak batch yang berisi id di luar lingkup.
 * Semua galat, termasuk migrasi belum tersedia, dilempar agar ekspor tidak kehilangan data diam-diam.
 */
export async function muatJawabanKhusus(
  supabase: SupabaseClient,
  pelayananIds: string[],
): Promise<Map<string, Record<string, NilaiKhusus>>> {
  const hasil = new Map<string, Record<string, NilaiKhusus>>();
  const potongan: string[][] = [];
  for (let i = 0; i < pelayananIds.length; i += UKURAN_POTONGAN) potongan.push(pelayananIds.slice(i, i + UKURAN_POTONGAN));
  for (let i = 0; i < potongan.length; i += PARALEL) {
    const kelompok = await Promise.all(
      potongan.slice(i, i + PARALEL).map(async (ids) => {
        const { data, error } = await supabase.rpc('rekap_khusus_peta', { p_penanganan: ids });
        if (error) throw error;
        return (data ?? {}) as Record<string, Record<string, NilaiKhusus>>;
      }),
    );
    for (const peta of kelompok) {
      for (const [id, isian] of Object.entries(peta)) hasil.set(id, isian);
    }
  }
  return hasil;
}
