import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { jalankanBot, FALLBACK_TEXT } from '@/lib/llm/bot';
import { muatLayananDanProfil } from '@/lib/llm/profil-layanan-server';
import { logServerEvent } from '@/lib/observability/logger';
import { redactPii } from '@/lib/pii';
import { mutasiBolehKosong, mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';
import { modeHariTanpaLayanan, type AlasanTanpaLayanan } from '@/lib/llm/bot-waktu';
import { muatInfoHariLayanan, teksBotTanpaPetugas } from '@/lib/chat/hari-tanpa-layanan';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  pertanyaan: z.string().min(3).max(2000),
  layanan_id: z.uuid(),
  sesi_id: z.uuid(),
});

// Rate limit: 10 calls per 60s per user. Generous enough for legitimate
// chat, tight enough to prevent Gemini-quota abuse.
const ROUTE = '/api/chat/ai';
const RATE_LIMIT_ACTION = 'chat_ai_call';
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SEC = 60;
/** Alasan (respons & chat_ai_log) saat bot gagal menjawab pada hari tanpa pelayanan: tanpa eskalasi. */
const REASON_TANPA_LAYANAN = 'hari_tanpa_layanan';

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

type BotRow = { id: string; pengirim: string; isi: string; created_at: string; sumber_faq_id?: string | null };
type Admin = NonNullable<ReturnType<typeof getServiceClient>>;
type SesiStatus = 'bot' | 'eskalasi' | 'aktif' | 'selesai';

function ignoredBody(status: SesiStatus) {
  return {
    ignored: true, jawaban: null, sumber: [], eskalasi: false,
    reason: status === 'aktif' ? 'sesi_aktif' : 'sesi_selesai', pesan: null, status,
  };
}

function cause(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

// Simpan pesan bot (server-side) dan, bila eskalasi, naikkan status hanya dari 'bot'.
// Klien chat menampilkan balasan bot HANYA lewat `pesan` (baris yang tersimpan), jadi `pesan: null` karena
// gagal simpan = pengunjung tidak melihat apa pun; pemanggil memutuskan responsnya dari `pesan` + `status`.
async function saveBot(
  admin: Admin,
  sesiId: string,
  currentStatus: SesiStatus,
  isi: string,
  opts: { eskalasi: boolean; sumberFaqId?: string | null },
): Promise<{ pesan: BotRow | null; status: SesiStatus; ignored?: boolean }> {
  // Baca ulang status: petugas bisa mengambil alih selama LLM berjalan.
  const { data: cur } = await admin.from('chat_sesi').select('status').eq('id', sesiId).maybeSingle();
  const now = (cur?.status ?? currentStatus) as SesiStatus;
  if (now === 'aktif' || now === 'selesai') {
    return { pesan: null, status: now, ignored: true };
  }
  currentStatus = now;

  let pesan: BotRow | null = null;
  try {
    const [baris] = await mutasiInsert<BotRow>(
      admin
        .from('chat_pesan')
        .insert({ sesi_id: sesiId, pengirim: 'bot', isi, sumber_faq_id: opts.sumberFaqId ?? null })
        .select('id, pengirim, isi, created_at, sumber_faq_id')
        .single(),
    );
    pesan = baris ?? null;
  } catch (e) {
    catatMutasi('error', 'chat.ai.save_bot', ROUTE, e, { sesiId });
  }

  let status: SesiStatus = currentStatus;
  if (opts.eskalasi && currentStatus === 'bot') {
    try {
      // mutasiBolehKosong (bukan Wajib): UPDATE bersyarat `status='bot'`; 0 baris = petugas/permintaan lain
      // sudah mengubah status di sela-sela (balapan), bukan kegagalan -> baca status sebenarnya di bawah.
      const baris = await mutasiBolehKosong(
        admin
          .from('chat_sesi')
          .update({ status: 'eskalasi' })
          .eq('id', sesiId)
          .eq('status', 'bot')
          .select('id'),
      );
      if (baris.length > 0) {
        status = 'eskalasi';
      } else {
        const { data: aktual } = await admin.from('chat_sesi').select('status').eq('id', sesiId).maybeSingle();
        status = (aktual?.status ?? currentStatus) as SesiStatus;
      }
    } catch (e) {
      // Eskalasi gagal: jangan mengklaim 'eskalasi' ke klien; status tetap seperti yang dibaca.
      catatMutasi('error', 'chat.ai.escalate_status', ROUTE, e, { sesiId });
    }
  }
  return { pesan, status };
}

// Balasan bot yang GAGAL tersimpan dan tidak ada petugas yang akan menjemput sesi (status masih 'bot'):
// 500 agar klien menampilkan "asisten tidak tersedia, coba lagi" alih-alih 200 yang tak menampilkan apa pun.
// Bila sesi sudah dieskalasi/diambil alih, 200 dengan `pesan: null` tetap benar (status dari server yang menentukan UI).
function gagalSimpanBalasan(pesan: BotRow | null, status: SesiStatus): NextResponse | null {
  if (pesan || status !== 'bot') return null;
  return NextResponse.json({ error: 'Gagal menyimpan balasan asisten. Silakan coba lagi.' }, { status: 500 });
}

export async function POST(request: NextRequest) {
  // 1. Validate input
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { pertanyaan: rawPertanyaan, layanan_id, sesi_id } = parsed.data;

  // Redact PII before the question is logged or sent to the LLM.
  const pertanyaan = redactPii(rawPertanyaan);

  const adminClient = getServiceClient();
  if (!adminClient) {
    // Tanpa service client tidak ada yang bisa disimpan; jujur ke klien.
    logServerEvent('error', { operation: 'chat.ai.no_service_client', route: '/api/chat/ai' });
    return NextResponse.json(
      { jawaban: FALLBACK_TEXT, sumber: [], eskalasi: true, reason: 'ai_error', pesan: null, status: null },
      { status: 200 },
    );
  }

  // 2b. Identify the caller and verify they own sesi_id (service-role bypasses
  // RLS, so this explicit check is the authorization).
  const serverClient = await createServerClient();
  const { data: { user: caller } } = await serverClient.auth.getUser();
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: pengunjungRow, error: pengunjungErr } = await adminClient
    .from('pengunjung')
    .select('id')
    .eq('auth_user_id', caller.id)
    .maybeSingle();

  if (pengunjungErr || !pengunjungRow) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: sesiRow, error: sesiErr } = await adminClient
    .from('chat_sesi')
    .select('pengunjung_id, status')
    .eq('id', sesi_id)
    .maybeSingle();

  if (sesiErr || !sesiRow || sesiRow.pengunjung_id !== pengunjungRow.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Petugas memegang sesi ('aktif') atau sudah ditutup: bot diam, tanpa biaya AI.
  const sesiStatus = (sesiRow.status ?? 'bot') as SesiStatus;
  if (sesiStatus === 'aktif' || sesiStatus === 'selesai') {
    return NextResponse.json(ignoredBody(sesiStatus));
  }

  // Bot hidup/mati ditegakkan di server (bukan hanya disembunyikan di layar pengunjung).
  // Profil (deskripsi, instansi, tautan, jadwal) dimuat bersama; logikanya dipakai bersama pratinjau admin.
  const muat = await muatLayananDanProfil(adminClient, layanan_id, { route: ROUTE, sesiId: sesi_id });
  if (!muat.ok) {
    return muat.status === 503
      ? NextResponse.json({ error: 'Layanan sementara tidak tersedia. Coba lagi beberapa saat.' }, { status: 503 })
      : NextResponse.json({ error: 'Layanan tidak ditemukan' }, { status: 404 });
  }
  const layananNama = muat.layanan.nama;
  const profilLayanan = muat.profil;
  if (muat.layanan.chatbot_aktif === false) {
    return NextResponse.json({ ...ignoredBody(sesiStatus), reason: 'bot_nonaktif' });
  }

  // 2c. Rate limit (10/60s per user), fail-closed. 429 HANYA bila pengguna memang melewati batas;
  // kegagalan membaca/mencatat hitungan = masalah server -> 503 (bukan salah pengguna, dan klien
  // menampilkannya sebagai "asisten tidak tersedia", bukan "terlalu cepat").
  const batas = await checkRateLimit(adminClient, caller.id);
  if (batas === 'dibatasi') {
    return NextResponse.json(
      { error: 'Terlalu banyak permintaan. Coba lagi nanti.' },
      { status: 429 },
    );
  }
  if (batas === 'gagal') {
    return NextResponse.json(
      { error: 'Layanan sementara tidak tersedia. Coba lagi beberapa saat.' },
      { status: 503 },
    );
  }

  // Jalur kegagalan terpusat: log penyebab nyata, pesan bot, status eskalasi.
  const failAndEscalate = async (
    operation: string,
    err: unknown,
    faqIds: string[] = [],
    topSim: number | null = null,
    text: string = FALLBACK_TEXT,
    reason: string = 'ai_error',
  ) => {
    logServerEvent('error', { operation, route: '/api/chat/ai', sesiId: sesi_id, cause: cause(err) });
    await logAiCall(adminClient, sesi_id, pertanyaan, faqIds, null, topSim, true, reason);
    const { pesan, status, ignored } = await saveBot(adminClient, sesi_id, sesiStatus, text, { eskalasi: true });
    if (ignored) return NextResponse.json(ignoredBody(status));
    const gagal = gagalSimpanBalasan(pesan, status);
    if (gagal) return gagal;
    return NextResponse.json({
      jawaban: text, sumber: [], eskalasi: true, reason: reason, pesan, status,
    });
  };

  // Logika bot (injeksi prompt -> FAQ FTS -> embedding FAQ + Dokumen Peraturan -> LLM) ada di lib/llm/bot.ts
  // dan dipakai bersama "Coba tanya bot" admin. Route ini hanya mengurus auth, status sesi, dan penyimpanan.
  const hasil = await jalankanBot({
    admin: adminClient, pertanyaan, rawPertanyaan, layananId: layanan_id, layananNama, profilLayanan,
  });
  if (hasil.kind === 'gagal') {
    // Hari tanpa pelayanan (Sabtu/Minggu/hari_libur; keputusan CEO 2026-10-14): live chat dengan petugas tidak
    // tersedia -> TANPA eskalasi; balasan menyarankan menghubungi kembali pada hari kerja / kanal di pengaturan.
    if (modeHariTanpaLayanan(hasil.mode)) {
      logServerEvent('warn', { operation: hasil.operation, route: ROUTE, sesiId: sesi_id, cause: cause(hasil.err) });
      const info = await muatInfoHariLayanan(adminClient);
      const text = teksBotTanpaPetugas(
        // Kalender route = kalender bot; bila pembacaan kedua berbeda (galat baca), pakai mode bot.
        info.alasan ? info : { ...info, alasan: hasil.mode.alasan as AlasanTanpaLayanan, kerjaBerikutnya: hasil.mode.kerjaBerikutnya },
        hasil.reason === 'prompt_injection' ? 'prompt_injection' : 'ai_error',
      );
      await logAiCall(adminClient, sesi_id, pertanyaan, hasil.faqIds, text, hasil.topSim, false, REASON_TANPA_LAYANAN);
      const { pesan, status, ignored } = await saveBot(adminClient, sesi_id, sesiStatus, text, { eskalasi: false });
      if (ignored) return NextResponse.json(ignoredBody(status));
      const gagal = gagalSimpanBalasan(pesan, status);
      if (gagal) return gagal;
      return NextResponse.json({ jawaban: text, sumber: [], eskalasi: false, reason: REASON_TANPA_LAYANAN, pesan, status });
    }
    return failAndEscalate(hasil.operation, hasil.err, hasil.faqIds, hasil.topSim, hasil.text, hasil.reason);
  }

  // Pertahanan berlapis: pada hari tanpa pelayanan bot tidak pernah mengeskalasi (bot.ts juga sudah menahan).
  const eskalasi = hasil.eskalasi && !modeHariTanpaLayanan(hasil.mode);

  // Audit log + simpan balasan bot + eskalasi status (hanya dari 'bot').
  await logAiCall(adminClient, sesi_id, pertanyaan, hasil.faqIds, hasil.jawaban, hasil.topSim, eskalasi, hasil.reason);
  const { pesan, status, ignored } = await saveBot(adminClient, sesi_id, sesiStatus, hasil.jawaban, {
    eskalasi,
    sumberFaqId: hasil.sumberFaqId,
  });
  if (ignored) return NextResponse.json(ignoredBody(status));
  const gagal = gagalSimpanBalasan(pesan, status);
  if (gagal) return gagal;

  return NextResponse.json({
    jawaban: hasil.jawaban,
    sumber: hasil.sumber,
    sumber_dokumen: hasil.sumberDokumen,
    eskalasi,
    reason: hasil.reason,
    pesan,
    status,
  });
}

async function checkRateLimit(
  adminClient: SupabaseClient,
  userId: string,
): Promise<'ok' | 'dibatasi' | 'gagal'> {
  // Count existing rate-limit rows for this user+action within the window.
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString();
  const { count, error } = await adminClient
    .from('anon_rate_limit')
    .select('*', { count: 'exact', head: true })
    .eq('action', RATE_LIMIT_ACTION)
    .eq('user_id', userId)
    .gte('created_at', since);

  if (error) {
    // Hanya kode SQLSTATE yang dicatat; pesan teknis PostgREST tidak.
    logServerEvent('error', { operation: 'chat.ai.rate_limit_read', route: ROUTE, asalCode: error.code || undefined });
    return 'gagal';
  }
  if (count !== null && count >= RATE_LIMIT_MAX) return 'dibatasi';

  // Log this call so subsequent requests within the window are counted. Fail-closed seperti pembacaan di atas:
  // kegagalan mencatat berarti pembatas tidak menghitung (bisa dilewati diam-diam), jadi permintaan ditolak.
  try {
    await mutasiInsert(
      adminClient.from('anon_rate_limit').insert({
        user_id: userId,
        action: RATE_LIMIT_ACTION,
      }),
    );
  } catch (e) {
    catatMutasi('error', 'chat.ai.rate_limit_insert', ROUTE, e);
    return 'gagal';
  }
  return 'ok';
}

async function logAiCall(
  client: ReturnType<typeof getServiceClient>,
  sesiId: string,
  pertanyaan: string,
  contextFaqIds: string[],
  jawaban: string | null,
  topSimilarity: number | null,
  eskalasi: boolean,
  reason: string | null,
): Promise<void> {
  if (!client) return;
  // best-effort: log audit AI tidak boleh menggagalkan jawaban ke pengunjung. Kegagalan dicatat (peringatan),
  // bukan ditelan: supabase-js mengembalikan { error } (tidak melempar), jadi try/catch saja tidak cukup.
  try {
    await mutasiInsert(
      client.from('chat_ai_log').insert({
        sesi_id: sesiId,
        pertanyaan,
        context_faq_ids: contextFaqIds,
        jawaban,
        top_similarity: topSimilarity,
        eskalasi,
        reason,
      }),
    );
  } catch (e) {
    catatMutasi('warn', 'chat.ai.audit_log', ROUTE, e, { sesiId });
  }
}
