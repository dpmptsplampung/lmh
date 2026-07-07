import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/me';

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Auto-create profil pengunjung jika belum ada
      const { data: existing } = await supabase
        .from('pengunjung')
        .select('id')
        .eq('auth_user_id', data.user.id)
        .single();

      if (!existing) {
        const metadata = data.user.user_metadata;
        await supabase.from('pengunjung').insert({
          auth_user_id: data.user.id,
          nama: metadata?.full_name || metadata?.name || 'Pengunjung',
          email: data.user.email,
          foto_url: metadata?.avatar_url || metadata?.picture || null,
          provider: 'google',
        });
      }

      // Redirect ke halaman tujuan
      const forwardedHost = request.headers.get('x-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  // OAuth error — redirect ke login dengan pesan error
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
