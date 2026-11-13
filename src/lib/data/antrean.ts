// Lapisan data antrean admin (rencana refaktor 2026-11-11 tugas 5.2, SPEC bagian 5): kueri `tiket_antrean`, `penanganan`,
// dan `absensi_petugas` yang sebelumnya hidup di `app/admin/antrian/page.tsx`.
//
// Aturan lapisan data:
// - Fungsi menerima SupabaseClient sebagai argumen pertama (klien browser dengan RLS pengguna), tanpa React dan tanpa toast.
//   Pemanggil yang memutuskan cara menampilkan galat.
// - Tidak pernah melempar: hasilnya HasilAntrean<T> = { data, error: null } | { data: null, error: GalatAntrean }.
//   `error.asli` membawa objek galat aslinya (memuat `code` PostgREST) agar pemanggil dapat mencatat/memilah.
// - `select` selalu daftar kolom eksplisit lewat konstanta KOLOM_*.
// - Kueri yang tidak saling bergantung dijalankan bersamaan (Promise.all); galat dilaporkan menurut prioritas lama
//   (utama, panel, statistik, total harian) sehingga pesan yang tampil tidak bergantung pada mana yang selesai lebih dulu.
import type { SupabaseClient } from '@supabase/supabase-js';
import { galatTanggalDiluarBatas, muatAntreanFo } from '@/lib/fo/akses-antrean';
import { muatKoordinator } from '@/lib/akses-data/lingkup';
import { mutasiInsert, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { pesanGalatReferensi } from './referensi';

// ---------------------------------------------------------------------------------------------------------------
// Kolom dan batas
// ---------------------------------------------------------------------------------------------------------------

/** Satu baris tiket beserta Layanan, pemilik (pelayan), dan kunjungannya. Dipakai tabel dan panel. */
export const KOLOM_TIKET_ANTREAN = `
  id, kunjungan_id, legacy_visit_id, layanan_id, dilayani_oleh, penanganan_asal_id, nomor, nomor_display, status,
  waktu_terbit, waktu_mulai_layan, waktu_selesai,
  layanan:layanan_id(nama, form_pendataan),
  pelayan:dilayani_oleh(nama),
  kunjungan(nama, asal, waktu_masuk)
`.replace(/\s+/g, ' ').trim();
/** Tiket selesai untuk rata-rata durasi. */
export const KOLOM_TIKET_STATISTIK = 'waktu_mulai_layan, waktu_selesai';
/** Hitungan total harian tanpa muatan baris (`head: true`). */
export const KOLOM_TIKET_HITUNG = 'id';
/** Catatan eskalasi FO: baris `penanganan` tahap asal (kontrak FO-ESKALASI §6.3). */
export const KOLOM_CATATAN_ESKALASI = 'id, topik, catatan, penangan:penangan_id(nama)';
export const KOLOM_ABSENSI_REKAP = 'id, petugas_id, tanggal, jam_masuk, jam_pulang, status, petugas:petugas_id(nama)';
/** Profil staf pembuka halaman antrean (penanda Koordinator dibaca terpisah, lihat muatProfilAntrean). */
export const KOLOM_PROFIL_ANTREAN = 'id, role, layanan_id, layanan:layanan_id(nama)';

/** Batas jumlah tiket satu tanggal yang dimuat ke klien (panel membaca semua tiket aktif). */
export const BATAS_TIKET_KLIEN = 10_000;
export const PESAN_BATAS_TIKET = 'Antrean tanggal ini melebihi batas pemuatan 10.000 tiket. Hubungi Admin untuk membuka data lengkap.';
export const PESAN_DAFTAR_BERUBAH = 'Daftar antrean berubah saat dimuat. Coba lagi.';
/** Ukuran halaman baca panel dan halaman lanjutan RPC FO. */
const UKURAN_HALAMAN_LANJUTAN = 200;

// ---------------------------------------------------------------------------------------------------------------
// Tipe
// ---------------------------------------------------------------------------------------------------------------

export type StatusTiket =
  | 'menunggu' | 'dilayani' | 'selesai' | 'tidak_terlayani' | 'no_show' | 'batal' | 'dikembalikan' | 'dialihkan';

export interface KunjunganEmbed {
  nama: string;
  asal: 'walk_in' | 'reservasi';
  waktu_masuk: string | null;
}

export interface LayananEmbed {
  nama: string;
  /** Jenis Formulir Pendataan wajib (migrasi 202610140012); `undefined` = kolom tidak ikut di-select. */
  form_pendataan?: string | null;
}

export interface TiketBaris {
  /** tiket_antrean.id */
  id: string;
  /** Kunci status/QR Pesan Perilaku; '' bila tiket lama tanpa kunjungan. */
  kunjungan_id: string;
  legacy_visit_id: string;
  /** Nama Front Office yang mendaftarkan/menerima pengunjung (RPC fo_antrean_daftar, migrasi 202611030015). */
  fo_nama?: string | null;
  layanan_id: string;
  /** petugas.id yang memulai layanan (pemilik tiket). */
  dilayani_oleh: string | null;
  /** Tahap FO yang melahirkan tiket; null/kosong = tiket lama (alur visit). */
  penanganan_asal_id?: string | null;
  /** Nama pemilik (RLS: petugas hanya membaca barisnya sendiri). */
  pelayan: { nama: string } | { nama: string }[] | null;
  nomor: number;
  nomor_display: string;
  status: StatusTiket;
  waktu_terbit: string | null;
  waktu_mulai_layan: string | null;
  waktu_selesai: string | null;
  layanan: LayananEmbed | LayananEmbed[] | null;
  kunjungan: KunjunganEmbed | KunjunganEmbed[] | null;
}

/** Catatan eskalasi dari Front Office (kontrak §6.3): topik + catatan tahap FO yang melahirkan tiket. */
export interface CatatanEskalasi {
  topik: string | null;
  catatan: string | null;
  foNama: string | null;
}

export interface BarisAbsensi {
  id: string;
  petugas_id: string;
  tanggal: string;
  jam_masuk: string | null;
  jam_pulang: string | null;
  status: string;
  petugas: { nama: string } | null;
}

/** Profil staf yang membuka halaman antrean. */
export interface ProfilPetugasAntrean {
  id: string;
  role: string;
  layanan_id: string;
  layanan?: { nama: string } | { nama: string }[];
  /** Fase 3: penanda Koordinator (false bila migrasi 202610290001 belum diterapkan). */
  koordinator?: boolean;
}

export interface StatistikSelesai {
  totalSelesai: number;
  rataWaktuMenit: number;
}

export interface ParamMuatAntrean {
  /** YYYY-MM-DD (WIB). */
  tanggal: string;
  /** Status tabel; null = semua status. Panel selalu memakai menunggu + dilayani. */
  status: readonly string[] | null;
  /** Indeks halaman berbasis 0. */
  halaman: number;
  ukuranHalaman: number;
  /** 'admin' | 'front_office' | 'petugas'. Admin/FO mencoba RPC akses FO lebih dulu. */
  peran: string;
  /** Lingkup Layanan Petugas; null untuk peran lain. */
  layananId: string | null;
  /** Panel hanya dibaca untuk hari ini dan tab selain Selesai. */
  denganPanel: boolean;
  /** Dipanggil di antara halaman bacaan berurutan; false = hasil sudah basi, berhenti (galat jenis 'basi'). */
  masihBerlaku?: () => boolean;
}

export interface DataAntrean {
  /** Halaman tabel. */
  baris: TiketBaris[];
  /** Seluruh tiket aktif (jalur RPC FO: seluruh tiket tanggal itu) untuk Panel Sekarang. Kosong bila tanpa panel. */
  barisPanel: TiketBaris[];
  /** Jumlah baris sesuai saringan status (untuk paginasi). */
  totalTabel: number;
  /** Total tiket tanggal itu, tanpa saringan tab. */
  totalHarian: number;
  statistik: StatistikSelesai;
  /** true = daftar datang dari RPC akses FO (kolom "Front Office" tersedia). */
  aksesFo: boolean;
}

export type JenisGalatAntrean = 'tanggal_diluar_batas' | 'batas_tiket' | 'basi' | 'umum';

export interface GalatAntrean {
  jenis: JenisGalatAntrean;
  pesan: string;
  /** Objek galat aslinya (PostgREST/Error); untuk log. */
  asli: unknown;
}

export type HasilAntrean<T> = { data: T; error: null } | { data: null; error: GalatAntrean };

// ---------------------------------------------------------------------------------------------------------------
// Galat
// ---------------------------------------------------------------------------------------------------------------

/** Memilah galat apa pun menjadi jenis yang dibedakan halaman (tanggal di luar jendela FO, batas tiket, selebihnya umum). */
export function galatAntreanDari(e: unknown): GalatAntrean {
  if (galatTanggalDiluarBatas(e)) return { jenis: 'tanggal_diluar_batas', pesan: pesanGalatReferensi(e), asli: e };
  if (e instanceof Error && e.message === PESAN_BATAS_TIKET) return { jenis: 'batas_tiket', pesan: PESAN_BATAS_TIKET, asli: e };
  return { jenis: 'umum', pesan: pesanGalatReferensi(e), asli: e };
}

const ok = <T>(data: T): HasilAntrean<T> => ({ data, error: null });
const gagal = <T>(e: unknown): HasilAntrean<T> => ({ data: null, error: galatAntreanDari(e) });
const galatBatas = <T>(): HasilAntrean<T> => gagal(new Error(PESAN_BATAS_TIKET));
const galatDaftarBerubah = <T>(): HasilAntrean<T> => gagal(new Error(PESAN_DAFTAR_BERUBAH));
const basi = <T>(): HasilAntrean<T> => ({ data: null, error: { jenis: 'basi', pesan: '', asli: null } });

// ---------------------------------------------------------------------------------------------------------------
// Statistik
// ---------------------------------------------------------------------------------------------------------------

/** Rata-rata durasi layanan (menit, dibulatkan) dari tiket selesai; hitungan server diutamakan atas panjang data. */
export function hitungStatistikSelesai(
  rows: ReadonlyArray<{ waktu_mulai_layan: string | null; waktu_selesai: string | null }>,
  count: number | null,
): StatistikSelesai {
  const totalDurasiMenit = rows.reduce((jumlah, row) => {
    if (!row.waktu_selesai || !row.waktu_mulai_layan) return jumlah;
    return jumlah + (new Date(row.waktu_selesai).getTime() - new Date(row.waktu_mulai_layan).getTime()) / 60000;
  }, 0);
  return {
    totalSelesai: count ?? rows.length,
    rataWaktuMenit: rows.length > 0 ? Math.round(totalDurasiMenit / rows.length) : 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Muat antrean
// ---------------------------------------------------------------------------------------------------------------

/**
 * Memuat satu tanggal antrean: halaman tabel, tiket untuk Panel Sekarang, statistik, dan total harian.
 *
 * Admin dan Front Office membaca lewat RPC `fo_antrean_daftar` (migrasi 202611030015) sehingga semua FO melihat seluruh
 * antrean tanpa HP/email/isian rekan. Petugas (termasuk Koordinator) selalu memakai kueri lama berlingkup Layanannya;
 * RPC belum ada -> kueri lama untuk semua peran. RPC ada tetapi menolak (mis. FORBIDDEN) = galat, BUKAN kueri lama.
 *
 * Kueri lama menjalankan empat bacaan bersamaan. Galat salah satu bagian menggagalkan seluruh muat (tidak ada keadaan
 * setengah jadi); bila lebih dari satu gagal, yang dilaporkan mengikuti urutan lama: utama, panel, statistik, total.
 */
export async function muatAntrean(sb: SupabaseClient, p: ParamMuatAntrean): Promise<HasilAntrean<DataAntrean>> {
  try {
    if (p.peran === 'admin' || p.peran === 'front_office') {
      const lewatRpc = await muatViaRpcFo(sb, p);
      if (lewatRpc) return lewatRpc;
    }
    return await muatViaKueri(sb, p);
  } catch (e) {
    return gagal(e);
  }
}

/** null = RPC belum ada (migrasi belum diterapkan): pemanggil turun ke kueri lama. Galat lain DILEMPAR. */
async function muatViaRpcFo(sb: SupabaseClient, p: ParamMuatAntrean): Promise<HasilAntrean<DataAntrean> | null> {
  const dari = p.halaman * p.ukuranHalaman;
  const lewat = await muatAntreanFo(sb, { tanggal: p.tanggal, batas: p.ukuranHalaman, lewati: 0 });
  if (!lewat.tersedia) return null;
  if (p.masihBerlaku && !p.masihBerlaku()) return basi();

  // RPC belum punya filter status: kumpulkan halaman berkolom aman satu tanggal. Batas eksplisit mencegah pemindaian tanpa
  // batas; gagal tertutup, jangan tampilkan panel yang tak lengkap.
  const semua = [...lewat.data.rows];
  if (lewat.data.total > BATAS_TIKET_KLIEN) return galatBatas();
  while (semua.length < lewat.data.total) {
    const lanjutan = await muatAntreanFo(sb, { tanggal: p.tanggal, batas: UKURAN_HALAMAN_LANJUTAN, lewati: semua.length });
    if (p.masihBerlaku && !p.masihBerlaku()) return basi();
    if (!lanjutan.tersedia || !lanjutan.data.rows.length) return galatDaftarBerubah();
    semua.push(...lanjutan.data.rows);
  }
  const seluruhBaris = semua.map((r) => ({ ...r, kunjungan_id: r.kunjungan_id ?? '', legacy_visit_id: '' })) as unknown as TiketBaris[];
  const terfilter = p.status ? seluruhBaris.filter((a) => p.status!.includes(a.status)) : seluruhBaris;
  return ok({
    baris: terfilter.slice(dari, dari + p.ukuranHalaman),
    barisPanel: seluruhBaris,
    totalTabel: terfilter.length,
    totalHarian: lewat.data.total,
    statistik: lewat.data.statistik,
    aksesFo: true,
  });
}

async function muatViaKueri(sb: SupabaseClient, p: ParamMuatAntrean): Promise<HasilAntrean<DataAntrean>> {
  const lingkup = p.peran === 'petugas' && p.layananId ? p.layananId : null;
  // Bacaan utama dikirim lebih dulu. Bila permintaan ini sudah digantikan yang lebih baru (mis. selama menunggu RPC FO),
  // bacaan pendukung tidak dikirim: hasilnya pasti dibuang pemanggil. Tanpa pengecekan itu, tiga kueri terbuang per muat ulang
  // yang saling tumpang tindih.
  const bacaanUtama = bacaHalamanTabel(sb, p, lingkup);
  if (p.masihBerlaku && !p.masihBerlaku()) return basi();
  const [utama, panel, stats, total] = await Promise.all([
    bacaanUtama,
    p.denganPanel ? bacaTiketPanel(sb, p, lingkup) : Promise.resolve(ok<TiketBaris[]>([])),
    bacaTiketSelesai(sb, p, lingkup),
    bacaTotalHarian(sb, p, lingkup),
  ]);
  if (utama.error) return { data: null, error: utama.error };
  if (panel.error) return { data: null, error: panel.error };
  if (stats.error) return { data: null, error: stats.error };
  if (total.error) return { data: null, error: total.error };
  return ok({
    baris: utama.data.baris,
    barisPanel: panel.data,
    totalTabel: utama.data.total,
    totalHarian: total.data,
    statistik: hitungStatistikSelesai(stats.data.rows, stats.data.count),
    aksesFo: false,
  });
}

/** Halaman tabel: terurut nomor, disaring tanggal/status/Layanan di server SEBELUM paginasi. */
async function bacaHalamanTabel(
  sb: SupabaseClient, p: ParamMuatAntrean, lingkup: string | null,
): Promise<HasilAntrean<{ baris: TiketBaris[]; total: number }>> {
  try {
    const dari = p.halaman * p.ukuranHalaman;
    let query = sb
      .from('tiket_antrean')
      .select(KOLOM_TIKET_ANTREAN, { count: 'exact' })
      .eq('tanggal', p.tanggal)
      .order('nomor', { ascending: true });
    if (p.status) query = query.in('status', [...p.status]);
    if (lingkup) query = query.eq('layanan_id', lingkup);
    const { data, count, error } = await query.range(dari, dari + p.ukuranHalaman - 1);
    if (error) return gagal(error); // galat tidak boleh tampil sebagai "Belum Ada Antrean"
    return ok({ baris: (data || []) as unknown as TiketBaris[], total: count ?? (data?.length ?? 0) });
  } catch (e) {
    return gagal(e);
  }
}

/** Panel hari ini berdiri sendiri: seluruh tiket aktif, terurut, terlepas dari tab/halaman tabel. Dibaca per 200. */
async function bacaTiketPanel(
  sb: SupabaseClient, p: ParamMuatAntrean, lingkup: string | null,
): Promise<HasilAntrean<TiketBaris[]>> {
  try {
    const baris: TiketBaris[] = [];
    let total = 0;
    do {
      let query = sb
        .from('tiket_antrean')
        .select(KOLOM_TIKET_ANTREAN, { count: 'exact' })
        .eq('tanggal', p.tanggal)
        .order('nomor', { ascending: true })
        .in('status', ['menunggu', 'dilayani']);
      if (lingkup) query = query.eq('layanan_id', lingkup);
      const hasil = await query.range(baris.length, baris.length + UKURAN_HALAMAN_LANJUTAN - 1);
      if (hasil.error) return gagal(hasil.error);
      if (p.masihBerlaku && !p.masihBerlaku()) return basi();
      total = hasil.count ?? (hasil.data?.length ?? 0);
      if (total > BATAS_TIKET_KLIEN) return galatBatas();
      if (!hasil.data?.length && baris.length < total) return galatDaftarBerubah();
      baris.push(...((hasil.data ?? []) as unknown as TiketBaris[]));
    } while (baris.length < total);
    return ok(baris);
  } catch (e) {
    return gagal(e);
  }
}

/**
 * Tiket selesai tanggal itu untuk statistik dari server, bukan dari halaman aktif saja (T-5).
 * PENGECUALIAN tertulis dari SPEC bagian 5 butir 3 (tanpa .range()/.limit()): `count: 'exact'` selalu tepat, jadi
 * `totalSelesai` tidak pernah terpotong; hanya rata-rata durasi yang dihitung dari baris yang dikembalikan PostgREST
 * (maks 1000 baris pertama), sehingga menjadi perkiraan bila satu lingkup melebihi 1000 tiket selesai dalam sehari
 * (jauh di atas volume harian DPMPTSP). Bila volume tumbuh, pindahkan agregat ini ke RPC (avg durasi di SQL).
 */
async function bacaTiketSelesai(
  sb: SupabaseClient, p: ParamMuatAntrean, lingkup: string | null,
): Promise<HasilAntrean<{ rows: Array<{ waktu_mulai_layan: string | null; waktu_selesai: string | null }>; count: number | null }>> {
  try {
    let query = sb
      .from('tiket_antrean')
      .select(KOLOM_TIKET_STATISTIK, { count: 'exact' })
      .eq('tanggal', p.tanggal)
      .eq('status', 'selesai');
    if (lingkup) query = query.eq('layanan_id', lingkup);
    const { data, count, error } = await query;
    if (error) return gagal(error);
    return ok({
      rows: (data ?? []) as unknown as Array<{ waktu_mulai_layan: string | null; waktu_selesai: string | null }>,
      count: count ?? null,
    });
  } catch (e) {
    return gagal(e);
  }
}

/** Total harian: cakupan tanggal/Layanan yang sama, tanpa saringan tab dan tanpa baris payload. */
async function bacaTotalHarian(
  sb: SupabaseClient, p: ParamMuatAntrean, lingkup: string | null,
): Promise<HasilAntrean<number>> {
  try {
    let query = sb.from('tiket_antrean').select(KOLOM_TIKET_HITUNG, { count: 'exact', head: true }).eq('tanggal', p.tanggal);
    if (lingkup) query = query.eq('layanan_id', lingkup);
    const { count, error } = await query;
    if (error) return gagal(error);
    return ok(count ?? 0);
  } catch (e) {
    return gagal(e);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Pelengkap tampilan
// ---------------------------------------------------------------------------------------------------------------

/**
 * Catatan eskalasi FO per id tahap asal (`penanganan_asal_id`). Hanya pelengkap tampilan: pemanggil tidak boleh menggagalkan
 * daftar antrean karena galatnya (jadikan kosong). Tanpa id tidak ada kueri.
 */
export async function muatCatatanEskalasi(
  sb: SupabaseClient, ids: readonly string[],
): Promise<HasilAntrean<Record<string, CatatanEskalasi>>> {
  if (ids.length === 0) return ok({});
  try {
    const { data, error } = await sb.from('penanganan').select(KOLOM_CATATAN_ESKALASI).in('id', [...ids]);
    if (error) return gagal(error);
    const peta: Record<string, CatatanEskalasi> = {};
    for (const r of (data ?? []) as unknown as Array<{
      id: string; topik: string | null; catatan: string | null; penangan: { nama: string } | { nama: string }[] | null;
    }>) {
      const fo = Array.isArray(r.penangan) ? r.penangan[0] : r.penangan;
      peta[r.id] = { topik: r.topik, catatan: r.catatan, foNama: fo?.nama ?? null };
    }
    return ok(peta);
  } catch (e) {
    return gagal(e);
  }
}

/**
 * Profil staf yang membuka halaman antrean (tugas 5.3). `null` = belum masuk atau tanpa baris petugas (PGRST116, perilaku
 * lama: diperlakukan sebagai Admin tanpa profil). Penanda Koordinator dibaca TERPISAH dan hanya untuk non-Admin: select
 * kolom yang belum ada akan menggagalkan seluruh kueri profil sebelum migrasi 202610290001.
 */
export async function muatProfilAntrean(sb: SupabaseClient): Promise<HasilAntrean<ProfilPetugasAntrean | null>> {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return ok(null);
    const { data: p, error } = await sb
      .from('petugas')
      .select(KOLOM_PROFIL_ANTREAN)
      .eq('auth_user_id', user.id)
      .single();
    if (error && error.code !== 'PGRST116') return gagal(error);
    if (!p) return ok(null);
    const profil = p as unknown as ProfilPetugasAntrean;
    const koordinator = profil.role !== 'admin' ? await muatKoordinator(sb, profil.id) : false;
    return ok({ ...profil, koordinator });
  } catch (e) {
    return gagal(e);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Aksi tiket (RPC atomik; tugas 5.3). Galat membawa MutasiError aslinya di `error.asli` (kode RPC ada di `asal`-nya)
// agar pemanggil memilah pesan dan memutuskan muat ulang seperti sebelumnya.
// ---------------------------------------------------------------------------------------------------------------

/**
 * `panggil_tiket` mengembalikan nomor_display, atau NULL TANPA galat bila tiket bukan 'menunggu' (sudah dilayani/batal/dst.)
 * sehingga tidak ada kejadian ke layar TV. `dipanggil: false` = tidak dipanggil.
 */
export async function panggilTiket(sb: SupabaseClient, tiketId: string): Promise<HasilAntrean<{ dipanggil: boolean }>> {
  try {
    const dipanggil = await mutasiInsert(sb.rpc('panggil_tiket', { p_tiket_id: tiketId }));
    return ok({ dipanggil: dipanggil.length > 0 });
  } catch (e) {
    return gagal(e);
  }
}

/** `layanan_mulai` (guard atomik di tiket: satu pemenang). Balasan jsonb tunggal; kosong/null tanpa galat = gagal. */
export async function mulaiLayananTiket(
  sb: SupabaseClient, tiketId: string,
): Promise<HasilAntrean<{ sudahMilikAnda: boolean }>> {
  try {
    const [hasil] = await mutasiWajibBaris<{ ok: boolean; sudah_milik_anda?: boolean }>(
      sb.rpc('layanan_mulai', { p_tiket_id: tiketId }),
    );
    return ok({ sudahMilikAnda: Boolean(hasil?.sudah_milik_anda) });
  } catch (e) {
    return gagal(e);
  }
}

/** `layanan_selesai` tanpa pendataan; hanya pemilik tiket (ditegakkan DB: BUKAN_PEMILIK). */
export async function selesaikanLayananTiket(sb: SupabaseClient, tiketId: string): Promise<HasilAntrean<true>> {
  try {
    await mutasiWajibBaris(sb.rpc('layanan_selesai', { p_tiket_id: tiketId }));
    return ok(true as const);
  } catch (e) {
    return gagal(e);
  }
}

/** Absensi petugas satu tanggal untuk rekap di halaman antrean; `layananId` (Petugas) membatasi ke Layanannya.
 * PENGECUALIAN tertulis dari SPEC bagian 5 butir 3: satu tanggal x jumlah petugas aktif (puluhan), jauh di bawah batas
 * baris PostgREST, jadi tanpa .limit(); mock test halaman tidak mendukung rantai tambahan. */
export async function muatAbsensiRekap(
  sb: SupabaseClient, p: { tanggal: string; layananId: string | null },
): Promise<HasilAntrean<BarisAbsensi[]>> {
  try {
    let query = sb
      .from('absensi_petugas')
      .select(KOLOM_ABSENSI_REKAP)
      .eq('tanggal', p.tanggal)
      .order('jam_masuk', { ascending: true });
    // join lewat tabel petugas: saring menurut layanan_id petugas
    if (p.layananId) query = query.eq('petugas.layanan_id' as never, p.layananId);
    const { data, error } = await query;
    if (error) return gagal(error);
    const baris = ((data ?? []) as unknown as Array<Omit<BarisAbsensi, 'petugas'> & {
      petugas: { nama: string } | { nama: string }[] | null;
    }>).map((d) => ({ ...d, petugas: Array.isArray(d.petugas) ? (d.petugas[0] ?? null) : d.petugas }));
    return ok(baris);
  } catch (e) {
    return gagal(e);
  }
}
