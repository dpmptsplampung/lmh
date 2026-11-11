import 'server-only';
// Data publik ber-cache (SPEC refaktor §5 "Cache (free tier)", rencana 4.2). Dipakai halaman publik server
// (beranda `/`, nanti `/chat`, `/pengaduan`, dll).
//
// ATURAN ANTI-BOCOR (jangan dilonggarkan):
//  - Hanya klien anon TANPA cookie (`buatKlienAnon`): tidak mengimpor lib/supabase/{server,service}, tidak memakai
//    cookies()/headers(). Tanpa sesi, jadi tiap pengunjung menerima isi yang sama.
//  - Hanya data publik. Data per-pengguna, hasil RPC berlingkup, apa pun di bawah /admin dan /me DILARANG masuk sini.
//  - Semua masukan menjadi argumen fungsi (kunci cache). Kebanyakan fungsi tanpa argumen (satu entri); yang bergantung
//    waktu (transparansi: rentang kuartal WIB) menerima rentangnya sebagai argumen string, jadi hari/kuartal baru = entri baru.
//  - Hasil yang TIDAK lengkap tidak disimpan di DATA CACHE (unstable_cache). "Tidak lengkap" = galat SESAAT: 5xx/503,
//    jaringan putus, lemparan, atau batas waktu. Bawaan/tingkat-lebih-lama hanya sah (dan boleh disimpan) bila penyebabnya
//    "objek belum ada" (tabel/kolom: migrasi belum diterapkan, lewat objekBelumAda), karena bentuknya tetap. Mekanismenya:
//    cb melempar `TidakDisimpan` yang membawa hasil terbaik untuk dipakai sekali ini; bila sudah ada entri lama, Next
//    umumnya menyajikannya (stale) alih-alih hasil galat.
//  - BATAS perlindungan itu: ia hanya menjaga Data Cache. Halaman `revalidate = 60` tetap merender hasil terbaik /
//    `bawaanGalat` dengan SUKSES lalu menyimpannya di Full Route Cache (stale-while-revalidate), jadi halaman berisi galat
//    dapat bertahan sampai penyegaran halaman berikutnya (kira-kira 60 detik + satu permintaan). Pengunjung punya jalan keluar
//    lewat tombol "Coba lagi" di pulau klien. Perilaku halaman itu sengaja tidak diubah.
//
// Invalidasi: `revalidateTag(tag, { expire: 0 })` dari route admin (rencana 4.5) dengan daftar izin TAG_PUBLIK.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { logServerEvent } from '@/lib/observability/logger';
import type { IkmRow } from '@/lib/ikm';
import { toWIBDateString } from '@/lib/time';
import { gabungkanBlok, type BlokTersusun } from '@/lib/homepage/blok';
import {
  BATAS_MUAT_MS,
  GAGAL_LAYANAN,
  PENGATURAN_BERANDA_BAWAAN,
  denganBatasWaktu,
  muatBlokKetat,
  muatLayananKetat,
  muatPengaturanBeranda,
  type LayananEtalase,
  type PengaturanBeranda,
} from '@/lib/homepage/data';

export const TAG_PUBLIK = {
  beranda: 'publik-beranda',
  layanan: 'publik-layanan',
  faq: 'publik-faq',
  transparansi: 'publik-transparansi',
} as const;
export type TagPublik = (typeof TAG_PUBLIK)[keyof typeof TAG_PUBLIK];

/** Umur entri cache (detik); halaman publik memakai `export const revalidate = 60` yang sama. */
export const REVALIDASI_DETIK = 60;

/** Batas baris daftar layanan (tabel kecil; batas ada agar kueri daftar selalu berbatas). */
const BATAS_LAYANAN = 200;

/** Batas baris FAQ aktif (tabel kecil; batas ada agar kueri daftar selalu berbatas). */
const BATAS_FAQ = 500;
const KOLOM_FAQ = 'id, pertanyaan, jawaban, layanan_id, urutan';

/** Data beranda; JSON-aman (unstable_cache menyimpan JSON: tanpa Map/fungsi). */
export type BerandaPublik = {
  blok: BlokTersusun[];
  layanan: LayananEtalase[];
  /** True bila daftar layanan GAGAL dimuat (semua tingkat query / batas waktu): beda dari kosong yang sah. */
  layananGalat: boolean;
  pengaturan: PengaturanBeranda;
};

export type HasilLayananPublik = { layanan: LayananEtalase[]; galat: boolean };

export type FaqPublik = {
  id: string;
  pertanyaan: string;
  jawaban: string;
  /** null = FAQ umum (berlaku untuk semua layanan). */
  layanan_id: string | null;
  urutan: number | null;
};
export type HasilFaqPublik = { faq: FaqPublik[]; galat: boolean };

/** Pilihan layanan pada formulir pengaduan publik. */
export type OpsiLayananPengaduan = { id: string; nama: string };
export type HasilOpsiLayananPengaduan = { layanan: OpsiLayananPengaduan[]; galat: boolean };

/** IKM publik per layanan untuk kuartal berjalan (/transparansi); JSON-aman. */
export type HasilTransparansiPublik = {
  rows: IkmRow[];
  /** Waktu data ini dihitung (ISO UTC); halaman memformatnya ke WIB. */
  diperbaruiPada: string;
  /** True bila DAFTAR layanan gagal dimuat (beda dari daftar kosong yang sah). */
  galat: boolean;
};

/**
 * Klien anon tanpa sesi. `cache: 'no-store'` pada fetch: lapisan cache HANYA unstable_cache (Data Cache fetch
 * tidak ikut campur); di dalam unstable_cache Next memperlakukannya sebagai force-no-store.
 */
function buatKlienAnon(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}

/**
 * Dilempar dari cb unstable_cache agar hasil tak lengkap tidak disimpan di Data Cache; membawa hasil terbaik untuk
 * sekali pakai. Tidak mencegah halaman yang merendernya tersimpan di Full Route Cache (lihat catatan di kepala berkas).
 */
class TidakDisimpan<T> extends Error {
  constructor(readonly hasil: T) {
    super('Hasil data publik tidak lengkap; tidak disimpan di cache.');
    this.name = 'TidakDisimpan';
  }
}

type Termuat<T> = { data: T; lengkap: boolean };

/**
 * Membungkus pemuat dengan unstable_cache (tag + revalidate 60). `nama` masuk kunci cache (cb ketiga fungsi bertubuh
 * sama, jadi `nama` WAJIB unik). Galat tak terduga -> `bawaanGalat()` + dicatat; galat internal Next diteruskan.
 * Data Cache bertahan lintas deploy: naikkan sufiks `-v1` bila BENTUK hasil sebuah fungsi berubah.
 */
function denganCache<T, A extends string[] = []>(
  nama: string,
  tag: TagPublik[],
  muat: (sb: SupabaseClient, ...arg: A) => Promise<Termuat<T>>,
  bawaanGalat: () => T,
): (...arg: A) => Promise<T> {
  // Argumen (hanya string) ikut kunci cache: Next menambahkan JSON argumen ke kunci tiap pemanggilan.
  const tersimpan = unstable_cache(
    async (...arg: A) => {
      const { data, lengkap } = await muat(buatKlienAnon(), ...arg);
      if (!lengkap) throw new TidakDisimpan(data);
      return data;
    },
    [`publik-${nama}-v1`],
    { tags: tag, revalidate: REVALIDASI_DETIK },
  );
  return async (...arg: A) => {
    try {
      return await tersimpan(...arg);
    } catch (galat) {
      unstable_rethrow(galat); // redirect/bailout dinamis milik Next tidak boleh ditelan
      if (galat instanceof TidakDisimpan) return galat.hasil as T;
      const operasi = `publik.${nama}_gagal`; // di luar panggilan: pemindai kunci-log menganggap `${nama}` sebagai kunci
      logServerEvent('warn', { operation: operasi, error: galat });
      return bawaanGalat();
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Beranda: blok + layanan publik + pengaturan situs
// ---------------------------------------------------------------------------------------------------------------

async function muatBerandaMentah(sb: SupabaseClient): Promise<Termuat<BerandaPublik>> {
  // Pemuat KETAT: null / tingkat 0 = gagal (galat sesaat atau batas waktu), BUKAN "tabel belum ada" (itu hasil sah:
  // blok bawaan / tingkat kolom lebih lama). Kegagalan memakai bawaan sekali ini dan membuat hasil tidak disimpan.
  const [blok, layanan, pengaturan] = await Promise.all([
    denganBatasWaktu(muatBlokKetat(sb), BATAS_MUAT_MS, null),
    denganBatasWaktu(muatLayananKetat(sb), BATAS_MUAT_MS, GAGAL_LAYANAN),
    denganBatasWaktu(muatPengaturanBeranda(sb), BATAS_MUAT_MS, null),
  ]);
  return {
    data: {
      blok: blok ?? gabungkanBlok(null),
      layanan: layanan.layanan,
      layananGalat: layanan.tingkat === 0,
      pengaturan: pengaturan ?? { ...PENGATURAN_BERANDA_BAWAAN },
    },
    lengkap: blok !== null && layanan.tingkat !== 0 && pengaturan !== null,
  };
}

const berandaBawaanGalat = (): BerandaPublik => ({
  blok: gabungkanBlok(null),
  layanan: [],
  layananGalat: true,
  pengaturan: { ...PENGATURAN_BERANDA_BAWAAN },
});

/** Beranda berisi daftar layanan, jadi ikut tag layanan: simpan layanan di Admin segera tampil di beranda. */
export const muatBerandaPublik = denganCache('beranda', [TAG_PUBLIK.beranda, TAG_PUBLIK.layanan], muatBerandaMentah, berandaBawaanGalat);

// ---------------------------------------------------------------------------------------------------------------
// Layanan publik (v_layanan_publik, fallback berlapis hanya untuk "kolom belum ada" di muatLayananKetat)
// ---------------------------------------------------------------------------------------------------------------

async function muatLayananMentah(sb: SupabaseClient): Promise<Termuat<HasilLayananPublik>> {
  const hasil = await denganBatasWaktu(muatLayananKetat(sb), BATAS_MUAT_MS, GAGAL_LAYANAN);
  const galat = hasil.tingkat === 0;
  return { data: { layanan: hasil.layanan, galat }, lengkap: !galat };
}

export const muatLayananPublik = denganCache<HasilLayananPublik>(
  'layanan',
  [TAG_PUBLIK.layanan],
  muatLayananMentah,
  () => ({ layanan: [], galat: true }),
);

// ---------------------------------------------------------------------------------------------------------------
// FAQ publik (faq_knowledge_base, RLS `faq_public_read`: aktif = true)
// ---------------------------------------------------------------------------------------------------------------

async function muatFaqMentah(sb: SupabaseClient): Promise<Termuat<HasilFaqPublik>> {
  const gagal: Termuat<HasilFaqPublik> = { data: { faq: [], galat: true }, lengkap: false };
  try {
    const { data, error } = await denganBatasWaktu<{ data: unknown; error: unknown }>(
      sb
        .from('faq_knowledge_base')
        .select(KOLOM_FAQ)
        .eq('aktif', true)
        .order('urutan', { ascending: true })
        .limit(BATAS_FAQ),
      BATAS_MUAT_MS,
      { data: null, error: 'batas waktu' },
    );
    if (error || !Array.isArray(data)) return gagal;
    const faq: FaqPublik[] = [];
    for (const r of data as unknown as Array<Record<string, unknown>>) {
      if (typeof r.id !== 'string' || typeof r.pertanyaan !== 'string' || typeof r.jawaban !== 'string') continue;
      faq.push({
        id: r.id,
        pertanyaan: r.pertanyaan,
        jawaban: r.jawaban,
        layanan_id: typeof r.layanan_id === 'string' ? r.layanan_id : null,
        urutan: typeof r.urutan === 'number' ? r.urutan : null,
      });
    }
    return { data: { faq, galat: false }, lengkap: true };
  } catch {
    return gagal;
  }
}

export const muatFaqPublik = denganCache<HasilFaqPublik>(
  'faq',
  [TAG_PUBLIK.faq],
  muatFaqMentah,
  () => ({ faq: [], galat: true }),
);

// ---------------------------------------------------------------------------------------------------------------
// Pilihan layanan formulir pengaduan (tabel layanan, RLS `layanan_public_read`: SELECT untuk semua)
// ---------------------------------------------------------------------------------------------------------------

/**
 * SENGAJA tabel `layanan` aktif = true (bukan v_layanan_publik): pilihan yang terlihat pengguna harus sama dengan
 * kueri peramban sebelumnya (layanan berstatus tampilan 'nonaktif' tetap bisa dipilih sebagai layanan terkait).
 */
async function muatOpsiLayananMentah(sb: SupabaseClient): Promise<Termuat<HasilOpsiLayananPengaduan>> {
  const gagal: Termuat<HasilOpsiLayananPengaduan> = { data: { layanan: [], galat: true }, lengkap: false };
  try {
    const { data, error } = await denganBatasWaktu<{ data: unknown; error: unknown }>(
      sb.from('layanan').select('id, nama').eq('aktif', true).order('nama').limit(BATAS_LAYANAN),
      BATAS_MUAT_MS,
      { data: null, error: 'batas waktu' },
    );
    if (error || !Array.isArray(data)) return gagal;
    const layanan: OpsiLayananPengaduan[] = [];
    for (const r of data as unknown as Array<Record<string, unknown>>) {
      if (typeof r.id === 'string' && typeof r.nama === 'string') layanan.push({ id: r.id, nama: r.nama });
    }
    return { data: { layanan, galat: false }, lengkap: true };
  } catch {
    return gagal;
  }
}

export const muatOpsiLayananPengaduan = denganCache<HasilOpsiLayananPengaduan>(
  'opsi-layanan-pengaduan',
  [TAG_PUBLIK.layanan],
  muatOpsiLayananMentah,
  () => ({ layanan: [], galat: true }),
);

// ---------------------------------------------------------------------------------------------------------------
// Transparansi: IKM publik per layanan, kuartal berjalan (hitung_ikm: SECURITY DEFINER, EXECUTE untuk anon)
// ---------------------------------------------------------------------------------------------------------------

/** Rentang kuartal berjalan menurut kalender WIB: tanggal 1 bulan awal kuartal sampai hari ini (YYYY-MM-DD). */
export function rentangKuartalWIB(sekarang: Date = new Date()): { mulai: string; selesai: string } {
  const selesai = toWIBDateString(sekarang);
  const [tahun, bulan] = selesai.split('-').map((v) => parseInt(v, 10));
  const bulanAwal = Math.floor((bulan - 1) / 3) * 3 + 1;
  return { mulai: `${tahun}-${String(bulanAwal).padStart(2, '0')}-01`, selesai };
}

const ikmKosong = (layananId: string, nama: string): IkmRow => ({ layanan_id: layananId, layanan_nama: nama, ikm: null, responden: 0 });

/**
 * SENGAJA tabel `layanan` tanpa filter aktif (hanya bukan 'modul_publik'): daftar yang terlihat pengguna sama dengan
 * kueri peramban sebelumnya. Gagal membaca satu layanan = barisnya N/A seperti sebelumnya, tetapi hasil tidak disimpan.
 */
async function muatTransparansiMentah(sb: SupabaseClient, mulai: string, selesai: string): Promise<Termuat<HasilTransparansiPublik>> {
  const diperbaruiPada = new Date().toISOString();
  const gagal: Termuat<HasilTransparansiPublik> = { data: { rows: [], diperbaruiPada, galat: true }, lengkap: false };
  try {
    const { data, error } = await denganBatasWaktu<{ data: unknown; error: unknown }>(
      sb.from('layanan').select('id, nama').neq('tipe', 'modul_publik').order('nama').limit(BATAS_LAYANAN),
      BATAS_MUAT_MS,
      { data: null, error: 'batas waktu' },
    );
    if (error || !Array.isArray(data)) return gagal;
    const daftar: OpsiLayananPengaduan[] = [];
    for (const r of data as unknown as Array<Record<string, unknown>>) {
      if (typeof r.id === 'string' && typeof r.nama === 'string') daftar.push({ id: r.id, nama: r.nama });
    }

    let nGagal = 0;
    const rows = await Promise.all(
      daftar.map(async (l): Promise<IkmRow> => {
        const { data: hasil, error: galatRpc } = await denganBatasWaktu<{ data: unknown; error: unknown }>(
          sb.rpc('hitung_ikm', { p_layanan_id: l.id, p_start: mulai, p_end: selesai }),
          BATAS_MUAT_MS,
          { data: null, error: 'batas waktu' },
        );
        if (galatRpc) {
          nGagal++;
          return ikmKosong(l.id, l.nama);
        }
        const baris = Array.isArray(hasil) ? (hasil[0] as Record<string, unknown> | undefined) : undefined;
        if (!baris) return ikmKosong(l.id, l.nama);
        const ikm = baris.ikm === null || baris.ikm === undefined ? null : Number(baris.ikm);
        return {
          layanan_id: typeof baris.layanan_id === 'string' ? baris.layanan_id : l.id,
          layanan_nama: typeof baris.layanan_nama === 'string' ? baris.layanan_nama : l.nama,
          ikm: ikm === null || Number.isNaN(ikm) ? null : ikm,
          responden: typeof baris.responden === 'number' ? baris.responden : 0,
        };
      }),
    );
    if (nGagal > 0) logServerEvent('warn', { operation: 'publik.transparansi_ikm_sebagian', nGagal });
    return { data: { rows, diperbaruiPada, galat: false }, lengkap: nGagal === 0 };
  } catch {
    return gagal;
  }
}

const transparansiBerkunci = denganCache<HasilTransparansiPublik, [string, string]>(
  'transparansi',
  [TAG_PUBLIK.transparansi, TAG_PUBLIK.layanan],
  muatTransparansiMentah,
  () => ({ rows: [], diperbaruiPada: new Date().toISOString(), galat: true }),
);

/** Rentang kuartal (WIB) menjadi argumen cache: hari atau kuartal baru otomatis entri baru, tanpa menyajikan kuartal lama. */
export function muatTransparansiPublik(): Promise<HasilTransparansiPublik> {
  const { mulai, selesai } = rentangKuartalWIB();
  return transparansiBerkunci(mulai, selesai);
}
