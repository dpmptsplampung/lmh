import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { getGenerativeClient, getEmbeddingModel } from '@/lib/gemini';
import { MutasiError, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal } from '@/app/api/admin/_mutasi';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface FaqRowNeedingEmbed {
  id: string;
  pertanyaan: string;
  jawaban: string;
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key);
}

// Pembatas laju mode {faqId} (best-effort per instans serverless). Pembatasan utama tetap: hanya SATU FAQ,
// hanya yang masih menunggu diproses, dan hanya yang masuk lingkup penyimpan (lihat prosesSatuFaq).
const BATAS_PER_JENDELA = 30;
const JENDELA_MS = 10 * 60 * 1000;
const percobaanPengguna = new Map<string, number[]>();

function cekLaju(userId: string, sekarang = Date.now()): { boleh: true } | { boleh: false; ulangDetik: number } {
  const terbaru = (percobaanPengguna.get(userId) ?? []).filter((t) => sekarang - t < JENDELA_MS);
  if (terbaru.length >= BATAS_PER_JENDELA) {
    percobaanPengguna.set(userId, terbaru);
    return { boleh: false, ulangDetik: Math.max(1, Math.ceil((terbaru[0] + JENDELA_MS - sekarang) / 1000)) };
  }
  terbaru.push(sekarang);
  percobaanPengguna.set(userId, terbaru);
  return { boleh: true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type HasilProses = { ok: true } | { ok: false; mutasi?: MutasiError };

/** Embed lalu simpan hanya bila teks sumber masih sama; versi baru tetap menunggu pemrosesan. */
async function prosesSatuBaris(
  adminClient: SupabaseClient,
  embedModel: ReturnType<typeof getEmbeddingModel>,
  row: FaqRowNeedingEmbed,
): Promise<HasilProses> {
  try {
    const result = await embedModel.embedContent(`${row.pertanyaan}\n${row.jawaban}`);
    const vector = result.embedding.values;
    if (!vector || vector.length === 0) return { ok: false };
    // pgvector accepts a text representation like '[0.1,0.2,...]'.
    const vectorLiteral = `[${vector.join(',')}]`;
    try {
      await mutasiWajibBaris(
        adminClient
          .from('faq_knowledge_base')
          .update({
            embedding: vectorLiteral,
            perlu_embed_ulang: false,
            embedding_updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)
          .eq('pertanyaan', row.pertanyaan)
          .eq('jawaban', row.jawaban)
          .select('id'),
      );
    } catch (e) {
      if (!(e instanceof MutasiError)) throw e;
      return { ok: false, mutasi: e };
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

type PeranFaq = 'admin' | 'petugas' | 'front_office';

/** Selaras RLS `faq_knowledge_base` dan lib/faq-scope.ts: admin semua, petugas = layanannya, Front Office = FAQ umum. */
function faqDalamLingkup(peran: PeranFaq, layananPetugas: string | null, layananFaq: string | null): boolean {
  if (peran === 'admin') return true;
  if (peran === 'front_office') return layananFaq === null;
  return layananPetugas !== null && layananFaq === layananPetugas;
}

/**
 * Mode {faqId}: dipanggil halaman Kelola FAQ setelah menyimpan, oleh siapa pun yang berhak menyimpan FAQ itu.
 * Memproses HANYA FAQ tersebut dan HANYA bila masih menunggu diproses (embedding kosong / perlu embed ulang).
 */
async function prosesSatuFaq(faqId: string): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: petugas } = await supabase
    .from('petugas')
    .select('role, aktif, layanan_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  const peran = petugas?.role;
  if (!petugas || petugas.aktif !== true || (peran !== 'admin' && peran !== 'petugas' && peran !== 'front_office')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!UUID.test(faqId)) {
    return NextResponse.json({ error: 'ID FAQ tidak valid.' }, { status: 400 });
  }

  const laju = cekLaju(user.id);
  if (!laju.boleh) {
    return NextResponse.json(
      { error: 'Terlalu banyak permintaan pemrosesan. Coba lagi beberapa menit lagi.' },
      { status: 429, headers: { 'Retry-After': String(laju.ulangDetik) } },
    );
  }

  const adminClient = getServiceClient();
  if (!adminClient) {
    return NextResponse.json({ error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY required' }, { status: 500 });
  }
  const genAI = getGenerativeClient();
  if (!genAI) {
    return NextResponse.json({ error: 'Server misconfigured: GEMINI_API_KEY required' }, { status: 500 });
  }

  const { data: faq, error: faqErr } = await adminClient
    .from('faq_knowledge_base')
    .select('id, layanan_id, pertanyaan, jawaban')
    .eq('id', faqId)
    .maybeSingle();
  if (faqErr) {
    console.error('[admin/faq/embed] gagal membaca FAQ', faqErr);
    return NextResponse.json({ error: 'Gagal memuat FAQ.' }, { status: 500 });
  }
  if (!faq) return NextResponse.json({ error: 'FAQ tidak ditemukan.' }, { status: 404 });
  if (!faqDalamLingkup(peran, petugas.layanan_id ?? null, faq.layanan_id ?? null)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: pending, error: pendingErr } = await adminClient
    .from('faq_knowledge_base')
    .select('id')
    .eq('id', faqId)
    .or('embedding.is.null,perlu_embed_ulang.eq.true')
    .maybeSingle();
  if (pendingErr) {
    console.error('[admin/faq/embed] gagal memeriksa status FAQ', pendingErr);
    return NextResponse.json({ error: 'Gagal memeriksa status FAQ.' }, { status: 500 });
  }
  if (!pending) {
    return NextResponse.json({ error: 'FAQ ini sudah diproses.' }, { status: 409 });
  }

  const embedModel = getEmbeddingModel(genAI, 'gemini-embedding-001');
  const hasil = await prosesSatuBaris(adminClient, embedModel, {
    id: faq.id,
    pertanyaan: faq.pertanyaan,
    jawaban: faq.jawaban,
  });
  if (!hasil.ok) {
    if (hasil.mutasi) catatMutasiGagal('/api/admin/faq/embed', 'admin.faq.embed.update', hasil.mutasi, { jumlahGagal: 1 });
    return NextResponse.json(
      { error: 'FAQ tersimpan, tetapi belum bisa diproses bot. Coba lagi beberapa saat lagi.', embedded: 0, failed: 1 },
      { status: 502 },
    );
  }
  return NextResponse.json({ embedded: 1, failed: 0, remaining: 0 });
}

export async function POST(request?: Request) {
  // 0. Mode {faqId}: satu FAQ, oleh penyimpannya (lihat prosesSatuFaq). Cron tidak memakai mode ini.
  const sandi = process.env.CRON_SECRET;
  const kirimanCron = Boolean(sandi && request?.headers?.get('authorization') === `Bearer ${sandi}`);
  if (request && !kirimanCron) {
    const body = (await request.clone().json().catch(() => null)) as { faqId?: unknown } | null;
    if (body && typeof body === 'object' && 'faqId' in body) {
      return typeof body.faqId === 'string'
        ? prosesSatuFaq(body.faqId)
        : NextResponse.json({ error: 'ID FAQ tidak valid.' }, { status: 400 });
    }
  }

  // 1. Auth: admin ATAU cron (BOT-11 — embed ulang terjadwal via Vercel cron).
  //    Mode cron diautentikasi CRON_SECRET agar endpoint bisa dipicu otomatis.
  //    `request` opsional agar pemanggilan internal/tes tanpa argumen tetap valid.
  const authHeader = request?.headers?.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;
  const isCron = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (!isCron) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: petugas } = await supabase
      .from('petugas')
      .select('role, aktif')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    // Admin NONAKTIF ditolak (route ini lanjut memakai service-role).
    if (!petugas || petugas.role !== 'admin' || petugas.aktif !== true) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // 2. Service-role client for bulk UPDATE (bypasses RLS)
  const adminClient = getServiceClient();
  if (!adminClient) {
    return NextResponse.json(
      { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY required' },
      { status: 500 },
    );
  }

  // 3. Gemini client
  const genAI = getGenerativeClient();
  if (!genAI) {
    return NextResponse.json(
      { error: 'Server misconfigured: GEMINI_API_KEY required' },
      { status: 500 },
    );
  }
  const embedModel = getEmbeddingModel(genAI, 'gemini-embedding-001'); // FAQ col = 3072

  // 4. Fetch up to 50 FAQs that need (re)embedding:
  //    embedding IS NULL (belum pernah) ATAU perlu_embed_ulang = true (BOT-11).
  const { data: pending, error: fetchErr } = await adminClient
    .from('faq_knowledge_base')
    .select('id, pertanyaan, jawaban')
    .or('embedding.is.null,perlu_embed_ulang.eq.true')
    .limit(50);

  if (fetchErr) {
    console.error('[admin/faq/embed] gagal mengambil FAQ pending', fetchErr);
    return NextResponse.json(
      { error: 'Gagal memuat FAQ yang belum di-embed.' },
      { status: 500 },
    );
  }

  const rows: FaqRowNeedingEmbed[] = (pending ?? []) as FaqRowNeedingEmbed[];

  // 5. Embed + UPDATE each row, lalu tandai selesai (BOT-11).
  let embedded = 0;
  let failed = 0;
  // Kegagalan UPDATE dicatat SEKALI per proses (maks. 50 baris; hindari banjir error_log saat DB bermasalah).
  let gagalUpdate = 0;
  let contohGagal: MutasiError | null = null;
  for (const row of rows) {
    const hasil = await prosesSatuBaris(adminClient, embedModel, row);
    if (hasil.ok) {
      embedded++;
      continue;
    }
    failed++;
    if (hasil.mutasi) {
      gagalUpdate++;
      contohGagal ??= hasil.mutasi;
    }
  }
  if (contohGagal) {
    catatMutasiGagal('/api/admin/faq/embed', 'admin.faq.embed.update', contohGagal, { jumlahGagal: gagalUpdate });
  }

  // 6. Count remaining (for progress UI): yang masih perlu diproses.
  const { count: remaining } = await adminClient
    .from('faq_knowledge_base')
    .select('*', { count: 'exact', head: true })
    .or('embedding.is.null,perlu_embed_ulang.eq.true');

  return NextResponse.json({
    embedded,
    failed,
    remaining: remaining ?? 0,
  });
}
