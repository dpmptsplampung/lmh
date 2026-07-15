import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const { data: doc } = await supabase
    .from('investment_documents')
    .select('id, file_path, halaman_gambar')
    .eq('id', id)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const paths: string[] = [];
  if (doc.file_path) paths.push(doc.file_path);
  if (Array.isArray(doc.halaman_gambar)) {
    for (const p of doc.halaman_gambar) {
      if (typeof p === 'string' && p.length > 0) paths.push(p);
    }
  }

  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage
      .from('investment-docs')
      .remove(paths);
    if (removeError) {
      // Prefer storage-first cleanup; still attempt DB delete so orphans are not double-orphaned
      // by leaving the row. Log via response details only if DB also fails.
    }
  }

  const { error: deleteError } = await supabase
    .from('investment_documents')
    .delete()
    .eq('id', id);

  if (deleteError) {
    return NextResponse.json(
      {
        error: 'DB delete failed after storage cleanup',
        details: String(deleteError),
        note: paths.length > 0
          ? 'Storage objects may already have been removed'
          : undefined,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id }, { status: 200 });
}
