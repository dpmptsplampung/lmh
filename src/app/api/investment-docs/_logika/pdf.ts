import { cocokMagicBytes } from '@/lib/storage/area';
import { getObjectBytes, headObject } from '@/lib/storage/r2';

export const MAKS_BYTE = 50 * 1024 * 1024;
const MAKS_PIKSEL = 40_000_000;
type DokumenPdf = Awaited<ReturnType<typeof bukaPdf>>['doc'];

export async function bacaPdf(kunci: string): Promise<Uint8Array> {
  const head = await headObject('private', kunci);
  if (!head) throw new Error('TIDAK_DITEMUKAN');
  if (head.size < 5 || head.size > MAKS_BYTE || head.contentType.split(';')[0].trim() !== 'application/pdf') {
    throw new Error('INPUT_TIDAK_VALID');
  }
  const bytes = await getObjectBytes('private', kunci);
  if (!bytes) throw new Error('TIDAK_DITEMUKAN');
  return bytes;
}

export async function bukaPdf(bytes: Uint8Array) {
  if (bytes.length > MAKS_BYTE || !cocokMagicBytes('application/pdf', bytes)
    || /\/Encrypt\b/.test(new TextDecoder('latin1').decode(bytes))) throw new Error('INPUT_TIDAK_VALID');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true, maxImageSize: MAKS_PIKSEL, canvasMaxAreaInBytes: MAKS_PIKSEL * 4 });
  try {
    const doc = await task.promise;
    if (await doc.getPermissions() !== null || doc.numPages < 1 || doc.numPages > 50) throw new Error('INPUT_TIDAK_VALID');
    return { doc, tutup: () => task.destroy() };
  } catch {
    await task.destroy();
    throw new Error('INPUT_TIDAK_VALID');
  }
}

export async function renderHalaman(doc: DokumenPdf, nomor: number): Promise<Buffer> {
  const page = await doc.getPage(nomor);
  try {
    const viewport = page.getViewport({ scale: 1.5 });
    const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
      || width * height > MAKS_PIKSEL) throw new Error('INPUT_TIDAK_VALID');
    // Gunakan factory PDF.js agar canvas dan Path2D berasal dari backend native yang sama.
    type Kanvas = { canvas: { toBuffer: (mime: 'image/png') => Buffer }; context: unknown };
    const factory = doc.canvasFactory as { create: (w: number, h: number) => Kanvas; destroy: (v: Kanvas) => void };
    const kanvas = factory.create(width, height);
    try {
      await page.render({ canvasContext: kanvas.context, viewport, canvas: kanvas.canvas } as unknown as Parameters<typeof page.render>[0]).promise;
      const sharp = (await import('sharp')).default;
      return await sharp(kanvas.canvas.toBuffer('image/png'), { limitInputPixels: MAKS_PIKSEL }).png().toBuffer();
    } finally { factory.destroy(kanvas); }
  } finally { page.cleanup(); }
}
