import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logServerEvent } from '@/lib/observability/logger';
import { cocokMagicBytes } from '@/lib/storage/area';
import { deleteObjects, getObjectRange, headObject, r2Tersedia } from '@/lib/storage/r2';

export const dynamic = 'force-dynamic';
const ROUTE = '/api/admin/pengaduan/[id]/tanggapan';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

const bodySchema = z.object({
  isi: z.string().trim().min(1).max(2000),
  status: z.enum(['diverifikasi', 'diproses', 'eskalasi', 'selesai', 'ditolak']).nullish(),
  kirim_email: z.boolean().default(false),
  lampiran: z.array(z.object({
    kunci: z.string().min(1).max(300),
    nama: z.string().min(1).max(200),
    mime: z.enum(MIME),
    ukuran: z.number().int().positive().max(5 * 1024 * 1024),
  }).strict()).max(3).default([]),
}).strict();

// Tanggapan FO/Admin atas pengaduan. Berkas sudah diunggah ke R2 (area pengaduan-bukti); di sini diperiksa ulang (milik pengaduan ini,
// ukuran, tipe, magic bytes) lalu RPC tanggapi_pengaduan menulis tanggapan + lampiran + status + email SECARA ATOMIK.
// Bila RPC gagal, berkas yang sudah terunggah dihapus.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Input tanggapan tidak valid' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: me } = await supabase.from('petugas').select('role, aktif').eq('auth_user_id', user.id).maybeSingle();
  if (!me || me.aktif === false || (me.role !== 'admin' && me.role !== 'front_office')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { lampiran } = body.data;
  const kunciSah = new RegExp(`^pengaduan-bukti/${id}/[0-9a-f-]{36}\\.(jpg|png|webp|pdf)$`);
  const kunciList = lampiran.map((l) => l.kunci);
  if (lampiran.length > 0) {
    if (!r2Tersedia()) return NextResponse.json({ error: 'Penyimpanan berkas belum dikonfigurasi' }, { status: 503 });
    if (lampiran.some((l) => !kunciSah.test(l.kunci)) || new Set(kunciList).size !== kunciList.length) {
      return NextResponse.json({ error: 'Lampiran tidak valid' }, { status: 400 });
    }
    try {
      for (const l of lampiran) {
        const head = await headObject('private', l.kunci);
        const awal = head ? await getObjectRange('private', l.kunci, 12) : null;
        const sah = !!head && !!awal && head.size === l.ukuran && head.contentType.split(';')[0].trim() === l.mime && cocokMagicBytes(l.mime, awal);
        if (!sah) {
          await deleteObjects('private', kunciList).catch(() => undefined);
          return NextResponse.json({ error: 'Lampiran tidak sesuai aturan' }, { status: 422 });
        }
      }
    } catch (error) {
      logServerEvent('error', { operation: 'admin.pengaduan.tanggapan.periksa', route: ROUTE, error });
      return NextResponse.json({ error: 'Gagal memeriksa lampiran' }, { status: 500 });
    }
  }

  const { data, error } = await supabase.rpc('tanggapi_pengaduan', {
    p_pengaduan_id: id,
    p_isi: body.data.isi,
    p_status: body.data.status ?? null,
    p_kirim_email: body.data.kirim_email,
    p_lampiran: lampiran,
  });
  if (error || !data) {
    if (kunciList.length > 0) await deleteObjects('private', kunciList).catch(() => undefined);
    const kode = (error as { code?: string } | null)?.code;
    if (kode === '42501') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (kode === 'P0002') return NextResponse.json({ error: 'Pengaduan tidak ditemukan' }, { status: 404 });
    logServerEvent('error', { operation: 'admin.pengaduan.tanggapan', route: ROUTE, error });
    return NextResponse.json({ error: 'Gagal menyimpan tanggapan' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data }, { status: 201 });
}
