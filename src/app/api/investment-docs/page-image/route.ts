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
    return NextResponse.json(
      { error: 'Failed to fetch page image', details: String(downloadError) },
      { status: 500 },
    );
  }

  const pageBuffer = Buffer.from(await downloadData.arrayBuffer());

  const ipHash = await hashIp(getClientIp(request));
  const ts = new Date().toISOString();
  const watermarkText = `DPMPTSP-LAMPUNG | ${ipHash} | ${ts}`;

  const metadata = await sharp(pageBuffer).metadata();
  const overlay = await buildWatermarkOverlay(metadata.width ?? 800, metadata.height ?? 1100, watermarkText);

  const watermarked = await sharp(pageBuffer)
    .composite([{ input: overlay, gravity: 'center' }])
    .png()
    .toBuffer();

  return new Response(watermarked, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    },
  });
}
