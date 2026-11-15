// POST /api/admin/revalidasi { tag }: admin membuang cache data publik (unstable_cache di lib/data/publik-server)
// setelah menyimpan konten yang tampil di halaman publik. Rencana refaktor 4.5, SPEC bagian 5 "Cache".
//
// - Hanya Admin aktif (requireAdmin, sama dengan route admin lain): 401 tanpa sesi/nonaktif, 403 bukan Admin.
//   Otorisasi dicek lebih dulu daripada badan, jadi penyerang tanpa sesi tidak bisa menguji validasi.
// - Daftar izin diturunkan dari TAG_PUBLIK (satu sumber kebenaran dengan tag di unstable_cache). Tag lain, termasuk
//   tag cache yang bukan milik data publik (mis. katalog UMKM), ditolak 400 dan tidak pernah sampai ke Next.
// - `revalidateTag(tag, { expire: 0 })`: bentuk dua argumen (satu argumen usang di Next 16). `expire: 0` = entri
//   langsung dibuang, permintaan berikutnya memuat ulang (tidak menyajikan data basi).
// - Hanya POST (tanpa GET yang bisa dipicu tautan/gambar) dan tidak pernah di-cache.
import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/akun/server';
import { TAG_PUBLIK, type TagPublik } from '@/lib/data/publik-server';

export const dynamic = 'force-dynamic';

const DAFTAR_IZIN = Object.values(TAG_PUBLIK) as [TagPublik, ...TagPublik[]];
const badanSchema = z.object({ tag: z.enum(DAFTAR_IZIN) });

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const balas = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(request: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;

  let mentah: unknown;
  try {
    mentah = await request.json();
  } catch {
    return balas({ error: 'Invalid JSON' }, 400);
  }
  const hasil = badanSchema.safeParse(mentah);
  if (!hasil.success) return balas({ error: 'Tag tidak dikenal' }, 400);

  revalidateTag(hasil.data.tag, { expire: 0 });
  return balas({ ok: true });
}
