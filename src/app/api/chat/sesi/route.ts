import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { MutasiError, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';
import {
  kodeGalatChat,
  PESAN_GALAT_CHAT,
  statusHttpGalatChat,
  type KodeGalatChat,
} from '@/lib/chat-staf';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/chat/sesi';

// Aksi staf atas sesi chat (Tahap C, kontrak docs/analysis/FO-CHAT-KONTRAK-RPC.md §5): ambil (`takeover`), teruskan ke
// layanan (`teruskan`), selesaikan (`selesaikan`). Seluruhnya lewat RPC chat_ambil / chat_teruskan / chat_selesai yang
// berjalan atas nama PENGGUNA (klien ber-JWT, bukan service_role): RPC membaca auth.uid() dan sesi_valid(), memeriksa
// peran/kepemilikan, dan menulis pesan sistem + audit_log dalam satu transaksi. Route TIDAK menulis tabel apa pun
// sendiri (DB menolak perubahan langsung chat_sesi.status/ditangani_oleh dengan CHAT_HARUS_RPC).
// "Kembali ke bot" tidak lagi didukung DB (kontrak §3): dijawab 410 dengan pesan jelas.

const sesiId = z.string().uuid();
const bodySchema = z.discriminatedUnion('aksi', [
  z.object({
    sesi_id: sesiId,
    aksi: z.literal('takeover'),
    // Hanya relevan saat Admin merebut chat yang sedang dipegang staf lain (5-500, divalidasi DB).
    alasan: z.string().max(1000).optional(),
  }),
  z.object({
    sesi_id: sesiId,
    aksi: z.literal('teruskan'),
    layanan_id: z.string().uuid(),
    topik_id: z.string().uuid(),
    catatan: z.string().max(5000),
  }),
  z.object({
    sesi_id: sesiId,
    aksi: z.literal('selesaikan'),
    topik_id: z.string().uuid(),
    catatan: z.string().max(5000),
  }),
]);

type Body = z.infer<typeof bodySchema>;

function galat(kode: KodeGalatChat | null, status: number, pesan?: string) {
  return NextResponse.json(
    { error: pesan ?? (kode ? PESAN_GALAT_CHAT[kode] : 'Terjadi kesalahan, coba lagi.'), ...(kode ? { kode } : {}) },
    { status },
  );
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body === 'object' && body !== null && (body as { aksi?: unknown }).aksi === 'kembali_ke_bot') {
    return galat(
      'AKSI_TIDAK_DIDUKUNG',
      410,
      'Aksi "kembalikan ke bot" tidak lagi didukung. Selesaikan chat, atau teruskan ke layanan terkait.',
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }
  const input: Body = parsed.data;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [nama, args]: [string, Record<string, unknown>] =
    input.aksi === 'takeover'
      ? ['chat_ambil', { p_sesi_id: input.sesi_id, p_alasan: input.alasan?.trim() || null }]
      : input.aksi === 'teruskan'
        ? [
            'chat_teruskan',
            {
              p_sesi_id: input.sesi_id,
              p_layanan_id: input.layanan_id,
              p_topik_id: input.topik_id,
              p_catatan: input.catatan.trim(),
            },
          ]
        : [
            'chat_selesai',
            { p_sesi_id: input.sesi_id, p_topik_id: input.topik_id, p_catatan: input.catatan.trim() },
          ];

  try {
    const [data] = await mutasiWajibBaris<Record<string, unknown>>(supabase.rpc(nama, args));
    if (!data || data.ok !== true) {
      catatMutasi('error', `chat.sesi.${input.aksi}`, ROUTE, new MutasiError('database', { asal: { code: 'RESPON_TIDAK_VALID' } }));
      return NextResponse.json({ error: 'Gagal memproses chat' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, aksi: input.aksi, data });
  } catch (e) {
    const kode = kodeGalatChat(e);
    if (kode) {
      if (kode === 'DIVERGENSI') catatMutasi('error', `chat.sesi.${input.aksi}`, ROUTE, e);
      return galat(kode, statusHttpGalatChat(kode));
    }
    catatMutasi('error', `chat.sesi.${input.aksi}`, ROUTE, e);
    if (e instanceof MutasiError && e.kode === 'jaringan') {
      return NextResponse.json({ error: e.pesan }, { status: 503 });
    }
    return NextResponse.json({ error: 'Gagal memproses chat' }, { status: 500 });
  }
}
