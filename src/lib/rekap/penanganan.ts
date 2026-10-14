// Rekap penanganan (Tahap D): tahap FO dan tahap petugas layanan per hari WIB.
// Sumber: tabel `penanganan` (kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §1.5, §6). Modul ini murni (tanpa
// React/ExcelJS) agar aman dipakai route handler maupun komponen klien (hanya `import type` dari excel.ts).
//
// Hari sebuah tahap = tanggal WIB dari `mulai_at` (jam server). Tahap berstatus `menunggu` belum punya mulai_at
// sehingga tidak masuk rekap; tahap `batal` yang pernah mulai (diambil alih/dialihkan) masuk dengan label alasannya.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RekapPelayananOss, RekapPelayananPerizin } from './excel';
import {
  LABEL_HASIL_PENANGANAN,
  awalHariBerikutnyaWIB,
  awalHariWIB,
  hariWIB,
  selisihMenit,
} from './format';

export type PeranTahap = 'fo' | 'layanan';

export interface RekapPenangananRow {
  id: string;
  kunjungan_id: string;
  tahap_ke: number;
  peran_tahap: PeranTahap;
  layanan_id: string | null;
  layanan_nama: string | null;
  saluran: string;
  penangan_id: string | null;
  penangan_nama: string | null;
  status: string;
  hasil: string | null;
  topik: string | null;
  catatan: string | null;
  batal_karena: string | null;
  mulai_at: string | null;
  selesai_at: string | null;
  created_at: string;
  /** Tanggal WIB dari mulai_at ('' bila belum mulai). */
  tanggal: string;
  /** Mulai -> selesai dalam menit (tanpa pembulatan); null bila tahap belum ditutup. */
  durasi_menit: number | null;
  pengunjung_nama: string | null;
  pengunjung_instansi: string | null;
  tiket: {
    nomor_display: string;
    tanggal: string;
    status: string;
    form_type: 'oss' | 'perizinan' | null;
    pelayanan_oss: RekapPelayananOss | null;
    pelayanan_perizinan: RekapPelayananPerizin | null;
  } | null;
}

// Embed memakai nama kolom FK sebagai petunjuk (penanganan punya dua FK ke petugas: penangan_id dan dibuat_oleh).
const SELECT_DASAR = `
  id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, penangan_id, status, hasil, topik, catatan,
  batal_karena, mulai_at, selesai_at, created_at,
  kunjungan:kunjungan_id(nama, asal_instansi),
  petugas:penangan_id(nama),
  layanan:layanan_id(nama)
`;
const SELECT_LAYANAN = `${SELECT_DASAR},
  tiket:tiket_id(nomor_display, tanggal, status, pelayanan_oss(*), pelayanan_perizinan(*))
`;

export interface PenangananQueryParams {
  peran: PeranTahap;
  dari: string;
  sampai: string;
  /** Batasi ke satu penangan (FO sendiri / filter Admin). */
  penanganId: string | null;
  /** Batasi ke satu layanan (peran 'layanan'). */
  layananId: string | null;
  from: number;
  to: number;
}

/**
 * Kueri satu halaman. Batas waktu: mulai_at >= 00:00 WIB `dari` dan < 00:00 WIB hari setelah `sampai`
 * (23:59 WIB masih hari itu, 00:00 WIB hari berikutnya). Urutan (mulai_at, id) deterministik untuk paginasi.
 */
export function buildPenangananQuery(supabase: SupabaseClient, p: PenangananQueryParams) {
  let query = supabase
    .from('penanganan')
    .select(p.peran === 'layanan' ? SELECT_LAYANAN : SELECT_DASAR)
    .eq('peran_tahap', p.peran)
    .gte('mulai_at', awalHariWIB(p.dari))
    .lt('mulai_at', awalHariBerikutnyaWIB(p.sampai));
  if (p.penanganId) query = query.eq('penangan_id', p.penanganId);
  if (p.layananId) query = query.eq('layanan_id', p.layananId);
  return query
    .order('mulai_at', { ascending: true })
    .order('id', { ascending: true })
    .range(p.from, p.to);
}

function satu<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] as T | undefined) ?? null;
  return (v as T | null | undefined) ?? null;
}

export function mapRawPenangananRow(r: Record<string, unknown>): RekapPenangananRow {
  const kunjungan = satu<{ nama?: string; asal_instansi?: string | null }>(r.kunjungan);
  const petugas = satu<{ nama?: string }>(r.petugas);
  const layanan = satu<{ nama?: string }>(r.layanan);
  const tiketRaw = satu<Record<string, unknown>>(r.tiket);
  let tiket: RekapPenangananRow['tiket'] = null;
  if (tiketRaw) {
    const oss = satu<RekapPelayananOss>(tiketRaw.pelayanan_oss);
    const per = satu<RekapPelayananPerizin>(tiketRaw.pelayanan_perizinan);
    tiket = {
      nomor_display: String(tiketRaw.nomor_display ?? ''),
      tanggal: String(tiketRaw.tanggal ?? ''),
      status: String(tiketRaw.status ?? ''),
      form_type: oss ? 'oss' : per ? 'perizinan' : null,
      pelayanan_oss: oss,
      pelayanan_perizinan: per,
    };
  }
  const mulai = (r.mulai_at as string | null) ?? null;
  const selesai = (r.selesai_at as string | null) ?? null;
  return {
    id: r.id as string,
    kunjungan_id: r.kunjungan_id as string,
    tahap_ke: Number(r.tahap_ke),
    peran_tahap: r.peran_tahap as PeranTahap,
    layanan_id: (r.layanan_id as string | null) ?? null,
    layanan_nama: layanan?.nama ?? null,
    saluran: r.saluran as string,
    penangan_id: (r.penangan_id as string | null) ?? null,
    penangan_nama: petugas?.nama ?? null,
    status: r.status as string,
    hasil: (r.hasil as string | null) ?? null,
    topik: (r.topik as string | null) ?? null,
    catatan: (r.catatan as string | null) ?? null,
    batal_karena: (r.batal_karena as string | null) ?? null,
    mulai_at: mulai,
    selesai_at: selesai,
    created_at: r.created_at as string,
    tanggal: mulai ? hariWIB(mulai) : '',
    durasi_menit: selesai ? selisihMenit(mulai, selesai) : null,
    pengunjung_nama: kunjungan?.nama ?? null,
    pengunjung_instansi: kunjungan?.asal_instansi ?? null,
    tiket,
  };
}

// ---------------------------------------------------------------------------
// Hak akses
// ---------------------------------------------------------------------------

export interface StafRekap {
  id: string;
  role: string;
  layanan_id: string | null;
}

export type CakupanPenanganan =
  | { ok: true; penanganId: string | null; layananId: string | null }
  | { ok: false; status: 403; error: string };

/**
 * Cakupan data yang boleh dibaca. Dipaksa di server (bukan hanya RLS: RLS Front Office juga memuat tahap lain
 * dari kunjungan yang pernah ia sentuh, sehingga filter eksplisit tetap wajib).
 *  - peran 'fo': Admin semua (boleh filter FO); Front Office HANYA miliknya (filter FO lain = 403); Petugas ditolak.
 *  - peran 'layanan': Admin semua; Petugas hanya layanannya (layanan lain / tanpa layanan = 403);
 *    Front Office ditolak (spec K9 hanya menyebut Admin dan Petugas; RLS pun hanya memberi FO sebagian tahap).
 */
export function tentukanCakupan(
  me: StafRekap,
  q: { peran: PeranTahap; petugas_id?: string; layanan_id?: string },
): CakupanPenanganan {
  const tolak = (error: string): CakupanPenanganan => ({ ok: false, status: 403, error });
  if (q.peran === 'fo') {
    if (me.role === 'admin') return { ok: true, penanganId: q.petugas_id ?? null, layananId: null };
    if (me.role === 'front_office') {
      if (q.petugas_id && q.petugas_id !== me.id) return tolak('Forbidden');
      return { ok: true, penanganId: me.id, layananId: null };
    }
    return tolak('Forbidden');
  }
  if (me.role === 'admin') {
    return { ok: true, penanganId: q.petugas_id ?? null, layananId: q.layanan_id ?? null };
  }
  if (me.role === 'petugas') {
    if (!me.layanan_id) return tolak('Forbidden');
    if (q.layanan_id && q.layanan_id !== me.layanan_id) return tolak('Forbidden');
    return { ok: true, penanganId: q.petugas_id ?? null, layananId: me.layanan_id };
  }
  return tolak('Forbidden');
}

// ---------------------------------------------------------------------------
// Ringkasan
// ---------------------------------------------------------------------------

export type KunciHasil = 'selesai' | 'dieskalasi' | 'dikembalikan' | 'belum_ditutup' | 'batal';

export const URUTAN_HASIL: KunciHasil[] = ['selesai', 'dieskalasi', 'dikembalikan', 'belum_ditutup', 'batal'];

export const LABEL_KUNCI_HASIL: Record<KunciHasil, string> = {
  selesai: LABEL_HASIL_PENANGANAN.selesai,
  dieskalasi: LABEL_HASIL_PENANGANAN.dieskalasi,
  dikembalikan: LABEL_HASIL_PENANGANAN.dikembalikan,
  belum_ditutup: 'Belum ditutup',
  batal: 'Dibatalkan',
};

export function kunciHasil(r: Pick<RekapPenangananRow, 'status' | 'hasil'>): KunciHasil {
  if (r.status === 'selesai' && (r.hasil === 'selesai' || r.hasil === 'dieskalasi' || r.hasil === 'dikembalikan')) {
    return r.hasil;
  }
  if (r.status === 'batal') return 'batal';
  return 'belum_ditutup';
}

export interface RingkasanPenangananHari {
  tanggal: string;
  penangan_id: string | null;
  nama: string;
  total: number;
  selesai: number;
  dieskalasi: number;
  dikembalikan: number;
  belum_ditutup: number;
  batal: number;
  rata_durasi_menit: number | null;
}

export interface RingkasanPenanganan {
  total: number;
  per_hasil: { kunci: KunciHasil; label: string; jumlah: number }[];
  per_topik: { topik: string; jumlah: number }[];
  per_penangan_hari: RingkasanPenangananHari[];
}

export const TANPA_TOPIK = '(tanpa topik)';
export const TANPA_NAMA = '(tanpa nama)';

export function ringkasPenanganan(rows: RekapPenangananRow[]): RingkasanPenanganan {
  const hasil = new Map<KunciHasil, number>(URUTAN_HASIL.map((k) => [k, 0]));
  const topik = new Map<string, number>();
  const hari = new Map<string, RingkasanPenangananHari & { _durasi: number; _n: number }>();

  for (const r of rows) {
    const k = kunciHasil(r);
    hasil.set(k, (hasil.get(k) ?? 0) + 1);
    if (r.status === 'selesai') {
      const t = r.topik?.trim() || TANPA_TOPIK;
      topik.set(t, (topik.get(t) ?? 0) + 1);
    }
    const kunci = `${r.tanggal}|${r.penangan_id ?? ''}`;
    let g = hari.get(kunci);
    if (!g) {
      g = {
        tanggal: r.tanggal,
        penangan_id: r.penangan_id,
        nama: r.penangan_nama ?? TANPA_NAMA,
        total: 0, selesai: 0, dieskalasi: 0, dikembalikan: 0, belum_ditutup: 0, batal: 0,
        rata_durasi_menit: null,
        _durasi: 0, _n: 0,
      };
      hari.set(kunci, g);
    }
    g.total += 1;
    g[k] += 1;
    if (r.durasi_menit != null) {
      g._durasi += r.durasi_menit;
      g._n += 1;
    }
  }

  const per_penangan_hari = [...hari.values()]
    .map((g) => {
      const { _durasi, _n, ...sisa } = g;
      return { ...sisa, rata_durasi_menit: _n > 0 ? _durasi / _n : null };
    })
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.nama.localeCompare(b.nama));

  return {
    total: rows.length,
    per_hasil: URUTAN_HASIL.map((kunci) => ({ kunci, label: LABEL_KUNCI_HASIL[kunci], jumlah: hasil.get(kunci) ?? 0 })),
    per_topik: [...topik.entries()]
      .map(([t, jumlah]) => ({ topik: t, jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah || a.topik.localeCompare(b.topik)),
    per_penangan_hari,
  };
}
