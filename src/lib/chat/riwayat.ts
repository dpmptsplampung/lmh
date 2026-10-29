// Riwayat percakapan lintas sesi (Fase 5): semua pesan dari semua sesi (pengunjung, Layanan) yang sama. Dipanggil route
// SETELAH otorisasi (pemilik sesi, atau staf lolos boleh_chat_sesi); klien `admin` = service-role.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatMsg } from '@/app/chat/merge';

export const LIMIT_RIWAYAT_DEFAULT = 100;
export const LIMIT_RIWAYAT_MAKS = 200;

export interface HasilRiwayat {
  messages: ChatMsg[];
  adaLebih: boolean;
  sesiTerbukaId: string | null;
}

const KOLOM = 'id, sesi_id, pengirim, isi, created_at, client_uuid, jenis_jawaban, lampiran_kunci, lampiran_mime, lampiran_ukuran, lampiran_nama';

export function batasRiwayat(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return LIMIT_RIWAYAT_DEFAULT;
  return Math.min(Math.floor(n), LIMIT_RIWAYAT_MAKS);
}

export async function muatRiwayatPercakapan(
  admin: SupabaseClient,
  jangkar: { pengunjung_id: string; layanan_id: string },
  opsi: { sebelum?: string | null; limit?: number } = {},
): Promise<HasilRiwayat> {
  const limit = batasRiwayat(opsi.limit);
  let q = admin
    .from('chat_pesan')
    .select(`${KOLOM}, chat_sesi!inner(pengunjung_id, layanan_id)`)
    .eq('chat_sesi.pengunjung_id', jangkar.pengunjung_id)
    .eq('chat_sesi.layanan_id', jangkar.layanan_id);
  if (opsi.sebelum) q = q.lt('created_at', opsi.sebelum);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit + 1);
  if (error) throw new Error('riwayat gagal dimuat');

  const baris = (data ?? []) as Array<ChatMsg & { sesi_id: string; chat_sesi?: unknown }>;
  const adaLebih = baris.length > limit;
  const messages = baris
    .slice(0, limit)
    .reverse()
    .map((r) => {
      const { chat_sesi: _gabung, ...pesan } = r;
      void _gabung;
      return pesan as ChatMsg;
    });

  const { data: terbuka } = await admin
    .from('chat_sesi')
    .select('id')
    .eq('pengunjung_id', jangkar.pengunjung_id)
    .eq('layanan_id', jangkar.layanan_id)
    .neq('status', 'selesai')
    .order('created_at', { ascending: false })
    .limit(1);
  const sesiTerbukaId = Array.isArray(terbuka) && terbuka[0] ? ((terbuka[0] as { id: string }).id ?? null) : null;

  return { messages, adaLebih, sesiTerbukaId };
}
