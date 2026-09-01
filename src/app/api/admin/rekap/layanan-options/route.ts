import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { determineFormType } from '@/lib/pelayanan';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: me } = await supabase
    .from('petugas')
    .select('id, role, layanan_id, aktif')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!me || me.aktif === false) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (me.role === 'petugas') {
    return NextResponse.json({
      options: [],
      default_layanan_id: me.layanan_id,
      is_petugas: true,
    });
  }

  // admin or front_office: list all active layanan
  const { data: rows, error } = await supabase
    .from('layanan')
    .select('id, nama, tipe')
    .eq('aktif', true)
    .order('nama');

  if (error) {
    return NextResponse.json({ error: 'Gagal memuat daftar layanan' }, { status: 500 });
  }

  const options = (rows ?? []).map((l) => ({
    id: l.id,
    nama: l.nama,
    tipe: l.tipe,
    jenis_pendataan: determineFormType(l.nama),
  }));

  return NextResponse.json({
    options,
    default_layanan_id: null,
    is_petugas: false,
  });
}
