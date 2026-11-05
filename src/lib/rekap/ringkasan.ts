import type { SupabaseClient } from '@supabase/supabase-js';
import { objekBelumAda } from '@/lib/akses-data/galat';
import type { ArgRekap } from './terpaduServer';

/** Angka agregat DB, bukan baris detail dan bukan hitungan halaman aktif. */
export interface RingkasanDilayani {
  saya: number;
  total: number;
  persen: number;
}

/** null hanya untuk server sebelum 0015. Kegagalan lain tidak boleh menjadi angka nol palsu. */
export async function muatRingkasanDilayani(
  supabase: SupabaseClient, arg: ArgRekap,
): Promise<RingkasanDilayani | null> {
  const { data, error } = await supabase.rpc('rekap_ringkasan_dilayani', {
    ...arg, p_tanpa_form: arg.p_tanpa_form === true,
  });
  if (error) {
    if (objekBelumAda(error)) return null;
    throw error;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Balasan ringkasan dilayani tidak valid');
  }
  const angka = data as Record<string, unknown>;
  for (const field of ['saya', 'total', 'persen']) {
    if ((typeof angka[field] !== 'number' && typeof angka[field] !== 'string') || angka[field] === '') {
      throw new Error('Balasan ringkasan dilayani tidak valid');
    }
  }
  const saya = Number(angka.saya);
  const total = Number(angka.total);
  const persen = Number(angka.persen);
  if (!Number.isSafeInteger(saya) || !Number.isSafeInteger(total) || !Number.isFinite(persen)
      || saya < 0 || total < saya || persen < 0 || persen > 100) {
    throw new Error('Balasan ringkasan dilayani tidak valid');
  }
  return { saya, total, persen };
}
