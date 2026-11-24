import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { BerkasTautanSchema, type BerkasTautan, type TautanHalaman, urlTautanAman } from '@/lib/investasi/tautan';

type Rect = Pick<TautanHalaman, 'x' | 'y' | 'w' | 'h'>;
type Anotasi = { subtype?: unknown; rect?: unknown; url?: unknown; unsafeUrl?: unknown; dest?: unknown };
const MIN_UKURAN = 0.0001;
const jepit = (nilai: number) => Math.max(0, Math.min(1, nilai));

function posisi(rect: unknown, viewport: ReturnType<PDFPageProxy['getViewport']>): Rect | null {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0) return null;
  // Viewport memakai view/CropBox, UserUnit, rotasi, dan sumbu yang sama dengan renderer PNG.
  const [ax, ay] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [bx, by] = viewport.convertToViewportPoint(rect[2], rect[3]);
  const x = jepit(Math.min(ax, bx) / viewport.width);
  const y = jepit(Math.min(ay, by) / viewport.height);
  const w = jepit(Math.max(ax, bx) / viewport.width) - x;
  const h = jepit(Math.max(ay, by) / viewport.height) - y;
  return w >= MIN_UKURAN && h >= MIN_UKURAN ? { x, y, w, h } : null;
}

function refHalaman(v: unknown): v is { num: number; gen: number } {
  return typeof v === 'object' && v !== null && 'num' in v && 'gen' in v
    && Number.isInteger(v.num) && Number.isInteger(v.gen);
}

function pemecahTujuan(doc: PDFDocumentProxy) {
  const referensi = new Map<string, number>();
  const nama = new Map<string, number>();
  async function indeks(dest: unknown): Promise<number> {
    if (!Array.isArray(dest) || !dest.length) return -1;
    const [ref] = dest;
    if (Number.isInteger(ref)) return ref;
    if (!refHalaman(ref)) return -1;
    const kunci = `${ref.num}:${ref.gen}`;
    const ada = referensi.get(kunci);
    if (ada !== undefined) return ada;
    const index = await doc.getPageIndex(ref).catch(() => -1);
    referensi.set(kunci, index);
    return index;
  }
  return async (dest: unknown): Promise<number | undefined> => {
    let index: number;
    if (typeof dest === 'string') {
      index = nama.get(dest) ?? await indeks(await doc.getDestination(dest).catch(() => null));
      nama.set(dest, index);
    } else index = await indeks(dest);
    return index >= 0 && index < doc.numPages ? index + 1 : undefined;
  };
}

/** Baca anotasi per halaman tanpa merender dan tanpa mengakses jaringan atau penyimpanan. */
export async function ekstrakTautan(doc: PDFDocumentProxy): Promise<BerkasTautan> {
  const tautan: TautanHalaman[] = [];
  const tujuan = pemecahTujuan(doc);
  for (let hal = 1; hal <= doc.numPages; hal++) {
    const page = await doc.getPage(hal);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const anotasi: Anotasi[] = await page.getAnnotations();
      for (const link of anotasi) {
        if (link.subtype !== 'Link') continue;
        const rect = posisi(link.rect, viewport);
        if (!rect) continue;
        // PDF.js juga menyertakan unsafeUrl pada URI sah. Pakai hanya url hasil normalisasi parser.
        const url = urlTautanAman(typeof link.url === 'string' ? link.url : undefined);
        if (url && url.length <= 2048) {
          tautan.push({ hal, ...rect, url });
          continue;
        }
        if (typeof link.unsafeUrl === 'string' || typeof link.url === 'string') continue;
        const ke = await tujuan(link.dest);
        if (ke !== undefined) tautan.push({ hal, ...rect, ke });
      }
    } finally { page.cleanup(); }
  }
  return BerkasTautanSchema.parse({ versi: 1, tautan });
}
