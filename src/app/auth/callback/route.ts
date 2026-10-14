import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerEvent } from '@/lib/observability/logger';
import { apakahPeranStaf, daftarkanSesiStaf, keluarDariSesi } from '@/lib/sesi-staf';

function safeNextPath(next: string | null): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    return next;
  }
  return '/';
}

function requestOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_PUBLIC_URL;
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next') ?? '/me');
  const origin = requestOrigin(request);

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Sesi tunggal staf (admin/petugas/front_office): daftarkan SEKALI setelah login (tautan undangan, pemulihan
      // sandi, Google). Pengunjung/mitra non-staf tidak memanggilnya. Gagal = login dibatalkan, bukan diloloskan diam-diam.
      const { data: peran } = await supabase
        .from('petugas')
        .select('role')
        .eq('auth_user_id', data.user.id)
        .maybeSingle();
      if (peran && apakahPeranStaf(peran.role)) {
        const daftar = await daftarkanSesiStaf(supabase);
        if (daftar.status === 'gagal') {
          logServerEvent('error', {
            operation: 'auth.callback.daftar_sesi_gagal',
            route: '/auth/callback',
            kode: daftar.kode,
          });
          await keluarDariSesi(supabase, { akhiri: false });
          return NextResponse.redirect(`${origin}/login?error=sesi`);
        }
      }

      // Auto-create profil pengunjung jika belum ada
      const { data: existing } = await supabase
        .from('pengunjung')
        .select('id')
        .eq('auth_user_id', data.user.id)
        .single();

      if (!existing) {
        const metadata = data.user.user_metadata;
        const { error: insertError } = await supabase.from('pengunjung').insert({
          auth_user_id: data.user.id,
          nama: metadata?.full_name || metadata?.name || 'Pengunjung',
          email: data.user.email,
          foto_url: metadata?.avatar_url || metadata?.picture || null,
          provider: 'google',
        });
        // Login tetap lanjut (halaman chat punya fallback pembuatan profil), tetapi kegagalan dicatat.
        if (insertError) {
          logServerEvent('error', {
            operation: 'auth.callback.profil_pengunjung_gagal',
            route: '/auth/callback',
            error: insertError,
          });
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // OAuth error — redirect ke login dengan pesan error
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
