import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { MutasiError, mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';
import { bolehAksesSesiStaf, bolehRiwayatPenuh } from '@/lib/chat/akses';
import { objekBelumAda } from '@/lib/akses-data/galat';
import { muatRiwayatPercakapan } from '@/lib/chat/riwayat';

export const dynamic = 'force-dynamic';

// P0: service-role only after an authorized, ownership-checked write.
// Auth + ownership are enforced explicitly — never trust client-supplied pengirim.
// Realtime kini disiarkan oleh database (migrasi 202609230001) dan/atau
// ditarik via polling — bukan per-request dari serverless (rapuh & timeout).

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

const getQuerySchema = z.object({
  sesi_id: z.string().uuid(),
  // Fase 5: riwayat percakapan lintas sesi (semua sesi pengunjung + Layanan yang sama), dipaginasi mundur.
  riwayat: z.enum(['1']).optional(),
  sebelum: z.string().datetime({ offset: true }).optional(),
  limit: z.string().regex(/^\d{1,3}$/).optional(),
});

// pengirim is derived server-side; body only carries sesi_id + isi.
const postBodySchema = z.object({
  sesi_id: z.string().uuid(),
  isi: z.string().min(1).max(2000),
  // Accepted for backward-compat with clients; ignored for authorization.
  pengirim: z.enum(['pengunjung', 'petugas', 'bot']).optional(),
  // Idempotency: client-generated UUID for optimistic-dedup across broadcast.
  client_uuid: z.string().uuid().optional(),
});

type Actor =
  | { kind: 'staff'; role: 'admin' | 'petugas' | 'front_office'; layananId: string | null; petugasId?: string }
  | { kind: 'pengunjung'; pengunjungId: string };

export async function resolveActor(
  adminClient: NonNullable<ReturnType<typeof getServiceClient>>,
  authUserId: string,
): Promise<Actor | null> {
  const { data: petugas } = await adminClient
    .from('petugas')
    .select('id, role, layanan_id, aktif')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  // Petugas nonaktif tidak boleh bertindak sebagai staf (maupun pengunjung).
  if (petugas && petugas.aktif === false) return null;

  if (petugas && (petugas.role === 'admin' || petugas.role === 'petugas' || petugas.role === 'front_office')) {
    return {
      kind: 'staff',
      role: petugas.role,
      layananId: petugas.layanan_id ?? null,
      petugasId: petugas.id,
    };
  }

  const { data: pengunjung } = await adminClient
    .from('pengunjung')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (!pengunjung) return null;
  return { kind: 'pengunjung', pengunjungId: pengunjung.id };
}

export function canAccessSesi(
  actor: Actor,
  sesi: { pengunjung_id: string | null; layanan_id: string | null },
): boolean {
  if (actor.kind === 'staff') {
    // Admin & FO punya pandangan lintas-layanan (CHT-08 takeover); petugas hanya layanannya.
    if (actor.role === 'admin' || actor.role === 'front_office') return true;
    return !!actor.layananId && actor.layananId === sesi.layanan_id;
  }
  return !!sesi.pengunjung_id && sesi.pengunjung_id === actor.pengunjungId;
}

/** Pengunjung: pemilik sesi. Staf: lingkup DB (boleh_chat_sesi, Fase 5) dengan JWT pengguna; aturan TS lama bila RPC belum ada. */
async function bolehAkses(
  serverClient: Awaited<ReturnType<typeof createServerClient>>,
  actor: Actor,
  sesi: { id: string; pengunjung_id: string | null; layanan_id: string | null },
): Promise<boolean> {
  if (actor.kind !== 'staff') return canAccessSesi(actor, sesi);
  return bolehAksesSesiStaf(serverClient, sesi.id, () => canAccessSesi(actor, sesi));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    sesi_id: searchParams.get('sesi_id'),
    riwayat: searchParams.get('riwayat') ?? undefined,
    sebelum: searchParams.get('sebelum') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Valid sesi_id is required' }, { status: 400 });
  }

  const serverClient = await createServerClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminClient = getServiceClient();
  if (!adminClient) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const actor = await resolveActor(adminClient, user.id);
  if (!actor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: sesiData, error: sesiErr } = await adminClient
    .from('chat_sesi')
    .select('id, status, pengunjung_id, layanan_id')
    .eq('id', parsed.data.sesi_id)
    .maybeSingle();

  if (sesiErr) {
    console.error('[api/chat/messages GET] sesi error:', sesiErr);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
  if (!sesiData || !(await bolehAkses(serverClient, actor, sesiData))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Riwayat percakapan (Fase 5): seluruh sesi pengunjung + Layanan yang sama. Lolos otorisasi sesi jangkar = boleh
  // melihat percakapan itu (K4). Sesi tanpa pemilik (pengunjung dianonimkan) hanya punya pesannya sendiri.
  if (parsed.data.riwayat === '1' && sesiData.pengunjung_id && sesiData.layanan_id) {
    try {
      // A1: lintas sesi dengan service-role HANYA bila chat_boleh_riwayat (admin, FO Koordinator, petugas Layanan jangkar
      // Koordinator/penangan kini). Staf lain: klien berJWT pengguna, jadi RLS chat_pesan menyaring per sesi.
      let klienRiwayat: typeof adminClient | Awaited<ReturnType<typeof createServerClient>> = adminClient;
      if (actor.kind === 'staff') {
        const penuh = await bolehRiwayatPenuh(serverClient, sesiData.id);
        if (penuh === false) klienRiwayat = serverClient;
      }
      const hasil = await muatRiwayatPercakapan(
        klienRiwayat as Parameters<typeof muatRiwayatPercakapan>[0],
        { pengunjung_id: sesiData.pengunjung_id, layanan_id: sesiData.layanan_id },
        { sebelum: parsed.data.sebelum ?? null, limit: parsed.data.limit ? Number(parsed.data.limit) : undefined },
      );
      return NextResponse.json({
        messages: hasil.messages,
        status: sesiData.status || 'bot',
        ada_lebih: hasil.adaLebih,
        sesi_terbuka_id: hasil.sesiTerbukaId,
      });
    } catch (e) {
      console.error('[api/chat/messages GET] riwayat error:', e);
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
    }
  }

  const { data, error } = await adminClient
    .from('chat_pesan')
    .select('id, pengirim, isi, created_at, client_uuid, jenis_jawaban')
    .eq('sesi_id', parsed.data.sesi_id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[api/chat/messages GET] error:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }

  return NextResponse.json({
    messages: data || [],
    status: sesiData.status || 'bot',
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const serverClient = await createServerClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminClient = getServiceClient();
  if (!adminClient) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const actor = await resolveActor(adminClient, user.id);
  if (!actor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: sesiData, error: sesiErr } = await adminClient
    .from('chat_sesi')
    .select('id, status, pengunjung_id, layanan_id, ditangani_oleh')
    .eq('id', parsed.data.sesi_id)
    .maybeSingle();

  if (sesiErr) {
    console.error('[api/chat/messages POST] sesi error:', sesiErr);
    return NextResponse.json({ error: 'Failed to insert message' }, { status: 500 });
  }
  if (!sesiData || !(await bolehAkses(serverClient, actor, sesiData))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (sesiData.status === 'selesai') {
    return NextResponse.json({ error: 'Sesi sudah selesai' }, { status: 409 });
  }

  // Tahap C (kontrak FO-CHAT §4.3): SEMUA staf (petugas, FO, Admin) hanya boleh membalas sesi yang sedang ia
  // pegang lewat chat_ambil (status 'aktif' dan ditangani_oleh = dirinya). Sesi bot/eskalasi -> ambil dulu;
  // Admin pun harus mengambil (alasan wajib bila merebut dari staf lain) sebelum membalas.
  if (actor.kind === 'staff') {
    const held = sesiData.ditangani_oleh as string | null | undefined;
    if (sesiData.status !== 'aktif') {
      return NextResponse.json({ error: 'Ambil alih sesi terlebih dahulu', code: 'perlu_takeover' }, { status: 409 });
    }
    if (!held || held !== actor.petugasId) {
      return NextResponse.json({ error: 'Sesi sedang ditangani petugas lain', code: 'dipegang_lain' }, { status: 409 });
    }
  }

  // Force role — never trust client-supplied pengirim (impersonation vector).
  const pengirim = actor.kind === 'staff' ? 'petugas' : 'pengunjung';

  let data: Record<string, unknown> | undefined;
  try {
    [data] = await mutasiInsert<Record<string, unknown>>(
      adminClient
        .from('chat_pesan')
        .insert({
          sesi_id: parsed.data.sesi_id,
          pengirim,
          isi: parsed.data.isi.trim(),
          client_uuid: parsed.data.client_uuid ?? null,
        })
        .select('id, pengirim, isi, created_at, client_uuid, jenis_jawaban')
        .single(),
    );
  } catch (e) {
    // Idempotensi: retry/klik ganda dengan client_uuid sama dikembalikan
    // sebagai 200 (bukan baris kedua) berkat indeks unik di migrasi 202609230001.
    const kodeDb = e instanceof MutasiError ? (e.asal as { code?: string } | undefined)?.code : undefined;
    if (kodeDb === '23505' && parsed.data.client_uuid) {
      const existing = await adminClient
        .from('chat_pesan')
        .select('id, pengirim, isi, created_at, client_uuid, jenis_jawaban')
        .eq('sesi_id', parsed.data.sesi_id)
        .eq('client_uuid', parsed.data.client_uuid)
        .maybeSingle();
      if (existing.data) {
        return NextResponse.json({ message: existing.data, duplicate: true }, { status: 200 });
      }
    }
    catatMutasi('error', 'chat.messages.insert', '/api/chat/messages', e);
    return NextResponse.json({ error: 'Failed to insert message' }, { status: 500 });
  }

  if (!data) {
    catatMutasi('error', 'chat.messages.insert', '/api/chat/messages', new MutasiError('tidak_ada_baris'));
    return NextResponse.json({ error: 'Failed to insert message' }, { status: 500 });
  }

  // Fase 5: pesan pengunjung pada sesi yang menunggu petugas di luar jam (mis. Layanan tanpa bot, atau eskalasi otomatis
  // sebelum jam tutup): DB menulis pesan tunggu + email berdedup SEKALI per sesi. Galat apa pun tidak menggagalkan
  // pengiriman (pesan sudah tersimpan); RPC belum ada = perilaku lama.
  if (actor.kind === 'pengunjung' && sesiData.status === 'eskalasi') {
    try {
      const { error: mintaErr } = await serverClient.rpc('chat_minta_petugas', {
        p_sesi_id: parsed.data.sesi_id,
        p_eksplisit: false,
      });
      if (mintaErr && !objekBelumAda(mintaErr)) {
        catatMutasi('warn', 'chat.messages.minta_petugas', '/api/chat/messages', new MutasiError('database', { asal: mintaErr }));
      }
    } catch {
      /* tidak menggagalkan pengiriman */
    }
  }

  return NextResponse.json({ message: data }, { status: 201 });
}
