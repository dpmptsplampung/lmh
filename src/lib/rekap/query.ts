import type { SupabaseClient } from '@supabase/supabase-js';

export function escapeIlikeWildcards(s: string): string {
  return s.replace(/[%_]/g, '\\$&');
}

interface TicketsQueryParams {
  layananId: string | null;
  q: string;
  dari: string;
  sampai: string;
  from: number;
  to: number;
}

export function buildTicketsQuery(
  supabase: SupabaseClient,
  params: TicketsQueryParams,
) {
  let query = supabase
    .from('tiket_antrean')
    .select(
      `
      id, nomor_display, tanggal, status,
      waktu_terbit, waktu_mulai_layan, waktu_selesai,
      kunjungan:kunjungan_id(nama, asal, qr_token),
      petugas:dilayani_oleh(nama),
      pelayanan_oss:tiket_id(*),
      pelayanan_perizinan:tiket_id(*)
    `,
      { count: 'exact' },
    )
    .eq('status', 'selesai')
    .gte('tanggal', params.dari)
    .lte('tanggal', params.sampai)
    .order('waktu_selesai', { ascending: false })
    .range(params.from, params.to);

  if (params.layananId) {
    query = query.eq('layanan_id', params.layananId);
  }

  const q = params.q.trim();
  if (q) {
    const escaped = escapeIlikeWildcards(q);
    query = query.or(
      [
        `nomor_display.ilike.%${escaped}%`,
        `kunjungan.nama.ilike.%${escaped}%`,
        `pelayanan_oss.nama_pemohon.ilike.%${escaped}%`,
        `pelayanan_oss.nama_usaha.ilike.%${escaped}%`,
        `pelayanan_perizinan.nama_pemohon.ilike.%${escaped}%`,
        `pelayanan_perizinan.nama_perusahaan.ilike.%${escaped}%`,
        `petugas.nama.ilike.%${escaped}%`,
      ].join(','),
    );
  }

  return query;
}
