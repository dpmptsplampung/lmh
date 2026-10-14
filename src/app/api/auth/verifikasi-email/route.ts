import { NextResponse, type NextRequest } from 'next/server';
import { getServiceClient, publicBaseUrl, sha256 } from '@/lib/akun/server';
import { mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';

export const dynamic = 'force-dynamic';

const HALAMAN_PROFIL = '/admin/profil'; // dibuat frontend; sesuaikan bila path berbeda

// Tautan dari email: token sekali pakai (hash SHA-256 di DB, 30 menit). Tidak butuh sesi.
export async function GET(request: NextRequest) {
  const base = publicBaseUrl() ?? request.nextUrl.origin;
  const token = request.nextUrl.searchParams.get('token') ?? '';
  let ok = false;
  const service = getServiceClient();
  if (service && token.length >= 20 && token.length <= 100) {
    try {
      // RPC mengembalikan uuid petugas, atau NULL bila token salah/kedaluwarsa/email sudah diganti (itu normal, bukan
      // error): NULL -> tidak ada baris -> ok=false. Error RPC (infrastruktur) dibedakan: dicatat, lalu ok=false juga.
      const [petugasId] = await mutasiInsert<string>(
        service.rpc('petugas_verifikasi_email', { p_token_hash: sha256(token) }),
      );
      ok = !!petugasId;
    } catch (e) {
      catatMutasi('error', 'auth.verifikasi_email.rpc', '/api/auth/verifikasi-email', e);
    }
  }
  return NextResponse.redirect(`${base}${HALAMAN_PROFIL}?email_verif=${ok ? 'ok' : 'gagal'}`, 303);
}
