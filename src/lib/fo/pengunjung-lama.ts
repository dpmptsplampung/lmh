// Bantuan "pintar" untuk formulir walk-in FO: mengenali pengunjung yang pernah datang (dari nomor HP / email) dan
// menyarankan asal/instansi yang sering dipakai. Ini fitur PEMBANTU, bukan penghalang: semua kegagalan ditelan dan
// menghasilkan "tidak ada hasil". Hanya membaca kolom minimal dari `kunjungan`, yang memang boleh dibaca semua
// Front Office (RLS boleh_kunjungan; keputusan keterbukaan data antar FO 2026-10-14).
import type { SupabaseClient } from '@supabase/supabase-js';
import { KATEGORI_WALKIN } from '@/lib/fo/walkin';

export interface PengunjungLama {
  nama: string;
  asal_instansi: string;
  /** Kategori hanya bila termasuk nilai yang dikenal; selain itu ''. */
  kategori: string;
  email: string;
  kontak_hp: string;
  /** Tanggal kunjungan terakhir (YYYY-MM-DD, WIB). */
  tanggal: string;
}

type KlienBaca = Pick<SupabaseClient, 'from'>;

const KOLOM = 'nama, asal_instansi, kategori, email, kontak_hp, tanggal';

const teks = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Bentuk penulisan yang mungkin tersimpan untuk nomor kanonik 08xx: 08xx, 628xx, +628xx. */
export function varianHp(kanonik: string): string[] {
  if (!kanonik.startsWith('0')) return [kanonik];
  const tanpaNol = kanonik.slice(1);
  return [kanonik, `62${tanpaNol}`, `+62${tanpaNol}`];
}

function petakan(baris: unknown): PengunjungLama | null {
  if (typeof baris !== 'object' || baris === null) return null;
  const r = baris as Record<string, unknown>;
  const nama = teks(r.nama);
  const asal = teks(r.asal_instansi);
  if (!nama || !asal) return null;
  const kategori = teks(r.kategori);
  return {
    nama,
    asal_instansi: asal,
    kategori: (KATEGORI_WALKIN as string[]).includes(kategori) ? kategori : '',
    email: teks(r.email),
    kontak_hp: teks(r.kontak_hp),
    tanggal: teks(r.tanggal),
  };
}

/**
 * Kunjungan terakhir dengan HP kanonik atau email (huruf kecil) yang sama. HP didahulukan. null bila tidak ada,
 * parameter kosong, atau query gagal.
 */
export async function cariPengunjungLama(
  supabase: KlienBaca,
  kunci: { hp?: string | null; email?: string | null },
): Promise<PengunjungLama | null> {
  const percobaan: Array<() => PromiseLike<{ data: unknown; error: unknown }>> = [];
  if (kunci.hp) {
    const hp = kunci.hp;
    percobaan.push(() =>
      supabase
        .from('kunjungan')
        .select(KOLOM)
        .in('kontak_hp', varianHp(hp))
        .not('asal_instansi', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1),
    );
  }
  if (kunci.email) {
    const email = kunci.email;
    percobaan.push(() =>
      supabase
        .from('kunjungan')
        .select(KOLOM)
        .eq('email', email)
        .not('asal_instansi', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1),
    );
  }
  for (const jalankan of percobaan) {
    try {
      const { data, error } = await jalankan();
      if (error || !Array.isArray(data)) continue;
      const hasil = petakan(data[0]);
      if (hasil) return hasil;
    } catch {
      // fitur bantuan: diam-diam
    }
  }
  return null;
}

/** Asal/instansi yang paling baru dipakai (unik tanpa membedakan huruf besar/kecil), untuk datalist. */
export async function muatAsalSering(supabase: KlienBaca, batas = 50): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('kunjungan')
      .select('asal_instansi')
      .not('asal_instansi', 'is', null)
      .order('created_at', { ascending: false })
      .limit(batas * 8);
    if (error || !Array.isArray(data)) return [];
    const lihat = new Set<string>();
    const hasil: string[] = [];
    for (const baris of data as Array<{ asal_instansi?: unknown }>) {
      const a = teks(baris.asal_instansi);
      const kunci = a.toLowerCase();
      if (a.length < 3 || lihat.has(kunci)) continue;
      lihat.add(kunci);
      hasil.push(a);
      if (hasil.length >= batas) break;
    }
    return hasil;
  } catch {
    return [];
  }
}
