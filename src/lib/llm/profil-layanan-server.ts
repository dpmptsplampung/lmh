// Pemuat Profil Layanan untuk bot (server-only): dipakai bersama oleh /api/chat/ai dan "Coba tanya bot" admin
// supaya pratinjau admin = jawaban yang dilihat pengunjung. Toleran galat: kolom/relasi profil belum termigrasi
// atau DB sesaat bermasalah -> catat, ulangi tanpa kolom profil (profil kosong); jadwal gagal dibaca = daftar kosong.
import type { SupabaseClient } from '@supabase/supabase-js';
import { logServerEvent } from '@/lib/observability/logger';
import type { JadwalProfil, ProfilLayanan } from '@/lib/llm/profil-layanan';

export type LayananProfilRow = {
  nama: string;
  chatbot_aktif?: boolean | null;
  deskripsi?: string | null;
  slug?: string | null;
  instansi?: { nama?: string | null } | Array<{ nama?: string | null }> | null;
  layanan_tautan?: Array<{ label: string; url: string; urut?: number | null }> | null;
};

export type HasilMuatLayanan =
  | { ok: true; layanan: { nama: string; chatbot_aktif?: boolean | null }; profil: ProfilLayanan }
  | { ok: false; status: 404 | 503 };

const SELECT_PROFIL = 'nama, chatbot_aktif, deskripsi, slug, instansi:instansi_id(nama), layanan_tautan(label, url, urut)';
const SELECT_DASAR = 'nama, chatbot_aktif';

function cause(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

// Baris layanan (embed PostgREST) -> profil untuk bot. Tautan diurutkan menurut `urut` di sini (urutan embed
// tidak dijamin). Kolom/relasi kosong atau tak ada pada baris = profil kosong.
export function susunProfilLayanan(row: LayananProfilRow, jadwal: JadwalProfil[] = []): ProfilLayanan {
  const inst = Array.isArray(row.instansi) ? row.instansi[0] : row.instansi;
  const tautan = [...(row.layanan_tautan ?? [])].sort((a, b) => (a.urut ?? 0) - (b.urut ?? 0));
  return {
    nama: row.nama,
    instansi: inst?.nama ?? null,
    deskripsi: row.deskripsi ?? null,
    ...(row.slug ? { slug: row.slug } : {}),
    websiteTerkait: tautan.map((t) => ({ label: t.label, url: t.url })),
    jadwal,
  };
}

const hhmm = (v: unknown): string => String(v ?? '').slice(0, 5);

// Jadwal mingguan aktif (jadwal_standby) layanan, urut hari. Galat/format tak terduga = [] (dicatat).
async function muatJadwal(admin: SupabaseClient, layananId: string, route: string, sesiId?: string): Promise<JadwalProfil[]> {
  try {
    const { data, error } = await admin
      .from('jadwal_standby')
      .select('hari, jam_mulai, jam_selesai')
      .eq('layanan_id', layananId)
      .eq('aktif', true)
      .order('hari', { ascending: true });
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []) as Array<{ hari: number; jam_mulai: string; jam_selesai: string }>;
    return rows
      .filter((r) => Number.isInteger(r.hari) && r.hari >= 1 && r.hari <= 7)
      .sort((a, b) => a.hari - b.hari)
      .map((r) => ({ hari: r.hari, jamMulai: hhmm(r.jam_mulai), jamSelesai: hhmm(r.jam_selesai) }));
  } catch (e) {
    logServerEvent('error', { operation: 'bot.layanan_jadwal', route, sesiId, cause: cause(e) });
    return [];
  }
}

export async function muatLayananDanProfil(
  admin: SupabaseClient,
  layananId: string,
  ctx: { route: string; sesiId?: string },
): Promise<HasilMuatLayanan> {
  const primer = await admin.from('layanan').select(SELECT_PROFIL).eq('id', layananId).single();
  let row = primer.data as LayananProfilRow | null;
  // Galat selain "baris tidak ada" (PGRST116): catat, ulangi sekali tanpa kolom profil. Gagal lagi = 503, bukan 404.
  if (primer.error && primer.error.code !== 'PGRST116') {
    logServerEvent('error', {
      operation: 'chat.ai.layanan_profil', route: ctx.route, sesiId: ctx.sesiId, cause: cause(primer.error.message),
    });
    const fallback = await admin.from('layanan').select(SELECT_DASAR).eq('id', layananId).single();
    if (fallback.error && fallback.error.code !== 'PGRST116') {
      logServerEvent('error', {
        operation: 'chat.ai.layanan', route: ctx.route, sesiId: ctx.sesiId, cause: cause(fallback.error.message),
      });
      return { ok: false, status: 503 };
    }
    row = fallback.data as LayananProfilRow | null;
  }
  if (!row) return { ok: false, status: 404 };
  const jadwal = await muatJadwal(admin, layananId, ctx.route, ctx.sesiId);
  return {
    ok: true,
    layanan: { nama: row.nama, chatbot_aktif: row.chatbot_aktif },
    profil: susunProfilLayanan(row, jadwal),
  };
}
