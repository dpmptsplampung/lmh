import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { panggilRpc, type RpcKontrak } from './rpc';
import type { SupabaseClient } from '@supabase/supabase-js';

const statusKode: Record<string, number> = {
  INPUT_TIDAK_VALID: 400, LOGIN_DIPERLUKAN: 401, DILARANG: 403, TIDAK_DITEMUKAN: 404,
  KONFLIK_VERSI: 409, KONFLIK_STATUS: 409, KONFLIK_OPERASI: 409, KONTAK_PUBLIK: 409,
  TERLALU_BANYAK: 429, MODUL_BELUM_TERSEDIA: 503, GAGAL_INTERNAL: 500,
};
const pesanKode: Record<string, string> = {
  INPUT_TIDAK_VALID: 'Periksa kembali isian Anda.', LOGIN_DIPERLUKAN: 'Silakan masuk untuk melanjutkan.',
  DILARANG: 'Akun ini tidak berwenang mengerjakan tugas UMKM.', TIDAK_DITEMUKAN: 'Data tidak ditemukan.',
  KONFLIK_VERSI: 'Tugas telah berubah. Muat ulang sebelum melanjutkan.', KONFLIK_STATUS: 'Tindakan tidak sesuai status saat ini.',
  KONFLIK_OPERASI: 'Kunci operasi sudah digunakan untuk isian berbeda.', KONTAK_PUBLIK: 'Bersihkan informasi kontak pada field yang ditandai sebelum menerbitkan.',
  TERLALU_BANYAK: 'Coba kembali beberapa saat lagi.', MODUL_BELUM_TERSEDIA: 'Modul UMKM belum tersedia. Silakan coba kembali nanti.',
  GAGAL_INTERNAL: 'Permintaan belum dapat diproses. Silakan coba kembali.',
};
export const headersPrivat = { 'Cache-Control': 'private, no-store' };
export function galat(code: string, requestId: string) {
  return Response.json({ error: { code, message: pesanKode[code] }, request_id: requestId }, {
    status: statusKode[code] ?? 500, headers: { ...headersPrivat, ...(code === 'TERLALU_BANYAK' ? { 'Retry-After': '60' } : {}) },
  });
}
export function kodeRpc(error: { code?: string; message?: string }) {
  if (error.message && statusKode[error.message]) return error.message;
  if (['PGRST202', 'PGRST205', '42883', '42P01', '42703', '3F000'].includes(error.code ?? '')) return 'MODUL_BELUM_TERSEDIA';
  return ({ '42501': 'DILARANG', '28000': 'LOGIN_DIPERLUKAN', 'P0002': 'TIDAK_DITEMUKAN', '40001': 'KONFLIK_VERSI', '55P03': 'KONFLIK_VERSI', '22023': 'INPUT_TIDAK_VALID', '22P02': 'INPUT_TIDAK_VALID' } as Record<string,string>)[error.code ?? ''] ?? 'GAGAL_INTERNAL';
}
export async function bacaJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > 65536) throw new Error('INPUT_TIDAK_VALID');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INPUT_TIDAK_VALID');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new Error('INPUT_TIDAK_VALID'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw new Error('INPUT_TIDAK_VALID'); } finally { reader.releaseLock(); }
}
export type IdContext = { params: Promise<{ id: string }> };
export async function inputAksi(request: Request, context: IdContext) {
  const body = await bacaJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body) || 'id' in body) throw new Error('INPUT_TIDAK_VALID');
  return { ...body, id: (await context.params).id };
}
export const idSchema = z.object({ id: z.uuid() }).strict();
export async function layaniRpc<S extends z.ZodType, K extends keyof RpcKontrak>(
  schema: S, input: () => Promise<unknown>, nama: K, args: (data: z.output<S>) => RpcKontrak[K]['args'],
  setelah?: (data: RpcKontrak[K]['hasil'], client: SupabaseClient) => Promise<RpcKontrak[K]['hasil']>,
) {
  const requestId = crypto.randomUUID();
  try {
    const client = await createClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return galat('LOGIN_DIPERLUKAN', requestId);
    const parsed = schema.safeParse(await input());
    if (!parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
    const result = await panggilRpc(client, nama, args(parsed.data));
    if (result.error) return galat(kodeRpc(result.error), requestId);
    if (result.data === null) return galat('TIDAK_DITEMUKAN', requestId);
    if (setelah) result.data = await setelah(result.data, client);
    const cursor = typeof result.data === 'object' && 'next_cursor' in result.data ? result.data.next_cursor : undefined;
    return Response.json({ data: result.data, meta: { request_id: requestId, ...(cursor !== undefined ? { next_cursor: cursor } : {}) } }, { headers: headersPrivat });
  } catch (e) {
    return galat(e instanceof Error && e.message === 'INPUT_TIDAK_VALID' ? 'INPUT_TIDAK_VALID' : 'GAGAL_INTERNAL', requestId);
  }
}
