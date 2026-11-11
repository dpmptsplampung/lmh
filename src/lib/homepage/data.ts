// Pemuat data etalase homepage. Semua pemuat menerima SupabaseClient sebagai argumen: server beranda
// (lib/data/publik-server.ts) menyuntikkan klien anon tanpa cookie, pulau klien menyuntikkan klien peramban.
// Prinsip: TIDAK PERNAH melempar dan tidak pernah membuat homepage 500 bila migrasi belum diterapkan; tiap
// pemuat turun ke bawaan/tingkat lebih lama.
//  - muatBlok: tabel homepage_blok (202610280001) belum ada -> blok bawaan.
//  - muatLayanan: v_layanan_publik 3 tingkat: lengkap (202610280001) -> kolom Fase 1 (202610270001) -> kolom lama.
//    Kedua pemuat di atas turun pada galat APA PUN (jalur klien lama). Varian *Ketat (jalur server ber-cache) turun HANYA
//    untuk "objek belum ada" (migrasi belum diterapkan: bentuk tetap, boleh di-cache); galat lain (503, jaringan, batas
//    waktu) ditandai gagal agar bawaan/tingkat lebih lama dari galat SESAAT tidak ikut tersimpan sebagai hasil lengkap.
//  - muatStatusHariIni: RPC layanan_status_hari_ini() belum ada -> null (status dihilangkan, bukan ditebak).
//  - muatPengaturanBeranda: site_settings (WhatsApp + kontak footer) gagal dibaca -> konstanta bawaan.
import type { SupabaseClient } from '@supabase/supabase-js';
import { objekBelumAda } from '@/lib/akses-data/galat';
import { CONTACT_EMAIL_FALLBACK, WA_DEFAULT_MESSAGE, WA_NUMBER } from '@/lib/constants';
import type { JadwalHari } from '@/lib/jadwal-teks';
import { gabungkanBlok, type BarisBlok, type BlokTersusun } from './blok';

export type TautanTerkait = { label: string; url: string };

export type LayananEtalase = {
  id: string;
  nama: string;
  slug: string;
  deskripsi: string | null;
  urutan: number;
  instansi: string | null;
  instansiSingkatan: string | null;
  websiteTerkait: TautanTerkait[];
  statusTampilan: 'aktif' | 'coming_soon';
  punyaAntrean: boolean;
  punyaChat: boolean;
  /** false = tanpa kartu, tetapi popup /?layanan=<slug> tetap bisa dibuka. */
  tampilDiHomepage: boolean;
};

export type StatusHariIni = {
  buka: boolean;
  liburKeterangan: string | null;
  jadwal: JadwalHari[];
};

export type AntreanLayanan = { antre: number; dilayani: number; estimasiTungguMenit: number };

/** Batas tunggu tiap pemuat etalase sebelum memakai bawaan (server beranda dan pulau klien). */
export const BATAS_MUAT_MS = 6000;

/** Kunci site_settings yang dipakai beranda (tombol WhatsApp hero + kontak footer). Hanya ini yang dibaca. */
export const KUNCI_PENGATURAN_BERANDA = [
  'wa_number',
  'wa_default_message',
  'contact_address',
  'contact_hours',
  'contact_email',
] as const;
export type PengaturanBeranda = Record<(typeof KUNCI_PENGATURAN_BERANDA)[number], string>;

/** Nilai bila site_settings kosong/gagal dibaca (selaras SITE_SETTING_DEFAULTS di lib/site-settings.ts). */
export const PENGATURAN_BERANDA_BAWAAN: Readonly<PengaturanBeranda> = {
  wa_number: WA_NUMBER,
  wa_default_message: WA_DEFAULT_MESSAGE,
  contact_address: '',
  contact_hours: '',
  contact_email: CONTACT_EMAIL_FALLBACK,
};

const KOLOM_FASE1 =
  'id, nama, slug, deskripsi, urutan, instansi_nama, instansi_singkatan, website_terkait, status_tampilan, punya_antrean, punya_chat';
const KOLOM_LENGKAP = `${KOLOM_FASE1}, tampil_di_homepage`;
const KOLOM_LAMA = 'id, nama, status_tampilan, punya_antrean, punya_chat';

/**
 * Menunggu `janji` paling lama `ms`; lewat batas atau menolak -> `bawaan`. Dipakai halaman agar permintaan yang
 * menggantung tidak membuat homepage "Memuat…" selamanya (bawaan: blok default, daftar layanan kosong, tanpa status).
 */
export function denganBatasWaktu<T>(janji: PromiseLike<T>, ms: number, bawaan: T): Promise<T> {
  return new Promise<T>((selesai) => {
    const pewaktu = setTimeout(() => selesai(bawaan), ms);
    Promise.resolve(janji).then(
      (nilai) => {
        clearTimeout(pewaktu);
        selesai(nilai);
      },
      () => {
        clearTimeout(pewaktu);
        selesai(bawaan);
      },
    );
  });
}

/** Sama dengan public.slug_dari_nama di DB (huruf kecil; non [a-z0-9] -> '-'; fallback 'layanan'). */
export function slugDariNama(nama: string): string {
  return nama.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'layanan';
}

const IKON = ['ClipboardCheck', 'Shield', 'HeartHandshake', 'Store', 'FileText', 'Building2', 'Sparkles'] as const;
const WARNA = ['serviceIconPrimary', 'serviceIconSuccess', 'serviceIconAccent'] as const;

/** Ikon + warna kartu dipilih deterministik dari slug (tidak ada kolom ikon). */
export function ikonKartu(slug: string): { ikon: (typeof IKON)[number]; warna: (typeof WARNA)[number] } {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return { ikon: IKON[h % IKON.length], warna: WARNA[Math.floor(h / IKON.length) % WARNA.length] };
}

type BarisView = Record<string, unknown>;

const teks = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function tautanValid(v: unknown): TautanTerkait[] {
  if (!Array.isArray(v)) return [];
  const hasil: TautanTerkait[] = [];
  for (const t of v) {
    const label = teks((t as { label?: unknown })?.label);
    const url = teks((t as { url?: unknown })?.url);
    if (label && url && /^https:\/\/\S+$/.test(url)) hasil.push({ label, url });
  }
  return hasil;
}

function petakan(rows: BarisView[], turunkanSlug: boolean): LayananEtalase[] {
  const dipakai = new Set<string>();
  const hasil: LayananEtalase[] = [];
  for (const r of rows) {
    const id = teks(r.id);
    const nama = teks(r.nama);
    if (!id || !nama) continue;
    let slug = turunkanSlug ? null : teks(r.slug);
    if (!slug) {
      const dasar = slugDariNama(nama);
      slug = dasar;
      for (let n = 2; dipakai.has(slug); n++) slug = `${dasar}-${n}`;
    }
    dipakai.add(slug);
    hasil.push({
      id,
      nama,
      slug,
      deskripsi: teks(r.deskripsi),
      urutan: typeof r.urutan === 'number' ? r.urutan : 100,
      instansi: teks(r.instansi_nama),
      instansiSingkatan: teks(r.instansi_singkatan),
      websiteTerkait: tautanValid(r.website_terkait),
      statusTampilan: r.status_tampilan === 'coming_soon' ? 'coming_soon' : 'aktif',
      punyaAntrean: r.punya_antrean !== false,
      punyaChat: r.punya_chat !== false,
      tampilDiHomepage: r.tampil_di_homepage !== false,
    });
  }
  return hasil.sort((a, b) => a.urutan - b.urutan || a.nama.localeCompare(b.nama, 'id'));
}

/**
 * Layanan publik (aktif, bukan nonaktif). Mencoba 3 tingkat kolom; `tingkat` 0 = semuanya gagal (daftar kosong).
 * Tingkat 3 (view sebelum Fase 1) menurunkan slug dari nama di klien.
 */
export interface HasilLayanan {
  layanan: LayananEtalase[];
  tingkat: 0 | 1 | 2 | 3;
}

/**
 * Hasil "gagal memuat" (tingkat 0). Pemuat dan batas waktu jatuh ke nilai ini; halaman membacanya sebagai GALAT
 * (`tingkat === 0`) dan menawarkan Coba lagi, BUKAN sebagai "memang belum ada layanan" (tingkat >= 1 dengan daftar kosong).
 */
export const GAGAL_LAYANAN: HasilLayanan = { layanan: [], tingkat: 0 };

const TINGKAT_LAYANAN = [
  { kolom: KOLOM_LENGKAP, turunkan: false },
  { kolom: KOLOM_FASE1, turunkan: false },
  { kolom: KOLOM_LAMA, turunkan: true },
] as const;

/**
 * `ketat` = turun ke tingkat berikutnya HANYA bila galatnya "objek belum ada" (kolom/tabel/view: objekBelumAda);
 * galat lain atau lemparan -> GAGAL_LAYANAN seketika. Tanpa `ketat` (perilaku lama): galat apa pun -> tingkat berikutnya.
 */
async function jalankanMuatLayanan(sb: SupabaseClient, ketat: boolean): Promise<HasilLayanan> {
  for (let i = 0; i < TINGKAT_LAYANAN.length; i++) {
    try {
      const { data, error } = await sb.from('v_layanan_publik').select(TINGKAT_LAYANAN[i].kolom);
      if (!error && Array.isArray(data)) {
        return {
          layanan: petakan(data as unknown as BarisView[], TINGKAT_LAYANAN[i].turunkan),
          tingkat: (i + 1) as 1 | 2 | 3,
        };
      }
      if (ketat && !objekBelumAda(error)) return GAGAL_LAYANAN;
    } catch {
      if (ketat) return GAGAL_LAYANAN;
      /* coba tingkat berikutnya */
    }
  }
  return GAGAL_LAYANAN;
}

export function muatLayanan(sb: SupabaseClient): Promise<HasilLayanan> {
  return jalankanMuatLayanan(sb, false);
}

/**
 * Seperti muatLayanan, tetapi tidak turun diam-diam pada galat sesaat (mis. 503): tingkat 2 tidak punya
 * `tampil_di_homepage`, jadi layanan yang disembunyikan admin akan muncul lagi. Dipakai jalur server ber-cache.
 */
export function muatLayananKetat(sb: SupabaseClient): Promise<HasilLayanan> {
  return jalankanMuatLayanan(sb, true);
}

/**
 * Blok homepage tersusun untuk jalur ber-cache. null = GAGAL dibaca (503, jaringan, lemparan, bentuk tak terduga):
 * pemanggil memakai bawaan untuk sekali ini dan tidak menyimpannya. Tabel belum ada (objekBelumAda) = bentuk tetap,
 * hasilnya blok bawaan yang sah (bukan null).
 */
export async function muatBlokKetat(sb: SupabaseClient): Promise<BlokTersusun[] | null> {
  try {
    const { data, error } = await sb.from('homepage_blok').select('jenis, aktif, urutan, teks');
    if (error) return objekBelumAda(error) ? gabungkanBlok(null) : null;
    if (!Array.isArray(data)) return null;
    return gabungkanBlok(data as BarisBlok[]);
  } catch {
    return null;
  }
}

/** Blok homepage tersusun (semua jenis; yang mati ditandai aktif=false). Galat apa pun -> bawaan. */
export async function muatBlok(sb: SupabaseClient): Promise<BlokTersusun[]> {
  return (await muatBlokKetat(sb)) ?? gabungkanBlok(null);
}

/**
 * Pengaturan situs untuk beranda (site_settings dibaca publik oleh RLS `settings_public_read`). Hanya lima kunci
 * di KUNCI_PENGATURAN_BERANDA yang diminta; nilai kosong/spasi memakai bawaan (sama dengan getSiteSettings).
 * Galat/lemparan -> null (seperti muatStatusHariIni): pemanggil memakai PENGATURAN_BERANDA_BAWAAN dan, bila
 * hasilnya akan di-cache, TIDAK menyimpannya. Menerima klien agar bisa dipakai klien anon di server (tanpa cookie).
 */
export async function muatPengaturanBeranda(sb: SupabaseClient): Promise<PengaturanBeranda | null> {
  try {
    const { data, error } = await sb
      .from('site_settings')
      .select('key, value')
      .in('key', [...KUNCI_PENGATURAN_BERANDA])
      .limit(KUNCI_PENGATURAN_BERANDA.length);
    if (error || !Array.isArray(data)) return null;
    const hasil: PengaturanBeranda = { ...PENGATURAN_BERANDA_BAWAAN };
    for (const r of data as Array<{ key: string; value: string | null }>) {
      const kunci = KUNCI_PENGATURAN_BERANDA.find((k) => k === r.key);
      if (kunci && typeof r.value === 'string' && r.value.trim() !== '') hasil[kunci] = r.value;
    }
    return hasil;
  } catch {
    return null;
  }
}

/** Status buka/tutup hari ini + jadwal mingguan per layanan lewat RPC layanan_status_hari_ini(); gagal -> null. */
export async function muatStatusHariIni(sb: SupabaseClient): Promise<Map<string, StatusHariIni> | null> {
  try {
    const { data, error } = await sb.rpc('layanan_status_hari_ini');
    if (error || !Array.isArray(data)) return null;
    const peta = new Map<string, StatusHariIni>();
    for (const r of data as BarisView[]) {
      const id = teks(r.layanan_id);
      if (!id) continue;
      const jadwal: JadwalHari[] = [];
      if (Array.isArray(r.jadwal)) {
        for (const j of r.jadwal as Array<{ hari?: unknown; jam_mulai?: unknown; jam_selesai?: unknown }>) {
          if (typeof j.hari === 'number' && typeof j.jam_mulai === 'string' && typeof j.jam_selesai === 'string') {
            jadwal.push({ hari: j.hari, jamMulai: j.jam_mulai, jamSelesai: j.jam_selesai });
          }
        }
      }
      peta.set(id, { buka: r.buka_sekarang === true, liburKeterangan: teks(r.libur_keterangan), jadwal });
    }
    return peta;
  } catch {
    return null;
  }
}

/** Antrean saat ini per layanan (v_antrian_loket, dibaca anon); gagal -> null. */
export async function muatAntrean(sb: SupabaseClient): Promise<Map<string, AntreanLayanan> | null> {
  try {
    const { data, error } = await sb
      .from('v_antrian_loket')
      .select('layanan_id, antre_count, dilayani_count, estimasi_tunggu_total_menit');
    if (error || !Array.isArray(data)) return null;
    const peta = new Map<string, AntreanLayanan>();
    for (const r of data as BarisView[]) {
      const id = teks(r.layanan_id);
      if (!id) continue;
      peta.set(id, {
        antre: Number(r.antre_count) || 0,
        dilayani: Number(r.dilayani_count) || 0,
        estimasiTungguMenit: Number(r.estimasi_tunggu_total_menit) || 0,
      });
    }
    return peta;
  } catch {
    return null;
  }
}
