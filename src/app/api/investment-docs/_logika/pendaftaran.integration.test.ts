// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const h = vi.hoisted(() => ({ objek: new Map<string, Uint8Array>() }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({
  headObject: vi.fn(async (_bucket: string, key: string) => {
    const bytes = h.objek.get(key);
    return bytes ? { size: bytes.length, contentType: 'application/pdf', etag: createHash('sha256').update(bytes).digest('hex') } : null;
  }),
  copyObject: vi.fn(async (_a: string, asal: string, _b: string, tujuan: string, etag: string) => {
    const bytes = h.objek.get(asal)!;
    if (createHash('sha256').update(bytes).digest('hex') !== etag) throw new Error('PreconditionFailed');
    h.objek.set(tujuan, Uint8Array.from(bytes));
  }),
  getObjectBytes: vi.fn(async (_bucket: string, key: string) => h.objek.has(key) ? Uint8Array.from(h.objek.get(key)!) : null),
  putObject: vi.fn(async (_bucket: string, key: string, bytes: Uint8Array) => { h.objek.set(key, Uint8Array.from(bytes)); }),
  deleteObjects: vi.fn(async (_bucket: string, keys: string[]) => { keys.forEach(k => h.objek.delete(k)); }),
}));
import { createClient } from '@/lib/supabase/server';
import { deleteObjects, copyObject, headObject } from '@/lib/storage/r2';
import { logServerEvent } from '@/lib/observability/logger';
import { POST as daftar } from '../route';
import { POST as render } from '../[id]/render/route';
import { tiruan, kunci, request } from './uji-fixture';

// PDF sintetis dengan warna halaman yang bisa diperiksa pada PNG hasil native renderer.
function pdfSintetis(halaman: number, warna = '1 0 0') {
  const stream = `${warna} rg 0 0 20 20 re f`;
  const objek = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: halaman }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${halaman} >>`,
  ];
  for (let n = 0; n < halaman; n++) objek.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << >> /Contents ${4 + n * 2} 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  );
  let pdf = '%PDF-1.4\n'; const offsets: number[] = [];
  objek.forEach((isi, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${isi}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objek.length + 1}\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objek.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
let t: ReturnType<typeof tiruan>;
beforeEach(() => {
  vi.clearAllMocks(); h.objek.clear(); t = tiruan(); t.state.rows = [];
  vi.mocked(createClient).mockResolvedValue(t.sb);
});
describe('pendaftaran dan render dengan parser PDF asli, storage dalam memori', () => {
  it('PUT raw B sesudah batch pertama tetap menghasilkan seluruh halaman dari snapshot A', async () => {
    const a = pdfSintetis(10), b = pdfSintetis(10, '0 0 1');
    expect(a.length).toBe(b.length); h.objek.set(kunci, a);
    const response = await daftar(request({ kunci, judul: 'Snapshot' }));
    expect(response.status).toBe(201);
    const { id } = await response.json(); const context = { params: Promise.resolve({ id }) };
    expect(t.state.rows[0].file_path).toBe(`src/${id}.pdf`);
    expect(h.objek.has(kunci)).toBe(false);
    expect(copyObject).toHaveBeenCalledWith('private', kunci, 'private', `investment-docs/src/${id}.pdf`, expect.any(String));
    expect((await render(request({ mulai: 1 }), context)).status).toBe(200);
    h.objek.set(kunci, b); // Reuse URL PUT yang belum kedaluwarsa.
    expect((await render(request({ mulai: 9 }), context)).status).toBe(200);
    expect(t.state.rows[0]).toMatchObject({ status: 'aktif', halaman_selesai: 10 });
    const paths = t.state.rows[0].halaman_gambar as string[];
    for (const path of paths) {
      const pixels = await sharp(h.objek.get(`investment-docs/${path}`)!).removeAlpha().raw().toBuffer();
      expect([...pixels.subarray(15 * 30 * 3 + 15 * 3, 15 * 30 * 3 + 15 * 3 + 3)]).toEqual([255, 0, 0]);
    }
    expect((await daftar(request({ kunci, judul: 'Duplikat' }))).status).toBe(409);
  });
  it.each(['enkripsi', '51 halaman', 'insert gagal'])('%s membersihkan raw dan salinan final', async kasus => {
    h.objek.set(kunci, kasus === 'enkripsi' ? new TextEncoder().encode('%PDF-1.4\n/Encrypt 1 0 R') : pdfSintetis(kasus === '51 halaman' ? 51 : 1));
    if (kasus === 'insert gagal') t.state.insertError = { code: 'XX000', message: 'data internal' };
    expect((await daftar(request({ kunci, judul: 'Gagal' }))).status).toBe(kasus === 'insert gagal' ? 500 : 400);
    expect(h.objek.size).toBe(0); expect(t.state.rows).toHaveLength(0);
    expect(t.state.claims).toHaveLength(1);
    expect(deleteObjects).toHaveBeenCalledWith('private', [kunci, expect.stringMatching(/^investment-docs\/src\//)]);
  });
  it('raw berubah antara HEAD dan CopyObject: gagal tertutup dan membersihkan objek', async () => {
    const a = pdfSintetis(1), b = pdfSintetis(1, '0 0 1'); h.objek.set(kunci, a);
    vi.mocked(headObject).mockImplementationOnce(async () => {
      const etag = createHash('sha256').update(a).digest('hex');
      h.objek.set(kunci, b);
      return { size: a.length, contentType: 'application/pdf', etag };
    });
    expect((await daftar(request({ kunci, judul: 'Balapan PUT' }))).status).toBe(500);
    expect(t.state.rows).toHaveLength(0); expect(h.objek.size).toBe(0);
  });
  it('gagal hapus tetap mempertahankan galat parser utama dan mencatat rekonsiliasi', async () => {
    h.objek.set(kunci, new TextEncoder().encode('%PDF-1.4\n/Encrypt 1 0 R'));
    vi.mocked(deleteObjects).mockRejectedValueOnce(new Error('storage gagal'));
    expect((await daftar(request({ kunci, judul: 'Gagal' }))).status).toBe(400);
    expect(logServerEvent).toHaveBeenCalledWith('warn', expect.objectContaining({ operation: 'investment_docs.cleanup_gagal', nFile: 2 }));
  });
});
