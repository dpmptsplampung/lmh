import { asSingle, type RekapTicketRow } from './excel';

// PostgREST mengembalikan embed to-one sebagai objek, tetapi versi/edge-case
// tertentu bisa array. Normalisasi di satu tempat agar route tidak duplikat.
function asRowEmbed<T>(v: unknown): T | null {
  return asSingle(v as T | T[] | null | undefined);
}

export function mapRawTicketRow(r: Record<string, unknown>): RekapTicketRow {
  const oss = asRowEmbed<RekapTicketRow['pelayanan_oss']>(r.pelayanan_oss);
  const per = asRowEmbed<RekapTicketRow['pelayanan_perizinan']>(r.pelayanan_perizinan);
  const form_type: RekapTicketRow['form_type'] = oss ? 'oss' : per ? 'perizinan' : null;
  return {
    id: r.id as string,
    nomor_display: r.nomor_display as string,
    tanggal: r.tanggal as string,
    waktu_terbit: r.waktu_terbit as string,
    waktu_mulai_layan: (r.waktu_mulai_layan as string | null) ?? null,
    waktu_selesai: (r.waktu_selesai as string | null) ?? null,
    status: r.status as string,
    kunjungan: asRowEmbed<RekapTicketRow['kunjungan']>(r.kunjungan),
    petugas: asRowEmbed<RekapTicketRow['petugas']>(r.petugas),
    form_type,
    pelayanan_oss: oss,
    pelayanan_perizinan: per,
  };
}
