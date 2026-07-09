import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filePath = searchParams.get('file_path');

  if (!filePath) {
    return NextResponse.json({ error: 'file_path parameter required' }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from('investment-docs')
    .createSignedUrl(filePath, 3600);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ signedUrl: data.signedUrl });
}
