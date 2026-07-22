import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filePath = searchParams.get('file_path');

  if (!filePath) {
    return NextResponse.json({ error: 'file_path parameter required' }, { status: 400 });
  }

  if (!filePath.startsWith('_raw/') && !filePath.startsWith('pages/')) {
    return NextResponse.json({ error: 'Invalid file_path' }, { status: 400 });
  }

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

  const { data, error } = await supabase.storage
    .from('investment-docs')
    .createSignedUrl(filePath, 60);

  if (error) {
    console.error('[investment-docs/signed-url] gagal membuat signed url', error);
    return NextResponse.json({ error: 'Gagal membuat tautan unduhan.' }, { status: 500 });
  }

  return NextResponse.json({ signedUrl: data.signedUrl });
}
