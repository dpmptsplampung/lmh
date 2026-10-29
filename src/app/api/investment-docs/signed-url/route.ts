import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/akun/server';
import { logServerEvent } from '@/lib/observability/logger';
import { mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';
import { kunciObjek } from '@/lib/storage/area';
import { presignGet } from '@/lib/storage/r2';

const ROUTE = '/api/investment-docs/signed-url';

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

  // A6: jejak audit akses PDF mentah (compliance requirement) bersifat FAIL-CLOSED. Audit ditulis DULU;
  // bila gagal (insert error, atau klien service tidak tersedia) unduhan ditolak (503) dan signed URL TIDAK dibuat,
  // sehingga tidak ada akses PDF tanpa jejak. Pesan ke klien baku; detail hanya masuk log (kode, bukan pesan DB).
  // Catatan: bila pembuatan signed URL gagal sesudahnya, baris audit tetap ada (mencatat percobaan akses).
  const PESAN_AUDIT_GAGAL = 'Pencatatan audit unduhan tidak tersedia saat ini. Unduhan ditunda, coba lagi nanti.';
  const service = getServiceClient();
  if (!service) {
    logServerEvent('error', { operation: 'investment_docs.signed_url.audit_unavailable', route: ROUTE });
    return NextResponse.json({ error: PESAN_AUDIT_GAGAL }, { status: 503 });
  }
  try {
    await mutasiInsert(
      service.from('audit_log').insert({
        actor_id: user.id,
        actor_role: petugas.role,
        aksi: 'download_raw_pdf',
        entitas: 'investment_documents',
        entitas_id: filePath,
        detail: { file_path: filePath, signed_url_ttl_seconds: 60 },
      }),
    );
  } catch (e) {
    catatMutasi('error', 'investment_docs.signed_url.audit', ROUTE, e);
    return NextResponse.json({ error: PESAN_AUDIT_GAGAL }, { status: 503 });
  }

  let signedUrl: string;
  try {
    signedUrl = await presignGet('private', kunciObjek('investment-docs', filePath), 60);
  } catch (error) {
    logServerEvent('error', { operation: 'investment_docs.signed_url.create', route: ROUTE, error });
    return NextResponse.json({ error: 'Gagal membuat tautan unduhan.' }, { status: 500 });
  }

  return NextResponse.json({ signedUrl });
}
