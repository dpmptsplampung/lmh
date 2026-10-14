import { asSingle, type RekapTicketRow } from './excel';
import { namaFoSebelum } from './penanganan';

// PostgREST mengembalikan embed to-one sebagai objek, tetapi versi/edge-case
// tertentu bisa array. Normalisasi di satu tempat agar route tidak duplikat.
function asRowEmbed<T>(v: unknown): T | null {
  return asSingle(v as T | T[] | null | undefined);
}

export function mapRawTicketRow(r: Record<string, unknown>): RekapTicketRow {
  const oss = asRowEmbed<RekapTicketRow['pelayanan_oss']>(r.pelayanan_oss);
  const per = asRowEmbed<RekapTicketRow['pelayanan_perizinan']>(r.pelayanan_perizinan);
  const form_type: RekapTicketRow['form_type'] = oss ? 'oss' : per ? 'perizinan' : null;
  const kunjunganRaw = asRowEmbed<Record<string, unknown>>(r.kunjungan);
  return {
    id: r.id as string,
    nomor_display: r.nomor_display as string,
    tanggal: r.tanggal as string,
    waktu_terbit: r.waktu_terbit as string,
    waktu_mulai_layan: (r.waktu_mulai_layan as string | null) ?? null,
    waktu_selesai: (r.waktu_selesai as string | null) ?? null,
    status: r.status as string,
    kunjungan: kunjunganRaw
      ? {
          nama: kunjunganRaw.nama as string,
          asal: kunjunganRaw.asal as string,
          qr_token: (kunjunganRaw.qr_token as string | null | undefined) ?? null,
        }
      : null,
    // FO yang melayani/mengeskalasi = tahap FO terakhir pada kunjungan tiket ini; tiket lama tanpa tahap FO -> null.
    fo_nama: namaFoSebelum(kunjunganRaw?.tahap_fo, Infinity),
    petugas: asRowEmbed<RekapTicketRow['petugas']>(r.petugas),
    form_type,
    pelayanan_oss: oss,
    pelayanan_perizinan: per,
  };
}
