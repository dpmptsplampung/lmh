import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import crypto from 'node:crypto';

const MAX_PDF_BYTES = 50 * 1024 * 1024;

const bodySchema = z.object({
  judul: z.string().min(1).max(255),
  kategori: z.string().max(100).optional(),
  deskripsi: z.string().max(2000).optional(),
  nilai_investasi: z.string().max(100).optional(),
  image_url: z.string().url().optional(),
  urutan_tampil: z.coerce.number().int().min(0).default(0),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: petugas } = await supabase
    .from('petugas')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!petugas || petugas.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 });
  }

  const pdfFile = form.get('pdf');
  if (!(pdfFile instanceof File)) {
    return NextResponse.json({ error: 'pdf file is required' }, { status: 400 });
  }

  if (pdfFile.type !== 'application/pdf') {
    return NextResponse.json({ error: 'pdf must be application/pdf content-type' }, { status: 400 });
  }

  if (pdfFile.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: 'PDF exceeds 50 MB limit' }, { status: 413 });
  }

  const parsed = bodySchema.safeParse({
    judul: form.get('judul'),
    kategori: form.get('kategori') ?? undefined,
    deskripsi: form.get('deskripsi') ?? undefined,
    nilai_investasi: form.get('nilai_investasi') ?? undefined,
    image_url: form.get('image_url') ?? undefined,
    urutan_tampil: form.get('urutan_tampil') ?? 0,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const docId = crypto.randomUUID();
  const rawPath = `_raw/${docId}.pdf`;

  const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());

  const { error: rawUploadError } = await supabase.storage
    .from('investment-docs')
    .upload(rawPath, pdfBytes, { contentType: 'application/pdf', upsert: false });

  if (rawUploadError) {
    return NextResponse.json(
      { error: 'Failed to store raw PDF', details: String(rawUploadError) },
      { status: 500 },
    );
  }

  let pngBuffers: Buffer[];
  try {
    pngBuffers = await convertPdfToPngBuffers(pdfBytes);
  } catch (err) {
    return NextResponse.json(
      { error: 'PDF conversion failed', details: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const halamanGambar: string[] = [];
  for (let i = 0; i < pngBuffers.length; i++) {
    const pagePath = `pages/${docId}/page-${i + 1}.png`;
    const { error: pageUploadError } = await supabase.storage
      .from('investment-docs')
      .upload(pagePath, pngBuffers[i], { contentType: 'image/png', upsert: false });

    if (pageUploadError) {
      return NextResponse.json(
        { error: `Failed to store page ${i + 1} PNG`, details: String(pageUploadError) },
        { status: 500 },
      );
    }
    halamanGambar.push(pagePath);
  }

  const { error: insertError } = await supabase.from('investment_documents').insert({
    id: docId,
    judul: parsed.data.judul,
    kategori: parsed.data.kategori ?? null,
    urutan_tampil: parsed.data.urutan_tampil,
    file_path: rawPath,
    halaman_gambar: halamanGambar,
    jumlah_halaman: pngBuffers.length,
    status: 'aktif',
    deskripsi: parsed.data.deskripsi ?? null,
    nilai_investasi: parsed.data.nilai_investasi ?? null,
    image_url: parsed.data.image_url ?? null,
  });

  if (insertError) {
    return NextResponse.json(
      { error: 'Failed to insert document row', details: String(insertError) },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: docId, jumlah_halaman: pngBuffers.length }, { status: 201 });
}

export async function convertPdfToPngBuffers(pdfBytes: Uint8Array): Promise<Buffer[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('canvas');

  const loadingTask = pdfjs.getDocument({
    data: pdfBytes,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  const buffers: Buffer[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    // pdfjs-dist types expect an HTMLCanvasElement; we pass a node-canvas Canvas.
    // Cast through unknown to satisfy TS without resorting to `any`.
    const renderParams = { canvasContext: ctx, viewport, canvas } as unknown as Parameters<typeof page.render>[0];
    await page.render(renderParams).promise;
    buffers.push(canvas.toBuffer('image/png'));
    page.cleanup();
  }
  await doc.cleanup();
  return buffers;
}
