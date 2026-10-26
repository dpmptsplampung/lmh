// Pemuat data etalase homepage (dipakai client component `/`). Prinsip: TIDAK PERNAH melempar dan tidak
// pernah membuat homepage 500 bila migrasi belum diterapkan; tiap pemuat turun ke bawaan/tingkat lebih lama.
//  - muatBlok: tabel homepage_blok (202610280001) belum ada -> blok bawaan.
//  - muatLayanan: v_layanan_publik 3 tingkat: lengkap (202610280001) -> kolom Fase 1 (202610270001) -> kolom lama.
//  - muatStatusHariIni: RPC layanan_status_hari_ini() belum ada -> null (status dihilangkan, bukan ditebak).
import type { SupabaseClient } from '@supabase/supabase-js';
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
export async function muatLayanan(sb: SupabaseClient): Promise<{ layanan: LayananEtalase[]; tingkat: 0 | 1 | 2 | 3 }> {
  const tingkat = [
    { kolom: KOLOM_LENGKAP, turunkan: false },
    { kolom: KOLOM_FASE1, turunkan: false },
    { kolom: KOLOM_LAMA, turunkan: true },
  ] as const;
  for (let i = 0; i < tingkat.length; i++) {
    try {
      const { data, error } = await sb.from('v_layanan_publik').select(tingkat[i].kolom);
      if (!error && Array.isArray(data)) {
        return { layanan: petakan(data as unknown as BarisView[], tingkat[i].turunkan), tingkat: (i + 1) as 1 | 2 | 3 };
      }
    } catch {
      /* coba tingkat berikutnya */
    }
  }
  return { layanan: [], tingkat: 0 };
}

/** Blok homepage tersusun (semua jenis; yang mati ditandai aktif=false). Galat apa pun -> bawaan. */
export async function muatBlok(sb: SupabaseClient): Promise<BlokTersusun[]> {
  try {
    const { data, error } = await sb.from('homepage_blok').select('jenis, aktif, urutan, teks');
    if (error || !Array.isArray(data)) return gabungkanBlok(null);
    return gabungkanBlok(data as BarisBlok[]);
  } catch {
    return gabungkanBlok(null);
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
