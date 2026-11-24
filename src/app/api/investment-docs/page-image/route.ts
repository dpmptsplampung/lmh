import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { kunciObjek } from '@/lib/storage/area';
import { getObjectBytes } from '@/lib/storage/r2';
import { BATAS_VARIAN_WEB, pathVarianWeb } from '@/lib/investasi/aset-halaman';
import { buatPembatasLajuDokumen, ipPeminta } from '@/lib/investasi/laju-dokumen';
import { unstable_cache } from 'next/cache';
import { jumlahHalamanSiapBaca, MAKS_HALAMAN_TERSAJI } from '@/lib/investasi/dokumen';
import { capWaktuWIB, nowServer } from '@/lib/time';
import { z } from 'zod';
import crypto from 'node:crypto';
import sharp from 'sharp';
export const maxDuration = 30;

const querySchema = z.object({
  doc_id: z.string().uuid(),
  page: z.coerce.number().int().positive().max(MAKS_HALAMAN_TERSAJI),
  varian: z.literal('sampul').optional(),
}).refine(q => !q.varian || q.page === 1);

// Kuota dipisah agar pramuat halaman dan kisi galeri tidak saling memakai jatah.
const bolehMuatHalaman = buatPembatasLajuDokumen(90);
const bolehMuatSampul = buatPembatasLajuDokumen(120);

// In-memory watermark cache keyed per page path+subject+minute. Bounded with
// oldest-first eviction; responses still carry Cache-Control: no-store.
const CACHE_MAX_ENTRIES = 200;
const watermarkCache = new Map<string, Buffer>();

function cacheKey(pagePath: string, subject: string): string {
  const minute = Math.floor(nowServer().getTime() / 60_000);
  return `${pagePath}:${subject}:${minute}`;
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

// Simpan gambar dasar kecil hanya di Data Cache server; watermark peminta dipasang setelah cache dibaca.
const muatDasarSampul = unstable_cache(async (pagePath: string) => {
  const bytes = await getObjectBytes('private', kunciObjek('investment-docs', pagePath));
  if (!bytes) throw new Error('Gambar halaman tidak tersedia');
  const kecil = await sharp(Buffer.from(bytes)).resize({
    width: 480, height: 480, fit: 'inside', withoutEnlargement: true,
  }).webp({ quality: 75 }).toBuffer();
  return kecil.toString('base64');
}, ['investment-docs-sampul-480-v1'], { revalidate: 86_400 });

async function muatDasarHalaman(pathPng: string) {
  const web = pathVarianWeb(pathPng);
  const varian = web ? await getObjectBytes('private', kunciObjek('investment-docs', web)) : null;
  return varian ?? await getObjectBytes('private', kunciObjek('investment-docs', pathPng));
}

function responsGambar(bytes: Buffer): Response {
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    doc_id: request.nextUrl.searchParams.get('doc_id') ?? '',
    page: request.nextUrl.searchParams.get('page') ?? '',
    varian: request.nextUrl.searchParams.get('varian') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { doc_id, page, varian } = parsed.data;
  const sampul = varian === 'sampul';

  // Rate limit IP lokal dulu (murah), sebelum auth dan query.
  const ip = ipPeminta(request);
  if (!(sampul ? bolehMuatSampul(ip) : bolehMuatHalaman(ip))) {
    return NextResponse.json(
      { error: 'Terlalu banyak permintaan. Coba lagi nanti.' },
      { status: 429 },
    );
  }

  const supabase = await createClient();
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
  if (!docRow.halaman_gambar?.length) {
    return NextResponse.json({ error: 'Document not yet processed' }, { status: 404 });
  }
  if (page > jumlahHalamanSiapBaca(docRow)) {
    return NextResponse.json({ error: 'Page out of range' }, { status: 400 });
  }
  const pagePath = docRow.halaman_gambar[page - 1]!;
  const sessionSeed = `${ip}|${request.headers.get('cookie') ?? ''}`;
  const { subject, label } = await resolveWatermarkIdentity(supabase, sessionSeed);
  const key = cacheKey(pagePath, subject);
  const cached = sampul ? undefined : cacheGet(key);
  if (cached) return responsGambar(cached);

  try {
    const bytes = sampul
      ? Buffer.from(await muatDasarSampul(pagePath), 'base64')
      : await muatDasarHalaman(pagePath);
    if (!bytes) throw new Error('Gambar halaman tidak tersedia');

    const gambar = sharp(Buffer.from(bytes));
    const { width = 800, height = 1100 } = await gambar.metadata();
    const skala = sampul ? 1 : Math.min(1, BATAS_VARIAN_WEB.width / width, BATAS_VARIAN_WEB.height / height);
    const lebar = Math.max(1, Math.round(width * skala));
    const tinggi = Math.max(1, Math.round(height * skala));
    if (skala < 1) gambar.resize({ width: lebar, height: tinggi, fit: 'fill' });
    const overlay = await buildWatermarkOverlay(lebar, tinggi, `${label} | ${capWaktuWIB()}`);
    const komposit = gambar.composite([{ input: overlay, gravity: 'center' }]);
    const watermarked = await komposit.webp(sampul ? { quality: 82 } : { quality: 80, effort: 1 }).toBuffer();
    if (!sampul) cacheSet(key, watermarked);
    return responsGambar(watermarked);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch page image' }, { status: 500 });
  }
}
