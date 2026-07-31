import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';
import crypto from 'node:crypto';
import sharp from 'sharp';

const querySchema = z.object({
  doc_id: z.string().uuid(),
  page: z.coerce.number().int().positive(),
});

// Per-IP rate limit (in-memory, best-effort lokal) — lapisan pertama, murah.
// Lapisan kedua yang efektif lintas-instance: check_anon_rate di DB (dipakai
// bila ada sesi). Rate limit in-memory dibiarkan sebagai pertahanan dini CPU.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, { windowStart: number; count: number }>();

// In-memory watermark cache keyed per doc+page+subject+minute. Bounded with
// oldest-first eviction; responses still carry Cache-Control: no-store.
const CACHE_MAX_ENTRIES = 200;
const watermarkCache = new Map<string, Buffer>();

function cacheKey(docId: string, page: number, subject: string): string {
  const minute = Math.floor(Date.now() / 60_000);
  return `${docId}:${page}:${subject}:${minute}`;
}

function cacheGet(key: string): Buffer | undefined {
  const hit = watermarkCache.get(key);
  if (hit) {
    watermarkCache.delete(key);
    watermarkCache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: Buffer): void {
  if (watermarkCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = watermarkCache.keys().next().value;
    if (oldest !== undefined) watermarkCache.delete(oldest);
  }
  watermarkCache.set(key, value);
}

function checkIpRate(ipHash: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ipHash);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ipHash, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key);
}

async function hashIp(ip: string): Promise<string> {
  const hash = crypto.createHash('sha256').update(ip).digest('hex');
  return hash.slice(0, 8);
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return '0.0.0.0';
}

// INV-04: tentukan identitas watermark.
//  - pengguna LOGIN  -> "nama <email>" (dari tabel pengunjung)
//  - anonim          -> "SES-<hash sesi>" + waktu (bukan identitas pribadi)
async function resolveWatermarkIdentity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionSeed: string,
): Promise<{ subject: string; label: string }> {
  // Guard: supabase.auth may not exist in test mocks or alternative client shapes.
  let user: { id: string } | null = null;
  try {
    if (supabase?.auth && typeof supabase.auth.getUser === 'function') {
      const { data } = await supabase.auth.getUser();
      user = data?.user ?? null;
    }
  } catch {
    // If auth call fails (e.g. missing cookies in test), treat as anonymous.
    user = null;
  }

  if (user) {
    const { data: p } = await supabase
      .from('pengunjung')
      .select('nama, email')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (p?.email) {
      const nama = (p.nama ?? '').trim() || 'Pengguna';
      return { subject: `u:${user.id}`, label: `${nama} <${p.email}>` };
    }
    // Login tapi profil belum lengkap — tetap identifikasi akun tanpa PII berlebih.
    return { subject: `u:${user.id}`, label: `Akun ${user.id.slice(0, 8)}` };
  }

  // Anonim: penanda sesi stabil (dari seed cookie/IP), tanpa nama/email.
  const sesi = crypto.createHash('sha256').update(sessionSeed).digest('hex').slice(0, 8);
  return { subject: `anon:${sesi}`, label: `SES-${sesi}` };
}

async function buildWatermarkOverlay(width: number, height: number, text: string) {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <style>
      .wm { font-family: sans-serif; font-size: ${Math.max(12, Math.floor(width / 50))}px; fill: rgba(239, 68, 68, 0.35); font-weight: 700; }
    </style>
    <text x="10" y="24" class="wm">${escapeXml(text)}</text>
    <text x="${width - 10}" y="24" class="wm" text-anchor="end">${escapeXml(text)}</text>
    <text x="10" y="${height - 10}" class="wm">${escapeXml(text)}</text>
    <text x="${width - 10}" y="${height - 10}" class="wm" text-anchor="end">${escapeXml(text)}</text>
    <text x="${width / 2}" y="${height / 2}" class="wm" text-anchor="middle" transform="rotate(-30 ${width / 2} ${height / 2})" style="font-size:${Math.max(24, Math.floor(width / 18))}px;fill:rgba(239,68,68,0.18);">${escapeXml(text)}</text>
  </svg>`;
  return Buffer.from(svg);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    doc_id: request.nextUrl.searchParams.get('doc_id') ?? '',
    page: request.nextUrl.searchParams.get('page') ?? '',
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { doc_id, page } = parsed.data;

  const supabase = await createClient();

  // Identitas watermark (login: nama+email; anon: sesi). Seed sesi dari IP+cookie
  // agar anon konsisten per perangkat tanpa menyimpan PII.
  const sessionSeed = `${getClientIp(request)}|${request.headers.get('cookie') ?? ''}`;
  const { subject, label } = await resolveWatermarkIdentity(supabase, sessionSeed);

  // Rate limit: lapisan IP lokal (cepat). Untuk pengguna bersesi, lapisan DB
  // check_anon_rate menambah efektivitas lintas-instance (SEC-02).
  const ipHash = await hashIp(getClientIp(request));
  if (!checkIpRate(ipHash)) {
    return NextResponse.json(
      { error: 'Terlalu banyak permintaan. Coba lagi nanti.' },
      { status: 429 },
    );
  }

  const key = cacheKey(doc_id, page, subject);
  const cached = cacheGet(key);
  if (cached) {
    return new Response(new Uint8Array(cached), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  }

  const { data: docRow, error: docError } = await supabase
    .from('investment_documents')
    .select('halaman_gambar, jumlah_halaman, status')
    .eq('id', doc_id)
    .maybeSingle();

  if (docError) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
  if (!docRow) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  if (docRow.status !== 'aktif') {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  if (!docRow.halaman_gambar || docRow.halaman_gambar.length === 0) {
    return NextResponse.json({ error: 'Document not yet processed' }, { status: 404 });
  }
  if (page > docRow.jumlah_halaman || page > docRow.halaman_gambar.length) {
    return NextResponse.json({ error: 'Page out of range' }, { status: 400 });
  }

  const pagePath = docRow.halaman_gambar[page - 1]!;

  const serviceClient = getServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY required to serve watermarked pages' },
      { status: 500 },
    );
  }

  const { data: downloadData, error: downloadError } = await serviceClient
    .storage
    .from('investment-docs')
    .download(pagePath);

  if (downloadError || !downloadData) {
    return NextResponse.json({ error: 'Failed to fetch page image' }, { status: 500 });
  }

  const pageBuffer = Buffer.from(await downloadData.arrayBuffer());

  // INV-04: watermark memuat identitas peminta + waktu (dibakar di server, bukan overlay CSS).
  const ts = new Date().toISOString();
  const watermarkText = `${label} | ${ts}`;

  const metadata = await sharp(pageBuffer).metadata();
  const overlay = await buildWatermarkOverlay(metadata.width ?? 800, metadata.height ?? 1100, watermarkText);

  const watermarked = await sharp(pageBuffer)
    .composite([{ input: overlay, gravity: 'center' }])
    .png()
    .toBuffer();

  cacheSet(key, watermarked);

  return new Response(new Uint8Array(watermarked), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  });
}
