// Bagian server Pendataan Khusus untuk rekap terpadu (Fase 4): definisi isian Layanan terpilih + jawaban baris halaman.
// SELALU klien pengguna (bukan service-role): fungsi `pendataan_khusus_peta` berjalan SECURITY INVOKER sehingga RLS
// pendataan_khusus_jawaban (boleh_baca_khusus = boleh_data_pelayanan, lingkup data KETAT Fase 3) tetap berlaku: jawaban
// hanya kembali untuk pelayanan dalam lingkup pemanggil.
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
export async function muatFieldKhusus(supabase: SupabaseClient, layananId: string | undefined): Promise<FieldKhusus[]> {
  if (!layananId) return [];
  const { data, error } = await supabase
    .from('pendataan_khusus_field')
    .select(KOLOM)
    .eq('layanan_id', layananId)
    .order('urut')
    .order('created_at');
  if (error) {
    if (objekBelumAda(error)) return [];
    throw error;
  }
  return ((data ?? []) as Record<string, unknown>[]).map(petaFieldKhusus).filter((f) => !f.tersembunyi || f.pernah_diisi);
}

/**
 * Jawaban per pelayanan_id (= penanganan.id). Hanya pelayanan dalam lingkup pemanggil yang kembali (RLS). Fungsi belum
 * ada = kosong; galat lain dilempar agar ekspor tidak diam-diam kehilangan data.
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
        const { data, error } = await supabase.rpc('pendataan_khusus_peta', { p_penanganan: ids });
        if (error) {
          if (objekBelumAda(error)) return null;
          throw error;
        }
        return (data ?? {}) as Record<string, Record<string, NilaiKhusus>>;
      }),
    );
    for (const peta of kelompok) {
      if (!peta) continue;
      for (const [id, isian] of Object.entries(peta)) hasil.set(id, isian);
    }
  }
  return hasil;
}
