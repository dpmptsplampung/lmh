import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { muatStafRekap, paramsDariRequest } from '@/lib/rekap/akses';
import { penangananQuerySchema } from '@/lib/rekap/schemas';
import { fetchAllPages } from '@/lib/rekap/exportAll';
import {
  buildPenangananQuery,
  mapRawPenangananRow,
  ringkasPenanganan,
  tentukanCakupan,
} from '@/lib/rekap/penanganan';

export const dynamic = 'force-dynamic';

// Rekap penanganan per tahap (FO atau petugas layanan). Seluruh rentang diambil dengan paginasi penuh agar ringkasan
// akurat (bukan hanya halaman yang tampil); daftar dipotong per halaman di sini. Dibatasi 50.000 baris (flag truncated).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const staf = await muatStafRekap(supabase);
  if (!staf.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = penangananQuerySchema.safeParse(paramsDariRequest(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }
  const q = parsed.data;

  const cakupan = tentukanCakupan(staf.me, q);
  if (!cakupan.ok) return NextResponse.json({ error: cakupan.error }, { status: cakupan.status });

  try {
    const { rows: mentah, truncated } = await fetchAllPages((from, to) =>
      buildPenangananQuery(supabase, {
        peran: q.peran,
        dari: q.dari,
        sampai: q.sampai,
        penanganId: cakupan.penanganId,
        layananId: cakupan.layananId,
        from,
        to,
      }),
    );
    const semua = mentah.map((r) => mapRawPenangananRow(r as unknown as Record<string, unknown>));
    const awal = q.page * q.page_size;
    return NextResponse.json({
      total: semua.length,
      truncated,
      peran_saya: staf.me.role,
      // FO terkunci ke dirinya sendiri; UI menyembunyikan filter FO.
      terkunci_ke_saya: staf.me.role === 'front_office',
      ringkasan: ringkasPenanganan(semua),
      rows: semua.slice(awal, awal + q.page_size),
    });
  } catch (error) {
    console.error('[api/admin/rekap/penanganan] gagal memuat rekap:', error);
    return NextResponse.json({ error: 'Gagal memuat rekap' }, { status: 500 });
  }
}
