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
  /**
   * Nama Front Office yang melayani: peran 'fo' = penangan tahap itu; peran 'layanan' = FO tahap 'fo' terakhir sebelum
   * tahap ini pada kunjungan yang sama (null bila tidak ada, mis. chat diambil langsung petugas).
   */
  fo_nama: string | null;
  /** ID petugas FO di balik fo_nama (dasar filter "Front Office yang mengeskalasi"); null bila FO tidak diketahui. */
  fo_id: string | null;
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
  /**
   * Email pengunjung untuk rekap: email Pendataan petugas layanan (pelayanan_oss/perizinan tiket tahap ini, lalu
   * Pendataan lain pada kunjungan yang sama = tiket hasil eskalasi) bila ada; selain itu email kunjungan (walk-in FO,
   * boleh kosong sejak 202610140015). null bila tidak ada.
   */
  email: string | null;
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
// `tahap_fo` = semua tahap kunjungan yang sama (penanganan!kunjungan_id) beserta nama penangannya; dipakai untuk kolom
// "Front Office" (FO yang melayani) pada rekap petugas layanan. Hanya tahap 'fo' yang dipakai (disaring di mapRawPenangananRow).
// Email kunjungan + email Pendataan pada kunjungan itu (tiket hasil eskalasi); lihat emailRekap.
const SELECT_KUNJUNGAN_EMAIL =
  'nama, asal_instansi, email, pelayanan_oss(email, updated_at), pelayanan_perizinan(email, updated_at)';
const SELECT_DASAR = `
  id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, penangan_id, status, hasil, topik, catatan,
  batal_karena, mulai_at, selesai_at, created_at,
  kunjungan:kunjungan_id(${SELECT_KUNJUNGAN_EMAIL}),
  petugas:penangan_id(nama),
  layanan:layanan_id(nama)
`;
const SELECT_TIKET = `tiket:tiket_id(nomor_display, tanggal, status, pelayanan_oss(*), pelayanan_perizinan(*))`;
const SELECT_LAYANAN = `
  id, kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, penangan_id, status, hasil, topik, catatan,
  batal_karena, mulai_at, selesai_at, created_at,
  kunjungan:kunjungan_id(${SELECT_KUNJUNGAN_EMAIL}, tahap_fo:penanganan!kunjungan_id(tahap_ke, peran_tahap, penangan_id, petugas:penangan_id(nama))),
  petugas:penangan_id(nama),
  layanan:layanan_id(nama),
  ${SELECT_TIKET}
`;

export interface PenangananQueryParams {
  peran: PeranTahap;
  dari: string;
  sampai: string;
  /** Batasi ke satu penangan (filter opsional Admin / Front Office). */
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

interface TahapFoEmbed {
  tahap_ke?: number | string | null;
  peran_tahap?: string | null;
  penangan_id?: string | null;
  petugas?: { nama?: string } | { nama?: string }[] | null;
}

/**
 * Front Office yang melayani kunjungan sebelum tahap ini: tahap 'fo' ber-penangan dengan tahap_ke terbesar yang
 * lebih kecil dari tahap ini (FO yang mengeskalasi / meneruskan; bila pengunjung dikembalikan lalu diambil FO lain,
 * FO terakhir sebelum tahap ini). Tanpa tahap FO sebelumnya (mis. chat diambil langsung petugas) -> null.
 * `tahapKe = Infinity` berarti "FO terakhir pada kunjungan" (dipakai rekap per tiket).
 */
export function foSebelum(tahapKunjungan: unknown, tahapKe: number): { id: string; nama: string } | null {
  const daftar = (Array.isArray(tahapKunjungan) ? tahapKunjungan : tahapKunjungan ? [tahapKunjungan] : []) as TahapFoEmbed[];
  let terpilih: { ke: number; id: string; nama: string } | null = null;
  for (const t of daftar) {
    if (t?.peran_tahap !== 'fo' || !t.penangan_id) continue;
    const ke = Number(t.tahap_ke);
    if (!Number.isFinite(ke) || ke >= tahapKe) continue;
    const nama = satu<{ nama?: string }>(t.petugas)?.nama;
    if (!nama) continue;
    if (!terpilih || ke > terpilih.ke) terpilih = { ke, id: t.penangan_id, nama };
  }
  return terpilih ? { id: terpilih.id, nama: terpilih.nama } : null;
}

export function namaFoSebelum(tahapKunjungan: unknown, tahapKe: number): string | null {
  return foSebelum(tahapKunjungan, tahapKe)?.nama ?? null;
}

type EmailEmbed = { email?: string | null; updated_at?: string | null };
const teksIsi = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const keDaftar = (v: unknown): EmailEmbed[] => (Array.isArray(v) ? v : v ? [v] : []) as EmailEmbed[];

/**
 * Email untuk rekap (FO dan petugas layanan): Pendataan tiket tahap ini -> Pendataan terbaru pada kunjungan yang sama
 * (diisi petugas layanan pada tiket hasil eskalasi) -> email kunjungan (diisi FO; opsional) -> null.
 */
export function emailRekap(
  kunjungan: { email?: string | null; pelayanan_oss?: unknown; pelayanan_perizinan?: unknown } | null,
  tiket: { pelayanan_oss?: unknown; pelayanan_perizinan?: unknown } | null,
): string | null {
  const dariTiket =
    teksIsi(satu<EmailEmbed>(tiket?.pelayanan_oss)?.email) ?? teksIsi(satu<EmailEmbed>(tiket?.pelayanan_perizinan)?.email);
  if (dariTiket) return dariTiket;
  const pendataan = [...keDaftar(kunjungan?.pelayanan_oss), ...keDaftar(kunjungan?.pelayanan_perizinan)]
    .filter((p) => teksIsi(p?.email))
    .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  return teksIsi(pendataan[0]?.email) ?? teksIsi(kunjungan?.email);
}

export function mapRawPenangananRow(r: Record<string, unknown>): RekapPenangananRow {
  const kunjungan = satu<{
    nama?: string; asal_instansi?: string | null; email?: string | null;
    pelayanan_oss?: unknown; pelayanan_perizinan?: unknown; tahap_fo?: unknown;
  }>(r.kunjungan);
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
  const peran = r.peran_tahap as PeranTahap;
  const tahapKe = Number(r.tahap_ke);
  // peran 'fo': FO = penangan tahap itu sendiri; peran 'layanan': FO tahap 'fo' terakhir sebelum tahap ini.
  const penanganId = (r.penangan_id as string | null) ?? null;
  const fo = peran === 'fo'
    ? (penanganId && petugas?.nama ? { id: penanganId, nama: petugas.nama } : null)
    : foSebelum(kunjungan?.tahap_fo, tahapKe);
  return {
    id: r.id as string,
    kunjungan_id: r.kunjungan_id as string,
    tahap_ke: tahapKe,
    peran_tahap: peran,
    layanan_id: (r.layanan_id as string | null) ?? null,
    layanan_nama: layanan?.nama ?? null,
    saluran: r.saluran as string,
    penangan_id: (r.penangan_id as string | null) ?? null,
    penangan_nama: petugas?.nama ?? null,
    fo_nama: peran === 'fo' ? (petugas?.nama ?? null) : (fo?.nama ?? null),
    fo_id: fo?.id ?? null,
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
    email: emailRekap(kunjungan, tiketRaw),
    tiket,
  };
}

export interface OpsiFo {
  id: string;
  nama: string;
}

/** Daftar FO unik (urut nama) yang muncul pada baris; dasar opsi filter "Front Office yang mengeskalasi". */
export function daftarOpsiFo(rows: Pick<RekapPenangananRow, 'fo_id' | 'fo_nama'>[]): OpsiFo[] {
  const peta = new Map<string, string>();
  for (const r of rows) {
    if (r.fo_id && r.fo_nama && !peta.has(r.fo_id)) peta.set(r.fo_id, r.fo_nama);
  }
  return [...peta.entries()]
    .map(([id, nama]) => ({ id, nama }))
    .sort((a, b) => a.nama.localeCompare(b.nama) || a.id.localeCompare(b.id));
}

/** Saring ke satu FO yang mengeskalasi/melayani (null = semua). Dilakukan di memori: FO berasal dari embed kunjungan. */
export function saringFo<T extends Pick<RekapPenangananRow, 'fo_id'>>(rows: T[], foId: string | null | undefined): T[] {
  return foId ? rows.filter((r) => r.fo_id === foId) : rows;
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
 * Cakupan data yang boleh dibaca (ditegakkan di server; RLS penanganan_staf_select/boleh_penanganan tetap berlaku).
 *  - peran 'fo': Admin dan Front Office melihat SEMUA FO dan boleh memfilter satu FO (petugas_id). Petugas ditolak.
 *  - peran 'layanan': Admin dan Front Office semua (filter petugas/layanan opsional); Petugas hanya layanannya
 *    (layanan lain / tanpa layanan = 403).
 * Keputusan CEO 2026-10-14 (keterbukaan data antar FO; menggantikan "FO hanya miliknya" dan "FO hanya eskalasi asal
 * dirinya"): semua FO satu unit layanan, setiap baris menampilkan nama FO yang melayani. RLS pendukung: migrasi
 * 202610140013 (FO membaca semua tahap penanganan). Sebelum 0013 diterapkan, RLS lama membatasi baris yang terbaca FO
 * (rekap tidak lengkap, tidak bocor).
 */
export function tentukanCakupan(
  me: StafRekap,
  q: { peran: PeranTahap; petugas_id?: string; layanan_id?: string },
): CakupanPenanganan {
  const tolak = (error: string): CakupanPenanganan => ({ ok: false, status: 403, error });
  const terbuka = me.role === 'admin' || me.role === 'front_office';
  if (q.peran === 'fo') {
    if (terbuka) return { ok: true, penanganId: q.petugas_id ?? null, layananId: null };
    return tolak('Forbidden');
  }
  if (terbuka) {
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
