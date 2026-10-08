import { NextResponse, type NextRequest } from 'next/server';
import { getServiceClient, publicBaseUrl, sha256 } from '@/lib/akun/server';

export const dynamic = 'force-dynamic';

const HALAMAN_PROFIL = '/admin/profil'; // dibuat frontend; sesuaikan bila path berbeda

// Tautan dari email: token sekali pakai (hash SHA-256 di DB, 30 menit). Tidak butuh sesi.
export async function GET(request: NextRequest) {
  const base = publicBaseUrl() ?? request.nextUrl.origin;
  const token = request.nextUrl.searchParams.get('token') ?? '';
  let ok = false;
  const service = getServiceClient();
  if (service && token.length >= 20 && token.length <= 100) {
    const { data } = await service.rpc('petugas_verifikasi_email', { p_token_hash: sha256(token) });
    ok = !!data;
  }
  return NextResponse.redirect(`${base}${HALAMAN_PROFIL}?email_verif=${ok ? 'ok' : 'gagal'}`, 303);
}
