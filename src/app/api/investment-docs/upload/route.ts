import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { mutasiInsert, pesanMutasi } from '@/lib/supabase/mutate';
import { z } from 'zod';
import { catatMutasi } from '@/lib/observability/catat-mutasi';
import crypto from 'node:crypto';
import { logServerEvent } from '@/lib/observability/logger';
import { kunciObjek } from '@/lib/storage/area';
import { deleteObjects, putObject } from '@/lib/storage/r2';

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 50;
const PDF_MAGIC = new TextEncoder().encode('%PDF');

const bodySchema = z.object({
  judul: z.string().min(1).max(255),
  kategori: z.string().max(100).optional(),
  deskripsi: z.string().max(2000).optional(),
  nilai_investasi: z.string().max(100).optional(),
  image_url: z.string().url().optional(),
  urutan_tampil: z.coerce.number().int().min(0).default(0),
});

function hasPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  for (let i = 0; i < PDF_MAGIC.length; i++) {
    if (bytes[i] !== PDF_MAGIC[i]) return false;
  }
  return true;
}

function looksEncrypted(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 2048)));
  return /\/Encrypt[\s\/<]/.test(head);
}

async function cleanupStorage(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await deleteObjects('private', paths.map((p) => kunciObjek('investment-docs', p)));
  } catch (error) {
    logServerEvent('warn', { operation: 'investment_docs.upload.cleanup', route: '/api/investment-docs/upload', nFile: paths.length, error });
  }
}

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

  const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());

  if (!hasPdfMagic(pdfBytes)) {
    return NextResponse.json(
      { error: 'Invalid PDF magic bytes — file is not a PDF' },
      { status: 400 },
    );
  }

  if (looksEncrypted(pdfBytes)) {
    return NextResponse.json(
      { error: 'Encrypted PDF is not supported' },
      { status: 400 },
    );
  }

  const docId = crypto.randomUUID();
  const rawPath = `_raw/${docId}.pdf`;
  const uploadedPaths: string[] = [];

  let rawUploadError: unknown = null;
  try {
    await putObject('private', kunciObjek('investment-docs', rawPath), pdfBytes, 'application/pdf');
  } catch (e) {
    rawUploadError = e;
  }

  if (rawUploadError) {
    return NextResponse.json(
      { error: 'Failed to store raw PDF', details: 'storage error' },
      { status: 500 },
    );
  }
  uploadedPaths.push(rawPath);

  let pngBuffers: Buffer[];
  try {
    pngBuffers = await convertPdfToPngBuffers(pdfBytes);
  } catch (err) {
    await cleanupStorage(uploadedPaths);
    const message = err instanceof Error ? err.message : String(err);
    if (
      (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'PAGE_LIMIT') ||
      /halaman|page|50/i.test(message)
    ) {
      return NextResponse.json(
        { error: `PDF melebihi batas ${MAX_PDF_PAGES} halaman` },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: 'PDF conversion failed', details: message },
      { status: 500 },
    );
  }

  if (pngBuffers.length > MAX_PDF_PAGES) {
    await cleanupStorage(uploadedPaths);
    return NextResponse.json(
      { error: `PDF melebihi batas ${MAX_PDF_PAGES} halaman` },
      { status: 400 },
    );
  }

  const halamanGambar: string[] = [];
  for (let i = 0; i < pngBuffers.length; i++) {
    const pagePath = `pages/${docId}/page-${i + 1}.png`;
    let pageUploadError: unknown = null;
    try {
      await putObject('private', kunciObjek('investment-docs', pagePath), pngBuffers[i], 'image/png');
    } catch (e) {
      pageUploadError = e;
    }

    if (pageUploadError) {
      await cleanupStorage(uploadedPaths);
      return NextResponse.json(
        { error: `Failed to store page ${i + 1} PNG`, details: 'storage error' },
        { status: 500 },
      );
    }
    uploadedPaths.push(pagePath);
    halamanGambar.push(pagePath);
  }

  try {
    await mutasiInsert(
      supabase.from('investment_documents').insert({
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
      }),
    );
  } catch (e) {
    catatMutasi('error', 'investment_docs.upload.insert', '/api/investment-docs/upload', e, { docId });
    await cleanupStorage(uploadedPaths);
    return NextResponse.json(
      { error: 'Failed to insert document row', details: pesanMutasi(e) },
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

  if (doc.numPages > MAX_PDF_PAGES) {
    await doc.cleanup();
    const err = new Error(`PDF melebihi batas ${MAX_PDF_PAGES} halaman`);
    (err as Error & { code?: string }).code = 'PAGE_LIMIT';
    throw err;
  }

  const buffers: Buffer[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    const renderParams = { canvasContext: ctx, viewport, canvas } as unknown as Parameters<typeof page.render>[0];
    await page.render(renderParams).promise;
    buffers.push(canvas.toBuffer('image/png'));
    page.cleanup();
  }
  await doc.cleanup();
  return buffers;
}
