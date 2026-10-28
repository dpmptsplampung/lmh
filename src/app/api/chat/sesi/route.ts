import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { MutasiError, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';
import { KODE_MIGRASI_BELUM, objekBelumAda } from '@/lib/akses-data/galat';
import { kodeGalatKhusus, PESAN_GALAT_KHUSUS } from '@/lib/pendataan-khusus/galat';
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
// Fase 4: identitas pengunjung chat (Pendataan Umum; kosong = tidak diubah, divalidasi DB) dan jawaban Pendataan Khusus
// ({ "<id isian>": nilai }, divalidasi DB terhadap definisi Layanan).
const identitasSchema = z
  .object({
    nama: z.string().max(200).optional(),
    kontak_hp: z.string().max(40).optional(),
    email: z.string().max(300).optional(),
    asal_instansi: z.string().max(300).optional(),
    kategori: z.string().max(40).optional(),
    keperluan: z.string().max(1000).optional(),
  })
  .strict();
const khususSchema = z.record(z.string().max(64), z.unknown());
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
    khusus: khususSchema.optional(),
    identitas: identitasSchema.optional(),
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
        : input.khusus !== undefined || input.identitas !== undefined
          ? [
              // Fase 4 (migrasi 202610300002): selesai + identitas + Pendataan Khusus dalam satu transaksi.
              'chat_selesai_khusus',
              {
                p_sesi_id: input.sesi_id,
                p_topik_id: input.topik_id,
                p_catatan: input.catatan.trim(),
                p_khusus: input.khusus ?? null,
                p_identitas: input.identitas ?? null,
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
    if (objekBelumAda(e instanceof MutasiError ? e.asal : e)) {
      return NextResponse.json(
        { error: 'Pendataan Khusus belum tersedia: migrasi 202610300001/0002 belum diterapkan.', kode: KODE_MIGRASI_BELUM },
        { status: 409 },
      );
    }
    const kodeKhusus = kodeGalatKhusus(e);
    if (kodeKhusus) {
      return NextResponse.json({ error: PESAN_GALAT_KHUSUS[kodeKhusus], kode: kodeKhusus }, { status: 422 });
    }
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
